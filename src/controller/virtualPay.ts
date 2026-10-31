import { Inject, Post, Provide } from '@midwayjs/core';
import { Context } from 'egg';
import { VirtualPayService } from '../service/VirtualPayService';
import Api from './api/Api';

@Provide()
@Api('/virtual-pay', ['vipAuthMiddleware', 'vipRateLimitMiddleware'])
export class VirtualPayController {
  @Inject()
  ctx!: Context;

  @Inject()
  virtualPayService!: VirtualPayService;

  @Post('/before_pay_valid')
  async beforePayValid() {
    const body = this.ctx.request.body || {};
    return {
      data: await this.virtualPayService.beforePayValid(
        this.ctx.vipAuth.openid,
        {
          code: body.code,
          productId: body.productId,
          price: body.price ?? body.goodsPrice,
          env: body.env,
        }
      ),
    };
  }
}
