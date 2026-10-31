import { Config, Inject, Provide } from '@midwayjs/core';
import * as crypto from 'crypto';
import { BusinessError } from '../core/errors';
import { WehchatApiService } from './WechatApiService';

interface VirtualPayConfig {
  offerId: string;
  attach: string;
  sandboxAppKey: string;
  productionAppKey: string;
}

const FIXED_OFFER_ID = '1450699648';
const PRODUCT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_LOGIN_CODE_LENGTH = 512;

@Provide()
export class VirtualPayService {
  @Config('virtualPay')
  config!: VirtualPayConfig;

  @Inject()
  wechatService!: WehchatApiService;

  async beforePayValid(
    authenticatedOpenid: string,
    input: {
      code?: string;
      productId?: string;
      price?: number;
      env?: number;
    }
  ) {
    this.assertConfigured();
    if (
      typeof input.code !== 'string' ||
      input.code.length === 0 ||
      input.code.length > MAX_LOGIN_CODE_LENGTH ||
      input.code.trim() !== input.code
    ) {
      throw new BusinessError('微信登录 code 无效');
    }
    const productId = input.productId;
    if (typeof productId !== 'string' || !PRODUCT_ID_PATTERN.test(productId)) {
      throw new BusinessError('商品 ID 无效');
    }
    const goodsPrice = input.price;
    if (
      typeof goodsPrice !== 'number' ||
      !Number.isSafeInteger(goodsPrice) ||
      goodsPrice <= 0
    ) {
      throw new BusinessError('商品价格无效');
    }

    if (input.env !== 0 && input.env !== 1) {
      throw new BusinessError('支付环境无效');
    }
    const env = input.env;
    const appKey =
      env === 1 ? this.config.sandboxAppKey : this.config.productionAppKey;
    if (!appKey) {
      throw new BusinessError('虚拟支付 AppKey 未配置', 503);
    }

    const loginResult = await this.wechatService.exchangeLoginCode(input.code);
    if (String(loginResult.openid) !== authenticatedOpenid) {
      console.warn('[virtualPay] login openid does not match auth token');
      throw new BusinessError('登录用户身份校验失败', 401);
    }
    if (!loginResult.session_key) {
      throw new BusinessError('微信登录会话无效', 401);
    }

    const outTradeNo = this.generateOutTradeNo();
    const signData = JSON.stringify({
      offerId: FIXED_OFFER_ID,
      buyQuantity: 1,
      env,
      currencyType: 'CNY',
      productId,
      goodsPrice,
      outTradeNo,
      attach: this.config.attach || 'pay-test',
    });
    return {
      signData,
      paySig: this.hmacSha256Hex(appKey, `requestVirtualPayment&${signData}`),
      signature: this.hmacSha256Hex(String(loginResult.session_key), signData),
      mode: 'short_series_goods',
    };
  }

  private hmacSha256Hex(key: string, value: string) {
    return crypto.createHmac('sha256', key).update(value).digest('hex');
  }

  private generateOutTradeNo() {
    return `VP${Date.now().toString(36).toUpperCase()}${crypto
      .randomBytes(10)
      .toString('hex')
      .toUpperCase()}`;
  }

  private assertConfigured() {
    if (!this.config || this.config.offerId !== FIXED_OFFER_ID) {
      throw new BusinessError('虚拟支付商品配置错误', 503);
    }
  }
}
