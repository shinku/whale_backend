import { Provide } from '@midwayjs/core';
import { Op, Sequelize } from 'sequelize';
import { LANE } from '../core/enums';
import {
  DEFAULT_USER_COUNT_LIMIT,
  USER_COUNT_LIMIT_FIELDS,
  USER_TIME_DATE_LIMIT_TYPE,
  TUserCountLimitField,
} from '../core/limits';
import { IUserOptions } from '../interface';
import { UserLimitModel } from '../model/UserLimitModel';
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
   * 设置 time_date 类型的过期时间
   * - 无过期时间：当前时间 + days
   * - 已有过期时间且未到期：原过期时间 + days
   * - 已有过期时间但已到期：当前时间 + days
   */
  async setLimitDate(openid: string, days: number, lane: string = LANE.WHALE) {
    if (!days || days <= 0) {
      throw new Error('days_is_invalid');
    }
    await this.assertUserExisted(openid, lane);
    const [row, created] = await UserLimitModel.findOrCreate({
      where: {
        user_id: openid,
        lane,
        limit_type: USER_TIME_DATE_LIMIT_TYPE,
      },
      defaults: {
        user_id: openid,
        lane,
        limit_type: USER_TIME_DATE_LIMIT_TYPE,
        limit_count: null,
      },
    });
    const dayMilliseconds = days * 24 * 60 * 60 * 1000;
    const now = Date.now();
    const currentLimitTime = row.limit_date
      ? new Date(row.limit_date).getTime()
      : null;
    const baseTime =
      currentLimitTime !== null && currentLimitTime > now
        ? currentLimitTime
        : now;
    const limitDate = new Date(baseTime + dayMilliseconds);
    await row.update({
      limit_date: limitDate,
      // time_date 行不使用次数
      limit_count: null,
    });
    return {
      user_id: openid,
      lane,
      limit_type: USER_TIME_DATE_LIMIT_TYPE,
      limit_date: limitDate,
      created,
    };
  }

  /**
   * countlimit 初始化：
   * 在 user_limit_table 中按 limit_type 为每个 count 字段创建/补齐一行，
   * 新用户默认值当前均为 10
   */
  async initializeUserCountLimits(
    openid: string,
    lane: string = LANE.WHALE,
    created = false
  ): Promise<TUserCountLimitMap> {
    await this.assertUserExisted(openid, lane);
    const existingRows = await UserLimitModel.findAll({
      where: {
        user_id: openid,
        lane,
        limit_type: {
          [Op.in]: [...USER_COUNT_LIMIT_FIELDS],
        },
      },
    });
    const rowByType = new Map(existingRows.map(row => [row.limit_type, row]));
    for (const limitType of USER_COUNT_LIMIT_FIELDS) {
      const row = rowByType.get(limitType);
      if (!row) {
        await UserLimitModel.create({
          user_id: openid,
          lane,
          limit_type: limitType,
          limit_count: DEFAULT_USER_COUNT_LIMIT,
        });
      } else if (
        created ||
        row.limit_count === null ||
        row.limit_count === undefined
      ) {
        await row.update({
          limit_count: DEFAULT_USER_COUNT_LIMIT,
        });
      }
    }
    const rows = await this.findCountLimitRows(openid, lane);
    return this.buildCountLimitMap(rows);
  }

  /**
   * 查询用户所有 countlimit 剩余次数，缺行的类型会自动补齐
   */
  async getUserCountLimitMap(
    openid: string,
    lane: string = LANE.WHALE
  ): Promise<TUserCountLimitMap> {
    await this.assertUserExisted(openid, lane);
    const rows = await this.findCountLimitRows(openid, lane);
    const rowByType = new Map(rows.map(row => [row.limit_type, row]));
    const hasAllLimitTypes = USER_COUNT_LIMIT_FIELDS.every(
      limitType => rowByType.get(limitType)?.limit_count != null
    );
    if (!hasAllLimitTypes) {
      return this.initializeUserCountLimits(openid, lane);
    }
    return this.buildCountLimitMap(rows);
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
    const [affectedCount] = await UserLimitModel.update(
      {
        limit_count: Sequelize.literal('limit_count - 1'),
      },
      {
        where: {
          user_id: openid,
          lane,
          limit_type: limitField,
          limit_count: {
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

  private async assertUserExisted(openid: string, lane: string) {
    const user = await UserModel.findOne({
      where: {
        openid,
        lane,
      },
      attributes: ['openid'],
      raw: true,
    });
    if (!user) {
      throw new Error('user_not_existed');
    }
  }

  private async getRemainCountValue(
    openid: string,
    lane: string,
    limitField: TUserCountLimitField
  ): Promise<number> {
    await this.assertUserExisted(openid, lane);
    const row = await UserLimitModel.findOne({
      where: {
        user_id: openid,
        lane,
        limit_type: limitField,
      },
      raw: true,
    });
    if (!row) {
      await this.initializeUserCountLimits(openid, lane);
      return DEFAULT_USER_COUNT_LIMIT;
    }
    const currentValue = row.limit_count;
    if (currentValue === null || currentValue === undefined) {
      await this.initializeUserCountLimits(openid, lane);
      return DEFAULT_USER_COUNT_LIMIT;
    }
    return Number(currentValue);
  }

  private findCountLimitRows(openid: string, lane: string) {
    return UserLimitModel.findAll({
      where: {
        user_id: openid,
        lane,
        limit_type: {
          [Op.in]: [...USER_COUNT_LIMIT_FIELDS],
        },
      },
      raw: true,
    });
  }

  private buildCountLimitMap(rows: UserLimitModel[]): TUserCountLimitMap {
    const result = {} as TUserCountLimitMap;
    for (const limitType of USER_COUNT_LIMIT_FIELDS) {
      result[limitType] = DEFAULT_USER_COUNT_LIMIT;
    }
    for (const row of rows) {
      const limitType = row.limit_type;
      if (USER_COUNT_LIMIT_FIELDS.includes(limitType as TUserCountLimitField)) {
        result[limitType as TUserCountLimitField] = Number(row.limit_count);
      }
    }
    return result;
  }
}
