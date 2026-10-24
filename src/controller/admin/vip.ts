import { Inject, Post, Provide } from '@midwayjs/core';
import { Context } from 'egg';
import { VipService } from '../../service/VipService';
import { AdminApi } from '../api/Api';

@AdminApi('/vip')
@Provide()
export class AdminVipController {
  @Inject()
  ctx!: Context;

  @Inject()
  vipService!: VipService;

  @Post('/refund/:openid')
  async refundLatestOrder() {
    const { openid } = this.ctx.params;
    const { orderNo, reason } = this.ctx.request.body || {};
    const operatorId = this.ctx.get('x-operator-id') || 'admin';
    return this.vipService.requestRefund(
      openid,
      orderNo,
      operatorId,
      reason || '管理员发起退款'
    );
  }
}
