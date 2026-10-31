import * as crypto from 'crypto';
import { VirtualPayController } from '../../src/controller/virtualPay';
import { VirtualPayService } from '../../src/service/VirtualPayService';

function createService() {
  const service = new VirtualPayService();
  service.config = {
    offerId: '1450699648',
    attach: 'pay-test',
    sandboxAppKey: 'sandbox-app-key',
    productionAppKey: 'production-app-key',
  };
  service.wechatService = {
    exchangeLoginCode: jest.fn().mockResolvedValue({
      openid: 'openid-1',
      session_key: 'session-key-1',
    }),
  } as any;
  return service;
}

function hmac(key: string, value: string) {
  return crypto.createHmac('sha256', key).update(value).digest('hex');
}

describe('VirtualPayService.beforePayValid', () => {
  it('uses the sandbox AppKey when the client passes env 1', async () => {
    const service = createService();

    const result = await service.beforePayValid('openid-1', {
      code: 'wx-code',
      productId: 'vip_1',
      price: 10,
      env: 1,
    });
    const parsed = JSON.parse(result.signData);

    expect(Object.keys(parsed)).toEqual([
      'offerId',
      'buyQuantity',
      'env',
      'currencyType',
      'productId',
      'goodsPrice',
      'outTradeNo',
      'attach',
    ]);
    expect(result.signData).toBe(
      JSON.stringify({
        offerId: '1450699648',
        buyQuantity: 1,
        env: 1,
        currencyType: 'CNY',
        productId: 'vip_1',
        goodsPrice: 10,
        outTradeNo: parsed.outTradeNo,
        attach: 'pay-test',
      })
    );
    expect(parsed.outTradeNo).toMatch(/^[A-Za-z0-9]{8,32}$/);
    expect(parsed.outTradeNo.startsWith('_')).toBe(false);
    expect(result.paySig).toBe(
      hmac('sandbox-app-key', `requestVirtualPayment&${result.signData}`)
    );
    expect(result.signature).toBe(hmac('session-key-1', result.signData));
    expect(result.mode).toBe('short_series_goods');
  });

  it('uses the production AppKey when the client passes env 0', async () => {
    const service = createService();

    const result = await service.beforePayValid('openid-1', {
      code: 'wx-code',
      productId: 'vip_1',
      price: 10,
      env: 0,
    });
    const parsed = JSON.parse(result.signData);

    expect(parsed.env).toBe(0);
    expect(result.paySig).toBe(
      hmac('production-app-key', `requestVirtualPayment&${result.signData}`)
    );
  });

  it('accepts any valid frontend productId and positive integer price', async () => {
    const service = createService();

    const result = await service.beforePayValid('openid-1', {
      code: 'wx-code',
      productId: 'custom_product-2',
      price: 199,
      env: 0,
    });
    const parsed = JSON.parse(result.signData);

    expect(parsed.productId).toBe('custom_product-2');
    expect(parsed.goodsPrice).toBe(199);
  });

  it.each([0, -1, 1.5, Number.NaN])(
    'rejects an invalid frontend price: %s',
    async price => {
      const service = createService();

      await expect(
        service.beforePayValid('openid-1', {
          code: 'wx-code',
          productId: 'vip_1',
          price,
        })
      ).rejects.toThrow('商品价格无效');
    }
  );

  it('rejects a string price even when it contains an integer', async () => {
    const service = createService();

    await expect(
      (service.beforePayValid as any)('openid-1', {
        code: 'wx-code',
        productId: 'vip_1',
        price: '10',
      })
    ).rejects.toThrow('商品价格无效');
  });

  it.each(['', ' vip_1', 'vip 1', 'vip/1', 'x'.repeat(65)])(
    'rejects an invalid productId: "%s"',
    async productId => {
      const service = createService();

      await expect(
        service.beforePayValid('openid-1', {
          code: 'wx-code',
          productId,
          price: 10,
        })
      ).rejects.toThrow('商品 ID 无效');
    }
  );

  it.each([
    ['empty', ''],
    ['leading whitespace', ' wx-code'],
    ['too long', 'x'.repeat(513)],
  ])('rejects an invalid wx.login code: %s', async (_case, code) => {
    const service = createService();

    await expect(
      service.beforePayValid('openid-1', {
        code,
        productId: 'vip_1',
        price: 10,
      })
    ).rejects.toThrow('微信登录 code 无效');
  });

  it.each([-1, 2, 1.5, '1'])('rejects an invalid env value: %s', async env => {
    const service = createService();

    await expect(
      (service.beforePayValid as any)('openid-1', {
        code: 'wx-code',
        productId: 'vip_1',
        price: 10,
        env,
      })
    ).rejects.toThrow('支付环境无效');
  });

  it('rejects a missing env value', async () => {
    const service = createService();

    await expect(
      service.beforePayValid('openid-1', {
        code: 'wx-code',
        productId: 'vip_1',
        price: 10,
      })
    ).rejects.toThrow('支付环境无效');
    expect(service.wechatService.exchangeLoginCode).not.toHaveBeenCalled();
  });

  it('accepts productId characters from the supported format', async () => {
    const service = createService();

    const result = await service.beforePayValid('openid-1', {
      code: 'wx-code',
      productId: 'vip_2026-test',
      price: 10,
      env: 1,
    });

    expect(JSON.parse(result.signData).productId).toBe('vip_2026-test');
  });

  it('rejects when the wx.login openid differs from the auth token', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const service = createService();

    await expect(
      service.beforePayValid('attacker-openid', {
        code: 'wx-code',
        productId: 'vip_1',
        price: 10,
        env: 0,
      })
    ).rejects.toMatchObject({
      status: 401,
      message: '登录用户身份校验失败',
    });
  });

  it('generates a different outTradeNo for each request', async () => {
    const service = createService();

    const first = await service.beforePayValid('openid-1', {
      code: 'wx-code-1',
      productId: 'vip_1',
      price: 10,
      env: 0,
    });
    const second = await service.beforePayValid('openid-1', {
      code: 'wx-code-2',
      productId: 'vip_1',
      price: 10,
      env: 0,
    });

    expect(JSON.parse(first.signData).outTradeNo).not.toBe(
      JSON.parse(second.signData).outTradeNo
    );
  });
});

describe('VirtualPayController.beforePayValid', () => {
  it('passes the authenticated openid to the signing service', async () => {
    const controller = new VirtualPayController();
    controller.ctx = {
      vipAuth: { openid: 'openid-1' },
      request: {
        body: {
          code: 'wx-code',
          productId: 'vip_1',
          price: 10,
          env: 1,
        },
      },
    } as any;
    controller.virtualPayService = {
      beforePayValid: jest.fn().mockResolvedValue({
        signData: '{}',
        paySig: 'pay-sig',
        signature: 'signature',
        mode: 'short_series_goods',
      }),
    } as any;

    const result = await controller.beforePayValid();

    expect(controller.virtualPayService.beforePayValid).toHaveBeenCalledWith(
      'openid-1',
      {
        code: 'wx-code',
        productId: 'vip_1',
        price: 10,
        env: 1,
      }
    );
    expect(result.data.paySig).toBe('pay-sig');
  });
});
