import { Get, Inject, Param, Post, Provide } from '@midwayjs/core';
import { Context } from 'egg';
import { VipService } from '../service/VipService';
import Api from './api/Api';

@Provide()
@Api('/vip', ['vipAuthMiddleware', 'vipRateLimitMiddleware'])
export class VipController {
  @Inject()
  ctx!: Context;

  @Inject()
  vipService!: VipService;

  @Get('/plans')
  async getPlans() {
    return {
      data: await this.vipService.listPlans(),
    };
  }

  @Get('/info')
  async getInfo() {
    return {
      data: await this.vipService.getVipInfo(this.ctx.vipAuth.openid),
    };
  }

  @Post('/orders')
  async createOrder() {
    const body = this.ctx.request.body || {};
    return this.vipService.createOrder(this.ctx.vipAuth.openid, {
      planId: body.planId,
      quantity: body.quantity,
    });
  }

  @Get('/orders/:orderNo')
  async getOrder(@Param('orderNo') orderNo: string) {
    return this.vipService.getOrderForUser(this.ctx.vipAuth.openid, orderNo);
  }
}
