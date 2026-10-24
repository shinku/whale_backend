import { Inject, Provide } from '@midwayjs/core';
import { randomInt } from 'crypto';
import { Op, Transaction } from 'sequelize';
import { BusinessError } from '../core/errors';
import {
  calculateMembershipExtension,
  isActiveMemberType,
  isVipMemberType,
  VIP_ORDER_STATUS,
  VIP_PLAN_DEFINITIONS,
  VIP_REFUND_STATUS,
  VipMemberType,
} from '../core/vip';
import { UserVipModel } from '../model/UserVipModel';
import { VipOrderModel } from '../model/VipOrderModel';
import { VipPlanModel } from '../model/VipPlanModel';
import { VipRefundModel } from '../model/VipRefundModel';
import { VipTransactionModel } from '../model/VipTransactionModel';
import { WxPayService, WxRefundResource, WxTransaction } from './WxPayService';

interface PlanSnapshot {
  planId: string;
  name: string;
  memberType: VipMemberType;
  durationDays: number;
  priceCents: number;
}

const GUEST_VALIDITY_DAYS = 7;
const DUPLICATE_ORDER_WINDOW_MS = 10 * 1000;
const ACTIVE_QUERY_DELAY_MS = 3 * 1000;
const ORDER_CLOSE_AFTER_MS = 2 * 60 * 60 * 1000;
const REFUND_QUERY_DELAY_MS = 30 * 1000;
const PLAN_MEMBER_TYPES: Record<string, string> = {
  month: 'monthly',
  quarter: 'quarterly',
  year: 'yearly',
};

@Provide()
export class VipService {
  @Inject()
  wxPayService!: WxPayService;

  async ensureDefaultPlans() {
    await VipPlanModel.bulkCreate(
      VIP_PLAN_DEFINITIONS.map(plan => ({
        ...plan,
        enabled: true,
      })),
      {
        ignoreDuplicates: true,
      }
    );
  }

  async listPlans() {
    await this.ensureDefaultPlans();
    const rows = await VipPlanModel.findAll({
      where: {
        enabled: true,
      },
      order: [
        ['sort', 'ASC'],
        ['id', 'ASC'],
      ],
    });
    return rows.map(row => ({
      id: row.plan_id,
      name: row.name,
      durationDays: Number(row.duration_days),
      priceCents: Number(row.price_cents),
      originalPriceCents: Number(row.original_price_cents),
      badge: row.badge || '',
      description: row.description || '',
      recommended: Boolean(row.recommended),
    }));
  }

  async userVipInitializatin(openid: string) {
    const now = new Date();
    const [record] = await UserVipModel.findOrCreate({
      where: {
        user_id: openid,
      },
      defaults: {
        user_id: openid,
        type: 'guest',
        available_start: now,
        available_end: new Date(
          now.getTime() + GUEST_VALIDITY_DAYS * 24 * 60 * 60 * 1000
        ),
      },
    });
    return this.toVipInfo(record, now);
  }

  async getVipInfo(openid: string) {
    const orders = await VipOrderModel.findAll({
      where: {
        user_id: openid,
        status: VIP_ORDER_STATUS.PAID,
      },
      order: [
        ['paid_at', 'DESC'],
        ['id', 'DESC'],
      ],
    });
    if (orders.length > 0) {
      return orders
        .map(order => this.toVipInfoFromOrder(order))
        .filter(vip => vip.active);
    }
    await this.userVipInitializatin(openid);
    return [];
  }

  async createOrder(
    openid: string,
    input: { planId?: string; quantity?: number }
  ) {
    if (input.quantity !== undefined && Number(input.quantity) !== 1) {
      throw new BusinessError('本期仅支持单份购买');
    }
    if (!input.planId || typeof input.planId !== 'string') {
      throw new BusinessError('请选择会员套餐');
    }
    const pendingRefund = await VipRefundModel.findOne({
      where: {
        user_id: openid,
        status: {
          [Op.in]: [VIP_REFUND_STATUS.CREATING, VIP_REFUND_STATUS.PROCESSING],
        },
      },
    });
    if (pendingRefund) {
      throw new BusinessError('退款处理中，请完成后再购买');
    }
    await this.ensureDefaultPlans();
    const plan = await VipPlanModel.findOne({
      where: {
        plan_id: input.planId,
        enabled: true,
      },
    });
    const memberType = plan?.member_type;
    if (!plan || !memberType || !isVipMemberType(memberType)) {
      throw new BusinessError('套餐已下架');
    }
    const durationDays = Number(plan.duration_days);
    const priceCents = Number(plan.price_cents);
    if (
      !Number.isInteger(durationDays) ||
      durationDays <= 0 ||
      !Number.isInteger(priceCents) ||
      priceCents <= 0
    ) {
      console.error('[vipOrder] invalid plan config', {
        planId: plan.plan_id,
      });
      throw new BusinessError('套餐配置异常，请稍后重试', 503);
    }

    const recentOrder = await VipOrderModel.findOne({
      where: {
        user_id: openid,
        plan_id: plan.plan_id,
        status: VIP_ORDER_STATUS.PENDING,
        created_at: {
          [Op.gte]: new Date(Date.now() - DUPLICATE_ORDER_WINDOW_MS),
        },
      },
      order: [['created_at', 'DESC']],
    });
    if (recentOrder?.prepay_id) {
      return this.toOrderCreateResponse(recentOrder);
    }

    const snapshot: PlanSnapshot = {
      planId: plan.plan_id,
      name: plan.name,
      memberType,
      durationDays,
      priceCents,
    };
    const order = await this.createLocalOrder(openid, snapshot);

    try {
      const prepayId = await this.wxPayService.createJsapiOrder({
        outTradeNo: order.order_no,
        description: `鲸鱼会员-${snapshot.name}`,
        amountCents: snapshot.priceCents,
        openid,
      });
      order.prepay_id = prepayId;
      order.status = VIP_ORDER_STATUS.PENDING;
      order.last_wx_error_code = null;
      await order.save();
      return this.toOrderCreateResponse(order);
    } catch (error) {
      const code =
        error instanceof BusinessError
          ? error.code || 'WX_CREATE_ORDER_FAILED'
          : 'WX_CREATE_ORDER_FAILED';
      await VipOrderModel.update(
        {
          status: VIP_ORDER_STATUS.FAILED,
          last_wx_error_code: code.slice(0, 64),
        },
        {
          where: {
            id: order.id,
            status: VIP_ORDER_STATUS.CREATING,
          },
        }
      );
      console.warn('[vipOrder] create wx order failed', {
        orderNo: order.order_no,
        code,
      });
      throw error;
    }
  }

  async getOrderForUser(openid: string, orderNo: string) {
    let order = await VipOrderModel.findOne({
      where: {
        order_no: orderNo,
        user_id: openid,
      },
    });
    if (!order) {
      throw new BusinessError('订单不存在', 404);
    }

    if (
      order.status === VIP_ORDER_STATUS.PENDING &&
      Date.now() - new Date(order.created_at).getTime() > ACTIVE_QUERY_DELAY_MS
    ) {
      order = await this.queryAndSettleOrder(order, false);
    }
    return this.toOrderResponse(order);
  }

  async handlePaymentNotification(transaction: WxTransaction) {
    return this.settleVerifiedTransaction(transaction, 'CALLBACK');
  }

  async requestRefund(
    openid: string,
    orderNo: string,
    operatorId: string,
    reason = '管理员发起退款'
  ) {
    if (!orderNo) {
      throw new BusinessError('请指定需要退款的订单');
    }
    const existingRefund = await VipRefundModel.findOne({
      where: {
        order_no: orderNo,
        user_id: openid,
      },
      order: [['id', 'DESC']],
    });
    if (
      existingRefund &&
      [
        VIP_REFUND_STATUS.CREATING,
        VIP_REFUND_STATUS.PROCESSING,
        VIP_REFUND_STATUS.SUCCESS,
      ].includes(existingRefund.status as any)
    ) {
      return this.toRefundResponse(existingRefund);
    }

    const latestOrder = await this.findLatestPaidOrder(openid);
    if (!latestOrder || latestOrder.order_no !== orderNo) {
      throw new BusinessError('仅支持退款最新一笔有效购买记录', 409);
    }
    const membershipEnd = latestOrder.membership_end_at
      ? new Date(latestOrder.membership_end_at)
      : null;
    if (!membershipEnd || membershipEnd.getTime() <= Date.now()) {
      throw new BusinessError('最新一笔购买记录已过期，无法退款');
    }

    const outRefundNo = this.generateRefundNo();
    const refund = await VipRefundModel.create({
      out_refund_no: outRefundNo,
      order_no: latestOrder.order_no,
      user_id: openid,
      transaction_id: latestOrder.transaction_id as string,
      amount_cents: Number(latestOrder.amount_cents),
      total_cents: Number(latestOrder.amount_cents),
      currency: latestOrder.currency,
      status: VIP_REFUND_STATUS.CREATING,
      reason: reason.slice(0, 255),
      operator_id: operatorId.slice(0, 64),
      requested_at: new Date(),
    });

    try {
      const paymentTransaction = await VipTransactionModel.findOne({
        where: {
          order_no: latestOrder.order_no,
        },
      });
      if (paymentTransaction?.source === 'MANUAL') {
        const settled = await this.settleManualRefund(refund);
        return this.toRefundResponse(settled);
      }

      const result = await this.wxPayService.createRefund({
        outTradeNo: latestOrder.order_no,
        transactionId: latestOrder.transaction_id as string,
        outRefundNo,
        reason,
        amountCents: Number(latestOrder.amount_cents),
        totalCents: Number(latestOrder.amount_cents),
      });
      if (result.out_refund_no && result.out_refund_no !== outRefundNo) {
        throw new BusinessError('微信退款单号不一致', 502);
      }
      const status = this.normalizeRefundStatus(result.status);
      refund.wx_refund_id = result.refund_id || null;
      refund.status = status;
      refund.last_wx_error_code = null;
      refund.payload_summary = {
        refundId: result.refund_id || null,
        outRefundNo: result.out_refund_no || outRefundNo,
        status: result.status || '',
        successTime: result.success_time || null,
      };
      await refund.save();
      await latestOrder.update({
        refund_status: status,
      });
      if (status === VIP_REFUND_STATUS.SUCCESS) {
        const settled = await this.settleRefundSuccess(
          outRefundNo,
          result.refund_id || `WX-${outRefundNo}`,
          result.success_time ? new Date(result.success_time) : new Date(),
          refund.payload_summary
        );
        return this.toRefundResponse(settled);
      }
      return this.toRefundResponse(refund);
    } catch (error) {
      const code =
        error instanceof BusinessError
          ? error.code || 'WX_REFUND_FAILED'
          : 'WX_REFUND_FAILED';
      await refund.update({
        status: VIP_REFUND_STATUS.FAILED,
        last_wx_error_code: code.slice(0, 64),
      });
      await latestOrder.update({
        refund_status: VIP_REFUND_STATUS.FAILED,
      });
      console.warn('[vipRefund] request failed', {
        openid,
        orderNo,
        outRefundNo,
        code,
      });
      throw error;
    }
  }

  async handleRefundNotification(resource: WxRefundResource) {
    const { mchId } = this.wxPayService.getMerchantIdentity();
    if (!resource?.out_refund_no || resource.mchid !== mchId) {
      throw new BusinessError('微信退款回调商户信息校验失败', 400);
    }
    const refund = await VipRefundModel.findOne({
      where: {
        out_refund_no: resource.out_refund_no,
      },
    });
    if (!refund) {
      throw new BusinessError('退款明细不存在', 500);
    }
    if (
      resource.out_trade_no !== refund.order_no ||
      resource.transaction_id !== refund.transaction_id ||
      Number(resource.amount?.refund) !== Number(refund.amount_cents) ||
      Number(resource.amount?.total) !== Number(refund.total_cents) ||
      resource.amount?.currency !== refund.currency
    ) {
      console.error('[vipRefund] callback validation failed', {
        outRefundNo: refund.out_refund_no,
        orderNo: refund.order_no,
        status: resource.refund_status,
      });
      throw new BusinessError('微信退款回调信息校验失败', 400);
    }

    const payload = {
      refundId: resource.refund_id,
      outRefundNo: resource.out_refund_no,
      refundStatus: resource.refund_status,
      successTime: resource.success_time || null,
      amountCents: Number(resource.amount.refund),
      totalCents: Number(resource.amount.total),
    };
    if (resource.refund_status === 'SUCCESS') {
      const succeededAt = resource.success_time
        ? new Date(resource.success_time)
        : new Date();
      return this.settleRefundSuccess(
        refund.out_refund_no,
        resource.refund_id,
        succeededAt,
        payload
      );
    }

    const status = this.normalizeRefundStatus(resource.refund_status);
    await refund.update({
      wx_refund_id: resource.refund_id || refund.wx_refund_id,
      status,
      payload_summary: payload,
    });
    await VipOrderModel.update(
      {
        refund_status: status,
      },
      {
        where: {
          order_no: refund.order_no,
        },
      }
    );
    return refund;
  }

  async syncPendingRefunds() {
    const refunds = await VipRefundModel.findAll({
      where: {
        status: {
          [Op.in]: [VIP_REFUND_STATUS.CREATING, VIP_REFUND_STATUS.PROCESSING],
        },
        requested_at: {
          [Op.lt]: new Date(Date.now() - REFUND_QUERY_DELAY_MS),
        },
      },
      order: [['requested_at', 'ASC']],
      limit: 50,
    });
    for (const refund of refunds) {
      try {
        const result = await this.wxPayService.queryRefund(
          refund.out_refund_no
        );
        const status = this.normalizeRefundStatus(result.status);
        if (status === VIP_REFUND_STATUS.SUCCESS) {
          await this.settleRefundSuccess(
            refund.out_refund_no,
            result.refund_id || refund.wx_refund_id || '',
            result.success_time ? new Date(result.success_time) : new Date(),
            {
              refundId: result.refund_id || null,
              outRefundNo: result.out_refund_no || refund.out_refund_no,
              refundStatus: result.status || '',
              successTime: result.success_time || null,
            }
          );
        } else {
          await refund.update({
            wx_refund_id: result.refund_id || refund.wx_refund_id,
            status,
          });
          await VipOrderModel.update(
            {
              refund_status: status,
            },
            {
              where: {
                order_no: refund.order_no,
              },
            }
          );
        }
      } catch (error) {
        const code =
          error instanceof BusinessError
            ? error.code || 'WX_REFUND_QUERY_FAILED'
            : 'WX_REFUND_QUERY_FAILED';
        console.warn('[vipRefund] active query failed', {
          outRefundNo: refund.out_refund_no,
          orderNo: refund.order_no,
          code,
        });
      }
    }
    return refunds.length;
  }

  async queryAndSettleOrder(order: VipOrderModel, throwOnError = true) {
    try {
      const transaction = await this.wxPayService.queryOrder(order.order_no);
      if (transaction.trade_state === 'SUCCESS') {
        await this.settleVerifiedTransaction(transaction, 'QUERY');
        return (await VipOrderModel.findByPk(order.id)) || order;
      }
      return order;
    } catch (error) {
      const code =
        error instanceof BusinessError
          ? error.code || 'WX_QUERY_FAILED'
          : 'WX_QUERY_FAILED';
      console.warn('[vipOrder] active query failed', {
        orderNo: order.order_no,
        code,
      });
      if (throwOnError) {
        throw error;
      }
      return order;
    }
  }

  async closeExpiredOrders() {
    const orders = await VipOrderModel.findAll({
      where: {
        status: VIP_ORDER_STATUS.PENDING,
        created_at: {
          [Op.lt]: new Date(Date.now() - ORDER_CLOSE_AFTER_MS),
        },
      },
      order: [['created_at', 'ASC']],
      limit: 100,
    });

    for (const order of orders) {
      try {
        const transaction = await this.wxPayService.queryOrder(order.order_no);
        if (transaction.trade_state === 'SUCCESS') {
          await this.settleVerifiedTransaction(transaction, 'QUERY');
          continue;
        }
        if (
          ['NOTPAY', 'CLOSED', 'REVOKED', 'PAYERROR'].includes(
            transaction.trade_state
          )
        ) {
          if (transaction.trade_state === 'NOTPAY') {
            await this.wxPayService.closeOrder(order.order_no);
          }
          await VipOrderModel.update(
            {
              status: VIP_ORDER_STATUS.CLOSED,
            },
            {
              where: {
                id: order.id,
                status: VIP_ORDER_STATUS.PENDING,
              },
            }
          );
        }
      } catch (error) {
        const code =
          error instanceof BusinessError
            ? error.code || 'WX_QUERY_FAILED'
            : 'WX_QUERY_FAILED';
        console.warn('[vipOrder] close check failed', {
          orderNo: order.order_no,
          code,
        });
      }
    }
    return orders.length;
  }

  async modifyVip(
    openid: string,
    type: VipMemberType = 'guest',
    startTime: Date | number,
    endTime: Date | number
  ) {
    const [record] = await UserVipModel.findOrCreate({
      where: {
        user_id: openid,
      },
      defaults: {
        user_id: openid,
        type,
        available_start: new Date(startTime),
        available_end: new Date(endTime),
      },
    });
    record.type = type;
    record.available_start = new Date(startTime);
    record.available_end = new Date(endTime);
    await record.save();
  }

  private async createLocalOrder(
    openid: string,
    snapshot: PlanSnapshot
  ): Promise<VipOrderModel> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const orderNo = this.generateOrderNo();
      try {
        return await VipOrderModel.create({
          order_no: orderNo,
          user_id: openid,
          plan_id: snapshot.planId,
          plan_snapshot: snapshot,
          amount_cents: snapshot.priceCents,
          currency: 'CNY',
          status: VIP_ORDER_STATUS.CREATING,
        });
      } catch (error: any) {
        if (error?.name !== 'SequelizeUniqueConstraintError') {
          throw error;
        }
      }
    }
    throw new BusinessError('订单号生成失败，请重试', 500);
  }

  private async settleVerifiedTransaction(
    transaction: WxTransaction,
    source: 'CALLBACK' | 'QUERY'
  ) {
    if (!transaction?.out_trade_no) {
      throw new BusinessError('微信交易缺少订单号', 400);
    }
    const order = await VipOrderModel.findOne({
      where: {
        order_no: transaction.out_trade_no,
      },
    });
    if (!order) {
      console.warn('[vipOrder] wx transaction has no local order', {
        orderNo: transaction.out_trade_no,
      });
      throw new BusinessError('本地订单不存在', 500);
    }
    this.assertWxTransactionMatches(order, transaction);
    if (order.status === VIP_ORDER_STATUS.PAID) {
      return order;
    }
    if (order.status !== VIP_ORDER_STATUS.PENDING) {
      console.warn('[vipOrder] illegal wx success state transition', {
        orderNo: order.order_no,
        status: order.status,
      });
      throw new BusinessError('订单状态不允许入账', 500);
    }

    const dbTransaction = await VipOrderModel.sequelize.transaction();
    try {
      const lockedOrder = await VipOrderModel.findOne({
        where: {
          id: order.id,
        },
        transaction: dbTransaction,
        lock: true,
      });
      if (!lockedOrder) {
        throw new BusinessError('本地订单不存在', 500);
      }
      if (lockedOrder.status === VIP_ORDER_STATUS.PAID) {
        await dbTransaction.commit();
        return lockedOrder;
      }
      if (lockedOrder.status !== VIP_ORDER_STATUS.PENDING) {
        throw new BusinessError('订单状态不允许入账', 500);
      }
      this.assertWxTransactionMatches(lockedOrder, transaction);
      await this.grantMembership(
        lockedOrder,
        transaction,
        source,
        dbTransaction
      );
      await dbTransaction.commit();
      return lockedOrder;
    } catch (error) {
      await dbTransaction.rollback();
      throw error;
    }
  }

  private async grantMembership(
    order: VipOrderModel,
    transaction: WxTransaction,
    source: 'CALLBACK' | 'QUERY',
    dbTransaction: Transaction
  ) {
    const snapshot = order.plan_snapshot as unknown as PlanSnapshot;
    if (
      !snapshot ||
      !isVipMemberType(snapshot.memberType) ||
      !Number.isInteger(Number(snapshot.durationDays)) ||
      Number(snapshot.durationDays) <= 0
    ) {
      throw new BusinessError('订单套餐快照损坏', 500);
    }

    const [vipRecord] = await UserVipModel.findOrCreate({
      where: {
        user_id: order.user_id,
      },
      defaults: {
        user_id: order.user_id,
        type: 'guest',
        available_start: new Date(),
        available_end: new Date(),
      },
      transaction: dbTransaction,
    });
    await vipRecord.reload({
      transaction: dbTransaction,
      lock: true,
    });
    const previousOrder = await VipOrderModel.findOne({
      where: {
        user_id: order.user_id,
        status: VIP_ORDER_STATUS.PAID,
      },
      order: [
        ['paid_at', 'DESC'],
        ['id', 'DESC'],
      ],
      transaction: dbTransaction,
      lock: true,
    });
    const previousSnapshot = previousOrder
      ? this.parsePlanSnapshot(previousOrder.plan_snapshot)
      : {};
    const previousMemberType =
      typeof previousSnapshot.memberType === 'string'
        ? previousSnapshot.memberType
        : vipRecord.type;
    const previousStart = previousOrder?.membership_start_at
      ? new Date(previousOrder.membership_start_at)
      : vipRecord.available_start;
    const previousEnd = previousOrder?.membership_end_at
      ? new Date(previousOrder.membership_end_at)
      : vipRecord.available_end;
    const now = new Date();
    const extension = calculateMembershipExtension(
      previousMemberType,
      previousStart,
      previousEnd,
      Number(snapshot.durationDays),
      now
    );
    const paidAt = transaction.success_time
      ? new Date(transaction.success_time)
      : now;
    if (Number.isNaN(paidAt.getTime())) {
      throw new BusinessError('微信支付成功时间格式错误', 400);
    }

    await vipRecord.update(
      {
        type: snapshot.memberType,
        available_start: extension.membershipStart,
        available_end: extension.membershipEnd,
      },
      {
        transaction: dbTransaction,
      }
    );
    await order.update(
      {
        status: VIP_ORDER_STATUS.PAID,
        transaction_id: transaction.transaction_id,
        paid_at: paidAt,
        membership_start_at: extension.membershipStart,
        membership_end_at: extension.membershipEnd,
        last_wx_error_code: null,
      },
      {
        transaction: dbTransaction,
      }
    );
    await VipTransactionModel.findOrCreate({
      where: {
        order_no: order.order_no,
      },
      defaults: {
        order_no: order.order_no,
        user_id: order.user_id,
        transaction_id: transaction.transaction_id as string,
        trade_state: transaction.trade_state,
        amount_cents: Number(transaction.amount.total),
        currency: transaction.amount.currency,
        source,
        payload_summary: {
          appid: transaction.appid,
          mchid: transaction.mchid,
          outTradeNo: transaction.out_trade_no,
          transactionId: transaction.transaction_id,
          tradeState: transaction.trade_state,
          amountCents: Number(transaction.amount.total),
          successTime: transaction.success_time || paidAt.toISOString(),
        },
        paid_at: paidAt,
      },
      transaction: dbTransaction,
    });
  }

  private async settleManualRefund(refund: VipRefundModel) {
    const succeededAt = new Date();
    const payload = {
      manualRefund: true,
      outRefundNo: refund.out_refund_no,
      refundStatus: VIP_REFUND_STATUS.SUCCESS,
      successTime: succeededAt.toISOString(),
      amountCents: Number(refund.amount_cents),
      totalCents: Number(refund.total_cents),
    };
    return this.settleRefundSuccess(
      refund.out_refund_no,
      `MANUAL-${refund.out_refund_no}`,
      succeededAt,
      payload
    );
  }

  private async settleRefundSuccess(
    outRefundNo: string,
    wxRefundId: string,
    succeededAt: Date,
    payload: Record<string, any>
  ) {
    if (Number.isNaN(succeededAt.getTime())) {
      throw new BusinessError('微信退款成功时间格式错误', 400);
    }
    const dbTransaction = await VipOrderModel.sequelize.transaction();
    try {
      const refund = await VipRefundModel.findOne({
        where: {
          out_refund_no: outRefundNo,
        },
        transaction: dbTransaction,
        lock: true,
      });
      if (!refund) {
        throw new BusinessError('退款明细不存在', 500);
      }
      if (refund.status === VIP_REFUND_STATUS.SUCCESS) {
        await dbTransaction.commit();
        return refund;
      }
      const order = await VipOrderModel.findOne({
        where: {
          order_no: refund.order_no,
        },
        transaction: dbTransaction,
        lock: true,
      });
      if (!order) {
        throw new BusinessError('退款关联订单不存在', 500);
      }

      await refund.update(
        {
          wx_refund_id: wxRefundId || refund.wx_refund_id,
          status: VIP_REFUND_STATUS.SUCCESS,
          succeeded_at: succeededAt,
          payload_summary: payload,
          last_wx_error_code: null,
        },
        {
          transaction: dbTransaction,
        }
      );
      await order.update(
        {
          status: VIP_ORDER_STATUS.REFUNDED,
          refund_status: VIP_REFUND_STATUS.SUCCESS,
        },
        {
          transaction: dbTransaction,
        }
      );
      await this.refreshUserVipFromOrders(order.user_id, dbTransaction);
      await dbTransaction.commit();
      return refund;
    } catch (error) {
      await dbTransaction.rollback();
      throw error;
    }
  }

  private async refreshUserVipFromOrders(
    openid: string,
    dbTransaction: Transaction
  ) {
    const latestOrder = await VipOrderModel.findOne({
      where: {
        user_id: openid,
        status: VIP_ORDER_STATUS.PAID,
      },
      order: [
        ['paid_at', 'DESC'],
        ['id', 'DESC'],
      ],
      transaction: dbTransaction,
      lock: true,
    });
    const [vipRecord] = await UserVipModel.findOrCreate({
      where: {
        user_id: openid,
      },
      defaults: {
        user_id: openid,
        type: 'guest',
        available_start: new Date(),
        available_end: new Date(),
      },
      transaction: dbTransaction,
    });
    await vipRecord.reload({
      transaction: dbTransaction,
      lock: true,
    });

    if (!latestOrder) {
      const now = new Date();
      await vipRecord.update(
        {
          type: 'guest',
          available_start: now,
          available_end: now,
        },
        {
          transaction: dbTransaction,
        }
      );
      return;
    }
    const snapshot = this.parsePlanSnapshot(latestOrder.plan_snapshot);
    const memberType = this.getMemberType(snapshot, latestOrder.plan_id);
    const start = latestOrder.membership_start_at
      ? new Date(latestOrder.membership_start_at)
      : latestOrder.paid_at
      ? new Date(latestOrder.paid_at)
      : new Date();
    const end = latestOrder.membership_end_at
      ? new Date(latestOrder.membership_end_at)
      : new Date();
    await vipRecord.update(
      {
        type: memberType,
        available_start: start,
        available_end: end,
      },
      {
        transaction: dbTransaction,
      }
    );
  }

  private findLatestPaidOrder(openid: string) {
    return VipOrderModel.findOne({
      where: {
        user_id: openid,
        status: VIP_ORDER_STATUS.PAID,
      },
      order: [
        ['paid_at', 'DESC'],
        ['id', 'DESC'],
      ],
    });
  }

  private toVipInfoFromOrder(order: VipOrderModel) {
    const snapshot = this.parsePlanSnapshot(order.plan_snapshot);
    const type = this.getMemberType(snapshot, order.plan_id);
    const start = order.membership_start_at
      ? new Date(order.membership_start_at)
      : null;
    const end = order.membership_end_at
      ? new Date(order.membership_end_at)
      : null;
    return {
      type,
      name: String(snapshot.name || ''),
      active:
        isActiveMemberType(type) && end !== null && end.getTime() > Date.now(),
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
    const memberType = String(
      snapshot.memberType ||
        snapshot.member_type ||
        PLAN_MEMBER_TYPES[planId] ||
        'vip'
    );
    return memberType;
  }

  private normalizeRefundStatus(status: string | undefined) {
    return (
      {
        SUCCESS: VIP_REFUND_STATUS.SUCCESS,
        PROCESSING: VIP_REFUND_STATUS.PROCESSING,
        ABNORMAL: VIP_REFUND_STATUS.ABNORMAL,
        CLOSED: VIP_REFUND_STATUS.CLOSED,
      }[status || ''] || VIP_REFUND_STATUS.FAILED
    );
  }

  private toRefundResponse(refund: VipRefundModel) {
    return {
      data: {
        orderNo: refund.order_no,
        outRefundNo: refund.out_refund_no,
        status: refund.status.toLowerCase(),
        amountCents: Number(refund.amount_cents),
      },
    };
  }

  private assertWxTransactionMatches(
    order: VipOrderModel,
    transaction: WxTransaction
  ) {
    const { appId, mchId } = this.wxPayService.getMerchantIdentity();
    const payerOpenid = transaction.payer?.openid;
    const invalid =
      !transaction.transaction_id ||
      transaction.trade_state !== 'SUCCESS' ||
      transaction.appid !== appId ||
      transaction.mchid !== mchId ||
      transaction.out_trade_no !== order.order_no ||
      (payerOpenid !== undefined && payerOpenid !== order.user_id) ||
      Number(transaction.amount?.total) !== Number(order.amount_cents) ||
      transaction.amount?.currency !== 'CNY' ||
      order.currency !== 'CNY';
    if (invalid) {
      console.error('[vipOrder] wx transaction validation failed', {
        orderNo: order.order_no,
        tradeState: transaction.trade_state,
      });
      throw new BusinessError('微信支付交易信息校验失败', 400);
    }
  }

  private toVipInfo(record: UserVipModel, now = new Date()) {
    const end = record.available_end ? new Date(record.available_end) : null;
    const active =
      isActiveMemberType(record.type) &&
      end !== null &&
      end.getTime() > now.getTime();
    return {
      type: record.type,
      active,
      available_start: record.available_start
        ? new Date(record.available_start)
        : null,
      available_end: end,
    };
  }

  private toOrderCreateResponse(order: VipOrderModel) {
    if (!order.prepay_id) {
      throw new BusinessError('订单预支付信息不存在', 500);
    }
    return {
      data: {
        orderNo: order.order_no,
        status: order.status.toLowerCase(),
        amountCents: Number(order.amount_cents),
        payment: this.wxPayService.buildMiniProgramPayParams(order.prepay_id),
      },
    };
  }

  private toOrderResponse(order: VipOrderModel) {
    return {
      data: {
        orderNo: order.order_no,
        status: order.status.toLowerCase(),
        amountCents: Number(order.amount_cents),
      },
    };
  }

  private generateOrderNo() {
    const shanghaiSeconds = new Date(Date.now() + 8 * 60 * 60 * 1000);
    const dateText =
      String(shanghaiSeconds.getUTCFullYear()) +
      String(shanghaiSeconds.getUTCMonth() + 1).padStart(2, '0') +
      String(shanghaiSeconds.getUTCDate()).padStart(2, '0') +
      String(shanghaiSeconds.getUTCHours()).padStart(2, '0') +
      String(shanghaiSeconds.getUTCMinutes()).padStart(2, '0') +
      String(shanghaiSeconds.getUTCSeconds()).padStart(2, '0');
    return `VIP${dateText}${String(randomInt(0, 1_000_000)).padStart(6, '0')}`;
  }

  private generateRefundNo() {
    const shanghaiSeconds = new Date(Date.now() + 8 * 60 * 60 * 1000);
    const dateText =
      String(shanghaiSeconds.getUTCFullYear()) +
      String(shanghaiSeconds.getUTCMonth() + 1).padStart(2, '0') +
      String(shanghaiSeconds.getUTCDate()).padStart(2, '0') +
      String(shanghaiSeconds.getUTCHours()).padStart(2, '0') +
      String(shanghaiSeconds.getUTCMinutes()).padStart(2, '0') +
      String(shanghaiSeconds.getUTCSeconds()).padStart(2, '0');
    return `VR${dateText}${String(randomInt(0, 1_000_000)).padStart(6, '0')}`;
  }
}
