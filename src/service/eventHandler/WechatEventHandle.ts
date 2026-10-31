import { Provide } from '@midwayjs/core';
import { BusinessError } from '../../core/errors';
import { WechatMessagePushRecordModel } from '../../model/WechatMessagePushRecordModel';

type WechatMessage = Record<string, any>;

export interface VipPurchaseEvent {
  openid: string;
  productId: string;
  quantity: number;
  outTradeNo: string;
  env: 0 | 1;
  paidTime?: number;
  originalPrice?: number;
  actualPrice?: number;
  attach?: string;
  mchOrderNo?: string;
  transactionId?: string;
}

interface EventHandlerResult {
  vipPurchase?: VipPurchaseEvent;
}

type MessageEventHandler = (
  message: WechatMessage
) => Promise<EventHandlerResult>;

@Provide()
export class WechatEventHandle {
  async handle(message: WechatMessage) {
    const eventName = this.optionalString(message.Event);
    const record = await WechatMessagePushRecordModel.create({
      event_name: eventName,
      openid:
        this.optionalString(message.OpenId) ||
        this.optionalString(message.FromUserName),
      out_trade_no: this.optionalString(message.OutTradeNo),
      env: this.optionalEnv(message.Env),
      content: JSON.stringify(message, null, 2),
      status: 'RECEIVED',
    });

    const handler = eventName ? this.handlers[eventName] : undefined;
    if (!handler) {
      await record.update({ status: 'IGNORED' });
      return;
    }

    try {
      const result = await handler.call(this, message);
      await record.update({
        status: 'PROCESSED',
        product_id: result.vipPurchase?.productId || null,
        quantity: result.vipPurchase?.quantity || null,
        error_message: null,
      });
    } catch (error) {
      await record.update({
        status: 'FAILED',
        error_message:
          error instanceof Error ? error.message : '消息事件处理失败',
      });
      throw error;
    }
  }

  private get handlers(): Record<string, MessageEventHandler> {
    return {
      xpay_goods_deliver_notify: this.xpayGoodsDeliverNotify,
    };
  }

  private async xpayGoodsDeliverNotify(
    message: WechatMessage
  ): Promise<EventHandlerResult> {
    const goodsInfo = this.requireObject(message.GoodsInfo, 'GoodsInfo');
    const wechatPayInfo = this.optionalObject(message.WeChatPayInfo);
    const event: VipPurchaseEvent = {
      openid: this.requireString(message.OpenId, 'OpenId'),
      productId: this.requireString(goodsInfo.ProductId, 'GoodsInfo.ProductId'),
      quantity: this.requirePositiveInteger(
        goodsInfo.Quantity,
        'GoodsInfo.Quantity'
      ),
      outTradeNo: this.requireString(message.OutTradeNo, 'OutTradeNo'),
      env: this.requireEnv(message.Env),
      paidTime: this.optionalNumber(wechatPayInfo?.PaidTime),
      originalPrice: this.optionalNumber(goodsInfo.OrigPrice),
      actualPrice: this.optionalNumber(goodsInfo.ActualPrice),
      attach: this.optionalString(goodsInfo.Attach),
      mchOrderNo: this.optionalString(wechatPayInfo?.MchOrderNo),
      transactionId: this.optionalString(wechatPayInfo?.TransactionId),
    };

    await this.onVipPurchaseEvent(event);
    return { vipPurchase: event };
  }

  /**
   * VIP 套餐映射、订单确认和权益幂等发放尚未确定。
   * 后续应基于 outTradeNo 实现幂等处理。
   */
  protected async onVipPurchaseEvent(event: VipPurchaseEvent) {
    void event;
  }

  private requireObject(value: unknown, field: string) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new BusinessError(`消息推送缺少 ${field}`, 400);
    }
    return value as Record<string, any>;
  }

  private optionalObject(value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return undefined;
    }
    return value as Record<string, any>;
  }

  private requireString(value: unknown, field: string) {
    const result = this.optionalString(value);
    if (!result) {
      throw new BusinessError(`消息推送缺少 ${field}`, 400);
    }
    return result;
  }

  private optionalString(value: unknown) {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }

  private requireEnv(value: unknown): 0 | 1 {
    if (value !== 0 && value !== 1) {
      throw new BusinessError('消息推送 Env 无效', 400);
    }
    return value;
  }

  private optionalEnv(value: unknown) {
    return value === 0 || value === 1 ? value : null;
  }

  private requirePositiveInteger(value: unknown, field: string) {
    if (
      typeof value !== 'number' ||
      !Number.isSafeInteger(value) ||
      value <= 0
    ) {
      throw new BusinessError(`消息推送 ${field} 无效`, 400);
    }
    return value;
  }

  private optionalNumber(value: unknown) {
    return typeof value === 'number' && Number.isFinite(value)
      ? value
      : undefined;
  }
}
