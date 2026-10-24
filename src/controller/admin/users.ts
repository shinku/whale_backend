import { Get, Inject, Provide } from '@midwayjs/core';
import { Context } from 'egg';
import { Op } from 'sequelize';
import { isActiveMemberType } from '../../core/vip';
import { UserModel } from '../../model/UserModel';
import { VipOrderModel } from '../../model/VipOrderModel';
import { AdminApi } from '../api/Api';

const PLAN_MEMBER_TYPES: Record<string, string> = {
  month: 'monthly',
  quarter: 'quarterly',
  year: 'yearly',
};

@AdminApi('/user')
@Provide()
export class UserController {
  @Inject()
  ctx!: Context;

  @Get('/')
  async getUsers() {
    const { limit = '20', offset = '0' } = this.ctx.query;
    const pageSize = Math.min(100, Math.max(1, Number(limit) || 20));
    const pageOffset = Math.max(0, Number(offset) || 0);
    const count = await UserModel.count({
      where: {},
    });
    const users = await UserModel.findAll({
      attributes: [
        'openid',
        'user_name',
        'user_mobile',
        'user_avator',
        'lane',
        'createdAt',
      ],
      where: {},
      order: [['createdAt', 'DESC']],
      limit: pageSize,
      offset: pageOffset,
      raw: true,
    });
    const list = await this.attachVipInfo(users as Array<Record<string, any>>);
    return {
      count,
      list,
    };
  }

  @Get('/:userid')
  async delUser() {
    const { userid } = this.ctx.params;
    const userInfos = await UserModel.findAll({
      attributes: [
        'openid',
        'user_name',
        'user_mobile',
        'user_avator',
        'lane',
        'createdAt',
      ],
      where: {
        openid: userid,
      },
      raw: true,
    });
    return {
      list: await this.attachVipInfo(userInfos as Array<Record<string, any>>),
    };
  }

  private async attachVipInfo(users: Array<Record<string, any>>) {
    if (users.length === 0) {
      return [];
    }
    const openids = users
      .map(user => user.openid)
      .filter((openid): openid is string => typeof openid === 'string');
    const orders = await VipOrderModel.findAll({
      attributes: [
        'user_id',
        'order_no',
        'plan_id',
        'plan_snapshot',
        'membership_start_at',
        'membership_end_at',
        'paid_at',
      ],
      where: {
        user_id: {
          [Op.in]: openids,
        },
        status: 'PAID',
      },
      order: [
        ['membership_end_at', 'DESC'],
        ['paid_at', 'DESC'],
      ],
      raw: true,
    });
    const latestOrderByUser = new Map<string, VipOrderModel>();
    for (const order of orders) {
      if (!latestOrderByUser.has(order.user_id)) {
        latestOrderByUser.set(order.user_id, order);
      }
    }

    const now = new Date();
    return users.map(user => {
      const order = latestOrderByUser.get(user.openid);
      const vipInfo = this.getVipInfoFromOrder(order, now);
      return {
        ...user,
        user_id: user.openid,
        ...vipInfo,
      };
    });
  }

  private getVipInfoFromOrder(order: VipOrderModel | undefined, now: Date) {
    if (!order) {
      return {
        vip_type: 'guest',
        vip_name: '非会员',
        vip_order_no: null,
        available_start: null,
        available_end: null,
        vip_active: false,
      };
    }
    const snapshot = this.parsePlanSnapshot(order.plan_snapshot);
    const vipType = String(
      snapshot.memberType ||
        snapshot.member_type ||
        PLAN_MEMBER_TYPES[order.plan_id] ||
        'vip'
    );
    const start = order.membership_start_at
      ? new Date(order.membership_start_at)
      : null;
    const end = order.membership_end_at
      ? new Date(order.membership_end_at)
      : null;
    return {
      vip_type: vipType,
      vip_name: String(snapshot.name || ''),
      vip_order_no: order.order_no,
      available_start: start,
      available_end: end,
      vip_active:
        isActiveMemberType(vipType) &&
        end !== null &&
        end.getTime() > now.getTime(),
    };
  }

  private parsePlanSnapshot(
    snapshot: VipOrderModel['plan_snapshot'] | string
  ): Record<string, any> {
    if (snapshot && typeof snapshot === 'object') {
      return snapshot;
    }
    if (typeof snapshot === 'string') {
      try {
        return JSON.parse(snapshot);
      } catch {
        return {};
      }
    }
    return {};
  }
}
