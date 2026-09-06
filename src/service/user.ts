import { Provide } from '@midwayjs/core';
import { Op, Sequelize } from 'sequelize';
import {
  DEFAULT_USER_COUNT_LIMIT,
  USER_COUNT_LIMIT_FIELDS,
  TUserCountLimitField,
} from '../core/limits';
import { LANE } from '../core/enums';
import { IUserOptions } from '../interface';
import { UserModel } from '../model/UserModel';

export type TUserCountLimitMap = Record<TUserCountLimitField, number>;

@Provide()
export class UserService {
  async getUser(options: IUserOptions) {
    return {
      uid: options.uid,
      username: 'mockedName',
      phone: '12345678901',
      email: 'xxx.xxx@xxx.com',
    };
  }

  /**
   * countlimit 初始化：
   * 新用户 / 历史用户字段为空时，将次数相关权限初始化为默认值（当前均为 10）
   */
  async initializeUserCountLimits(
    openid: string,
    lane: string = LANE.WHALE,
    created = false
  ): Promise<TUserCountLimitMap> {
    const user = await UserModel.findOne({
      where: {
        openid,
        lane,
      },
    });
    if (!user) {
      throw new Error('user_not_existed');
    }
    let changed = false;
    for (const field of USER_COUNT_LIMIT_FIELDS) {
      const currentValue = user.getDataValue(field);
      if (created || currentValue === null || currentValue === undefined) {
        user.setDataValue(field, DEFAULT_USER_COUNT_LIMIT);
        changed = true;
      }
    }
    if (changed) {
      await user.save();
    }
    return this.normalizeCountLimitMap(user.get() as Record<string, unknown>);
  }

  /**
   * 查询用户剩余次数，字段为空的历史用户会先补齐默认值
   */
  async getUserCountLimitMap(
    openid: string,
    lane: string = LANE.WHALE
  ): Promise<TUserCountLimitMap> {
    const record = await UserModel.findOne({
      attributes: [...USER_COUNT_LIMIT_FIELDS, 'openid'],
      where: {
        openid,
        lane,
      },
      raw: true,
    });
    if (!record) {
      throw new Error('user_not_existed');
    }
    const result = this.normalizeCountLimitMap(
      record as unknown as Record<string, unknown>
    );
    const needInit = USER_COUNT_LIMIT_FIELDS.some(
      field => record[field] === null || record[field] === undefined
    );
    if (needInit) {
      return this.initializeUserCountLimits(openid, lane);
    }
    return result;
  }

  /**
   * 判断某个 count 是否有余量
   */
  async assertCountLimitAvailable(
    openid: string,
    lane: string,
    limitField: TUserCountLimitField
  ): Promise<number> {
    const remainCount = await this.getRemainCountValue(
      openid,
      lane,
      limitField
    );
    if (remainCount <= 0) {
      throw new Error(`${limitField}_is_used_up`);
    }
    return remainCount;
  }

  /**
   * 调用成功后对次数 -1，仅在余量大于 0 时才会真正扣减
   */
  async consumeCountLimit(
    openid: string,
    lane: string,
    limitField: TUserCountLimitField
  ): Promise<number> {
    const remainCount = await this.getRemainCountValue(
      openid,
      lane,
      limitField
    );
    if (remainCount <= 0) {
      throw new Error(`${limitField}_is_used_up`);
    }
    const [affectedCount] = await UserModel.update(
      {
        [limitField]: Sequelize.literal(`${limitField} - 1`),
      },
      {
        where: {
          openid,
          lane,
          [limitField]: {
            [Op.gt]: 0,
          },
        },
      }
    );
    if (affectedCount !== 1) {
      throw new Error(`${limitField}_is_used_up`);
    }
    return remainCount - 1;
  }

  private async getRemainCountValue(
    openid: string,
    lane: string,
    limitField: TUserCountLimitField
  ): Promise<number> {
    const record = await UserModel.findOne({
      attributes: [limitField, 'openid'],
      where: {
        openid,
        lane,
      },
      raw: true,
    });
    if (!record) {
      throw new Error('user_not_existed');
    }
    const currentValue = (record as unknown as Record<string, unknown>)[
      limitField
    ];
    if (currentValue === null || currentValue === undefined) {
      await this.initializeUserCountLimits(openid, lane);
      return DEFAULT_USER_COUNT_LIMIT;
    }
    return Number(currentValue);
  }

  private normalizeCountLimitMap(
    record: Record<string, unknown>
  ): TUserCountLimitMap {
    return USER_COUNT_LIMIT_FIELDS.reduce((result, field) => {
      result[field] =
        record[field] === null || record[field] === undefined
          ? DEFAULT_USER_COUNT_LIMIT
          : Number(record[field]);
      return result;
    }, {} as TUserCountLimitMap);
  }
}
