import { Inject, Post, Provide } from '@midwayjs/core';
import { Context } from 'egg';
import { BusinessError } from '../core/errors';
import { VipService } from '../service/VipService';
import { WxPayService } from '../service/WxPayService';
import Api from './api/Api';

@Provide()
@Api('/pay/wechat')
export class WechatPayController {
  @Inject()
  ctx!: Context;

  @Inject()
  wxPayService!: WxPayService;

  @Inject()
  vipService!: VipService;

  @Post('/notify/vip')
  async notifyVip() {
    const rawBody = this.getRawBody();
    const notification = this.wxPayService.parseAndVerifyNotification(
      this.getSignatureHeaders(),
      rawBody
    );
    await this.vipService.handlePaymentNotification(notification.resource);
    return {
      code: 'SUCCESS',
      message: '成功',
    };
  }

  @Post('/notify/refund')
  async notifyRefund() {
    const rawBody = this.getRawBody();
    const notification = this.wxPayService.parseAndVerifyRefundNotification(
      this.getSignatureHeaders(),
      rawBody
    );
    await this.vipService.handleRefundNotification(notification.resource);
    return {
      code: 'SUCCESS',
      message: '成功',
    };
  }

  private getRawBody() {
    const request = this.ctx.request as any;
    const rawBody = Buffer.isBuffer(request.rawBody)
      ? request.rawBody.toString('utf8')
      : request.rawBody;
    if (!rawBody || typeof rawBody !== 'string') {
      throw new BusinessError('微信支付回调缺少原始请求体', 500);
    }
    return rawBody;
  }

  private getSignatureHeaders() {
    return {
      'wechatpay-timestamp': this.ctx.get('Wechatpay-Timestamp'),
      'wechatpay-nonce': this.ctx.get('Wechatpay-Nonce'),
      'wechatpay-signature': this.ctx.get('Wechatpay-Signature'),
      'wechatpay-serial': this.ctx.get('Wechatpay-Serial'),
    };
  }
}
