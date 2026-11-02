import { Singleton } from '@midwayjs/core';
import { Op, Transaction } from 'sequelize';
import { isVipActive, VIP_ORDER_STATUS, VipMemberType } from '../core/vip';
import { VipOrderModel } from '../model/VipOrderModel';

const PLAN_MEMBER_TYPES: Record<string, VipMemberType> = {
  month: 'monthly',
  quarter: 'quarterly',
  year: 'yearly',
  guest: 'guest',
  infinity: 'infinity',
};

const VIP_TYPE_NAMES: Record<string, string> = {
  guest: '体验会员',
  monthly: '月卡会员',
  quarterly: '季卡会员',
  yearly: '年卡会员',
  infinity: '永久会员',
  vip: '会员',
  svip: '会员',
};

export interface VipMembershipInfo {
  order: VipOrderModel;
  type: string;
  name: string;
  active: boolean;
  available_start: Date | null;
  available_end: Date | null;
}

@Singleton()
export class VipMembershipService {
  async getCurrentMembership(
    openid: string,
    options: {
      transaction?: Transaction;
      lock?: boolean;
      includeExpired?: boolean;
      now?: Date;
    } = {}
  ): Promise<VipMembershipInfo | null> {
    const infinityOrder = await VipOrderModel.findOne({
      where: {
        user_id: openid,
        plan_id: 'infinity',
        status: {
          [Op.in]: [VIP_ORDER_STATUS.PAID, VIP_ORDER_STATUS.GRANTED],
        },
      },
      order: [['id', 'DESC']],
      transaction: options.transaction,
      lock: options.lock,
    });
    if (infinityOrder) {
      return this.toMembershipInfo(infinityOrder, options.now);
    }

    const order = await VipOrderModel.findOne({
      where: {
        user_id: openid,
        status: {
          [Op.in]: [VIP_ORDER_STATUS.PAID, VIP_ORDER_STATUS.GRANTED],
        },
      },
      order: [
        ['paid_at', 'DESC'],
        ['id', 'DESC'],
      ],
      transaction: options.transaction,
      lock: options.lock,
    });
    if (!order) {
      return null;
    }
    const info = this.toMembershipInfo(order, options.now);
    if (!options.includeExpired && !info.active) {
      return null;
    }
    return info;
  }

  toMembershipInfo(order: VipOrderModel, now = new Date()): VipMembershipInfo {
    const snapshot = this.parsePlanSnapshot(order.plan_snapshot);
    const type = this.getMemberType(snapshot, order.plan_id);
    const start = order.membership_start_at
      ? new Date(order.membership_start_at)
      : null;
    const end = order.membership_end_at
      ? new Date(order.membership_end_at)
      : null;
    return {
      order,
      type,
      name: String(snapshot.name || VIP_TYPE_NAMES[type] || ''),
      active: isVipActive(type, end, now),
      available_start: start,
      available_end: end,
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

  private getMemberType(snapshot: Record<string, any>, planId: string) {
    return String(
      snapshot.memberType ||
        snapshot.member_type ||
        PLAN_MEMBER_TYPES[planId] ||
        'vip'
    );
  }
}
