import { UserController } from '../../src/controller/admin/users';
import { UserVipModel } from '../../src/model/UserVipModel';
import { VipOrderModel } from '../../src/model/VipOrderModel';
import { VipPlanModel } from '../../src/model/VipPlanModel';
import { VipRefundModel } from '../../src/model/VipRefundModel';
import { VipTransactionModel } from '../../src/model/VipTransactionModel';
import { VipService } from '../../src/service/VipService';

function createWxPayMock() {
  return {
    getMerchantIdentity: jest.fn().mockReturnValue({
      appId: 'wx-app',
      mchId: 'wx-mch',
    }),
    createJsapiOrder: jest.fn(),
    buildMiniProgramPayParams: jest.fn().mockReturnValue({
      timeStamp: '1792900800',
      nonceStr: 'nonce',
      package: 'prepay_id=wx-prepay',
      signType: 'RSA',
      paySign: 'sign',
    }),
    queryOrder: jest.fn(),
    closeOrder: jest.fn(),
    createRefund: jest.fn(),
    queryRefund: jest.fn(),
  };
}

function createService() {
  const service = new VipService();
  const wxPayService = createWxPayMock();
  service.wxPayService = wxPayService as any;
  return { service, wxPayService };
}

function createVipRecord(overrides: Record<string, any> = {}) {
  return {
    type: 'guest',
    available_start: new Date('2026-01-01T00:00:00.000Z'),
    available_end: new Date('2026-01-08T00:00:00.000Z'),
    reload: jest.fn().mockResolvedValue(undefined),
    update: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('VipService membership identity', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns only active paid orders in latest-first order', async () => {
    jest.spyOn(VipOrderModel, 'findAll').mockResolvedValue([
      {
        order_no: 'VIP_MONTH',
        plan_id: 'month',
        plan_snapshot: {
          name: '月卡会员',
          memberType: 'monthly',
        },
        membership_start_at: new Date('2025-12-30T00:00:00.000Z'),
        membership_end_at: new Date('2099-01-01T00:00:00.000Z'),
      },
      {
        order_no: 'VIP_QUARTER',
        plan_id: 'quarter',
        plan_snapshot: {
          name: '季卡会员',
          memberType: 'quarterly',
        },
        membership_start_at: new Date('2025-10-01T00:00:00.000Z'),
        membership_end_at: new Date('2025-12-30T00:00:00.000Z'),
      },
    ] as any);
    const { service } = createService();

    const info = await service.getVipInfo('openid-1');

    expect(info).toEqual([
      {
        type: 'monthly',
        name: '月卡会员',
        active: true,
        available_start: new Date('2025-12-30T00:00:00.000Z'),
        available_end: new Date('2099-01-01T00:00:00.000Z'),
      },
    ]);
  });

  it('returns an empty VIP array when no paid order is active', async () => {
    jest.spyOn(VipOrderModel, 'findAll').mockResolvedValue([
      {
        order_no: 'VIP_EXPIRED',
        plan_id: 'quarter',
        plan_snapshot: {
          name: '季卡会员',
          memberType: 'quarterly',
        },
        membership_start_at: new Date('2025-01-01T00:00:00.000Z'),
        membership_end_at: new Date('2025-03-31T00:00:00.000Z'),
      },
    ] as any);
    const vipRecord = createVipRecord();
    jest
      .spyOn(UserVipModel, 'findOrCreate')
      .mockResolvedValue([vipRecord as any, false]);
    const { service } = createService();

    const info = await service.getVipInfo('openid-1');

    expect(info).toEqual([]);
  });

  it('connects a new monthly membership to an active quarterly order', async () => {
    const quarterStart = new Date('2026-10-01T00:00:00.000Z');
    const quarterEnd = new Date('2026-12-30T00:00:00.000Z');
    const vipRecord = createVipRecord({
      type: 'quarterly',
      available_start: quarterStart,
      available_end: quarterEnd,
    });
    jest
      .spyOn(UserVipModel, 'findOrCreate')
      .mockResolvedValue([vipRecord as any, false]);
    jest.spyOn(VipOrderModel, 'findOne').mockResolvedValue({
      plan_snapshot: { memberType: 'quarterly' },
      membership_start_at: quarterStart,
      membership_end_at: quarterEnd,
    } as any);
    jest
      .spyOn(VipTransactionModel, 'findOrCreate')
      .mockResolvedValue([{} as any, true]);
    const order = {
      user_id: 'openid-1',
      order_no: 'VIP_MONTH',
      amount_cents: 990,
      currency: 'CNY',
      plan_snapshot: {
        memberType: 'monthly',
        durationDays: 30,
      },
      update: jest.fn().mockResolvedValue(undefined),
    };
    const dbTransaction = {} as any;
    const { service } = createService();

    await (service as any).grantMembership(
      order,
      {
        transaction_id: 'wx-tx-month',
        trade_state: 'SUCCESS',
        success_time: '2026-10-25T00:00:00.000Z',
        amount: { total: 990, currency: 'CNY' },
      },
      'CALLBACK',
      dbTransaction
    );

    expect(vipRecord.update).toHaveBeenCalledWith(
      {
        type: 'monthly',
        available_start: quarterStart,
        available_end: new Date(quarterEnd.getTime() + 30 * 86400000),
      },
      { transaction: dbTransaction }
    );
    expect(order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'PAID',
        membership_start_at: quarterStart,
        membership_end_at: new Date(quarterEnd.getTime() + 30 * 86400000),
      }),
      { transaction: dbTransaction }
    );
  });
});

describe('VipService order creation', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('uses the server plan price and ignores a client amount', async () => {
    const { service, wxPayService } = createService();
    jest.spyOn(VipRefundModel, 'findOne').mockResolvedValue(null);
    jest.spyOn(VipPlanModel, 'bulkCreate').mockResolvedValue([]);
    jest.spyOn(VipPlanModel, 'findOne').mockResolvedValue({
      plan_id: 'month',
      name: '月卡会员',
      member_type: 'monthly',
      duration_days: 30,
      price_cents: 990,
    } as any);
    jest.spyOn(VipOrderModel, 'findOne').mockResolvedValue(null);
    const order = {
      id: 1,
      order_no: 'VIP_SERVER_AMOUNT',
      status: 'CREATING',
      prepay_id: null,
      amount_cents: 990,
      save: jest.fn().mockResolvedValue(undefined),
    };
    jest.spyOn(VipOrderModel, 'create').mockResolvedValue(order as any);
    wxPayService.createJsapiOrder.mockResolvedValue('wx-prepay');

    const result = await service.createOrder('openid-1', {
      planId: 'month',
      quantity: 1,
      amountCents: 1,
    } as any);

    expect(wxPayService.createJsapiOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        amountCents: 990,
        openid: 'openid-1',
      })
    );
    expect(result.data.amountCents).toBe(990);
  });

  it('rejects a disabled plan', async () => {
    jest.spyOn(VipRefundModel, 'findOne').mockResolvedValue(null);
    jest.spyOn(VipPlanModel, 'bulkCreate').mockResolvedValue([]);
    jest.spyOn(VipPlanModel, 'findOne').mockResolvedValue(null);
    const { service } = createService();

    await expect(
      service.createOrder('openid-1', { planId: 'month', quantity: 1 })
    ).rejects.toThrow('套餐已下架');
  });

  it('blocks a new purchase while a refund is processing', async () => {
    jest.spyOn(VipRefundModel, 'findOne').mockResolvedValue({
      status: 'PROCESSING',
    } as any);
    const { service } = createService();

    await expect(
      service.createOrder('openid-1', { planId: 'month', quantity: 1 })
    ).rejects.toThrow('退款处理中，请完成后再购买');
  });

  it('returns the recent pending order for repeated clicks', async () => {
    const { service, wxPayService } = createService();
    jest.spyOn(VipRefundModel, 'findOne').mockResolvedValue(null);
    jest.spyOn(VipPlanModel, 'bulkCreate').mockResolvedValue([]);
    jest.spyOn(VipPlanModel, 'findOne').mockResolvedValue({
      plan_id: 'month',
      name: '月卡会员',
      member_type: 'monthly',
      duration_days: 30,
      price_cents: 990,
    } as any);
    jest.spyOn(VipOrderModel, 'findOne').mockResolvedValue({
      order_no: 'VIP_PENDING',
      status: 'PENDING',
      prepay_id: 'existing-prepay',
      amount_cents: 990,
    } as any);
    const createSpy = jest.spyOn(VipOrderModel, 'create');

    const result = await service.createOrder('openid-1', {
      planId: 'month',
      quantity: 1,
    });

    expect(result.data.orderNo).toBe('VIP_PENDING');
    expect(wxPayService.createJsapiOrder).not.toHaveBeenCalled();
    expect(createSpy).not.toHaveBeenCalled();
  });
});

describe('VipService payment verification and idempotency', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each([
    ['appid', { appid: 'wrong-app' }],
    ['mchid', { mchid: 'wrong-mch' }],
    ['amount', { amount: { total: 1, currency: 'CNY' } }],
    ['currency', { amount: { total: 990, currency: 'USD' } }],
    ['order number', { out_trade_no: 'VIP_OTHER' }],
  ])('rejects a mismatched %s', async (_field, override) => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const order = {
      order_no: 'VIP_ORDER',
      user_id: 'openid-1',
      amount_cents: 990,
      currency: 'CNY',
      status: 'PENDING',
    };
    jest.spyOn(VipOrderModel, 'findOne').mockResolvedValue(order as any);
    const { service } = createService();
    const transaction = {
      appid: 'wx-app',
      mchid: 'wx-mch',
      out_trade_no: 'VIP_ORDER',
      transaction_id: 'wx-tx-id',
      trade_state: 'SUCCESS',
      amount: { total: 990, currency: 'CNY' },
      payer: { openid: 'openid-1' },
      ...override,
    };

    await expect(
      (service as any).settleVerifiedTransaction(transaction, 'CALLBACK')
    ).rejects.toThrow('微信支付交易信息校验失败');
  });

  it('does not grant membership again for a paid order', async () => {
    const order = {
      order_no: 'VIP_PAID',
      user_id: 'openid-1',
      amount_cents: 990,
      currency: 'CNY',
      status: 'PAID',
    };
    jest.spyOn(VipOrderModel, 'findOne').mockResolvedValue(order as any);
    const { service } = createService();
    const grantSpy = jest.spyOn(service as any, 'grantMembership');

    for (let i = 0; i < 5; i += 1) {
      await (service as any).settleVerifiedTransaction(
        {
          appid: 'wx-app',
          mchid: 'wx-mch',
          out_trade_no: 'VIP_PAID',
          transaction_id: 'wx-tx-paid',
          trade_state: 'SUCCESS',
          amount: { total: 990, currency: 'CNY' },
          payer: { openid: 'openid-1' },
        },
        'CALLBACK'
      );
    }

    expect(grantSpy).not.toHaveBeenCalled();
  });

  it('uses active order query to settle a successful payment', async () => {
    const order = { id: 1, order_no: 'VIP_QUERY', status: 'PENDING' };
    const { service, wxPayService } = createService();
    wxPayService.queryOrder.mockResolvedValue({
      out_trade_no: 'VIP_QUERY',
      trade_state: 'SUCCESS',
    });
    const settleSpy = jest
      .spyOn(service as any, 'settleVerifiedTransaction')
      .mockResolvedValue(undefined);
    jest.spyOn(VipOrderModel, 'findByPk').mockResolvedValue({
      ...order,
      status: 'PAID',
    } as any);

    const result = await service.queryAndSettleOrder(order as any);

    expect(settleSpy).toHaveBeenCalledWith(
      expect.objectContaining({ out_trade_no: 'VIP_QUERY' }),
      'QUERY'
    );
    expect(result.status).toBe('PAID');
  });
});

describe('VipService expired order closing', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('queries and closes an unpaid expired order', async () => {
    const order = { id: 1, order_no: 'VIP_EXPIRED', status: 'PENDING' };
    jest.spyOn(VipOrderModel, 'findAll').mockResolvedValue([order as any]);
    jest.spyOn(VipOrderModel, 'update').mockResolvedValue([1] as any);
    const { service, wxPayService } = createService();
    wxPayService.queryOrder.mockResolvedValue({ trade_state: 'NOTPAY' });
    wxPayService.closeOrder.mockResolvedValue(undefined);

    const checked = await service.closeExpiredOrders();

    expect(checked).toBe(1);
    expect(wxPayService.queryOrder).toHaveBeenCalledWith('VIP_EXPIRED');
    expect(wxPayService.closeOrder).toHaveBeenCalledWith('VIP_EXPIRED');
    expect(VipOrderModel.update).toHaveBeenCalledWith(
      { status: 'CLOSED' },
      {
        where: {
          id: 1,
          status: 'PENDING',
        },
      }
    );
  });
});

describe('VipService refund fallback and validation', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('falls back to the previous valid quarterly order after refund', async () => {
    const quarterStart = new Date('2026-10-01T00:00:00.000Z');
    const quarterEnd = new Date('2026-12-30T00:00:00.000Z');
    jest.spyOn(VipOrderModel, 'findOne').mockResolvedValue({
      plan_id: 'quarter',
      plan_snapshot: { memberType: 'quarterly' },
      membership_start_at: quarterStart,
      membership_end_at: quarterEnd,
      paid_at: new Date('2026-10-01T00:00:00.000Z'),
    } as any);
    const vipRecord = createVipRecord();
    jest
      .spyOn(UserVipModel, 'findOrCreate')
      .mockResolvedValue([vipRecord as any, false]);
    const { service } = createService();

    await (service as any).refreshUserVipFromOrders('openid-1', {} as any);

    expect(vipRecord.update).toHaveBeenCalledWith(
      {
        type: 'quarterly',
        available_start: quarterStart,
        available_end: quarterEnd,
      },
      { transaction: {} }
    );
  });

  it('resets membership to guest when no paid order remains', async () => {
    jest.spyOn(VipOrderModel, 'findOne').mockResolvedValue(null);
    const vipRecord = createVipRecord({
      type: 'monthly',
      available_end: new Date('2099-01-01T00:00:00.000Z'),
    });
    jest
      .spyOn(UserVipModel, 'findOrCreate')
      .mockResolvedValue([vipRecord as any, false]);
    const { service } = createService();

    await (service as any).refreshUserVipFromOrders('openid-1', {} as any);

    expect(vipRecord.update).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'guest' }),
      { transaction: {} }
    );
  });

  it('rejects a refund callback with a different merchant or amount', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const refund = {
      order_no: 'VIP_ORDER',
      transaction_id: 'wx-tx',
      amount_cents: 990,
      total_cents: 2880,
      currency: 'CNY',
      out_refund_no: 'VR_1',
    };
    jest.spyOn(VipRefundModel, 'findOne').mockResolvedValue(refund as any);
    const { service } = createService();
    const resource = {
      mchid: 'wrong-mch',
      out_trade_no: 'VIP_ORDER',
      transaction_id: 'wx-tx',
      out_refund_no: 'VR_1',
      refund_id: 'wx-refund',
      refund_status: 'SUCCESS',
      amount: { total: 2880, refund: 990, currency: 'CNY' },
    };

    await expect(
      service.handleRefundNotification(resource as any)
    ).rejects.toThrow('微信退款回调商户信息校验失败');

    resource.mchid = 'wx-mch';
    resource.amount.refund = 1;
    await expect(
      service.handleRefundNotification(resource as any)
    ).rejects.toThrow('微信退款回调信息校验失败');
  });

  it('settles a manual order refund without calling WeChat', async () => {
    const order = {
      order_no: 'VIP_MANUAL',
      transaction_id: 'MANUAL-TX',
      amount_cents: 990,
      currency: 'CNY',
      membership_end_at: new Date('2099-01-01T00:00:00.000Z'),
    };
    const refund = {
      out_refund_no: 'VR_MANUAL',
      order_no: order.order_no,
      amount_cents: 990,
      status: 'CREATING',
    };
    jest.spyOn(VipRefundModel, 'findOne').mockResolvedValue(null);
    jest.spyOn(VipRefundModel, 'create').mockResolvedValue(refund as any);
    jest
      .spyOn(VipTransactionModel, 'findOne')
      .mockResolvedValue({ source: 'MANUAL' } as any);
    const { service, wxPayService } = createService();
    (service as any).findLatestPaidOrder = jest.fn().mockResolvedValue(order);
    jest
      .spyOn(service as any, 'settleManualRefund')
      .mockResolvedValue({ ...refund, status: 'SUCCESS' });

    const result = await service.requestRefund(
      'openid-1',
      'VIP_MANUAL',
      'admin'
    );

    expect(result.data).toEqual({
      orderNo: 'VIP_MANUAL',
      outRefundNo: 'VR_MANUAL',
      status: 'success',
      amountCents: 990,
    });
    expect(wxPayService.createRefund).not.toHaveBeenCalled();
  });

  it('keeps membership active while a WeChat refund is processing', async () => {
    const order = {
      order_no: 'VIP_WX',
      transaction_id: 'WX-TX',
      amount_cents: 990,
      currency: 'CNY',
      membership_end_at: new Date('2099-01-01T00:00:00.000Z'),
      update: jest.fn().mockResolvedValue(undefined),
    };
    const refund = {
      out_refund_no: 'VR_WX',
      order_no: order.order_no,
      amount_cents: 990,
      status: 'CREATING',
      save: jest.fn().mockResolvedValue(undefined),
    };
    jest.spyOn(VipRefundModel, 'findOne').mockResolvedValue(null);
    jest.spyOn(VipRefundModel, 'create').mockResolvedValue(refund as any);
    jest
      .spyOn(VipTransactionModel, 'findOne')
      .mockResolvedValue({ source: 'CALLBACK' } as any);
    const { service, wxPayService } = createService();
    (service as any).findLatestPaidOrder = jest.fn().mockResolvedValue(order);
    wxPayService.createRefund.mockImplementation(async params => ({
      refund_id: 'wx-refund-id',
      out_refund_no: params.outRefundNo,
      status: 'PROCESSING',
    }));
    const settleSpy = jest.spyOn(service as any, 'settleRefundSuccess');

    const result = await service.requestRefund('openid-1', 'VIP_WX', 'admin');

    expect(result.data.status).toBe('processing');
    expect(settleSpy).not.toHaveBeenCalled();
    expect(order.update).toHaveBeenCalledWith({
      refund_status: 'PROCESSING',
    });
  });
});

describe('admin user VIP projection', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('adds latest order VIP fields and guest defaults', async () => {
    jest.spyOn(VipOrderModel, 'findAll').mockResolvedValue([
      {
        user_id: 'openid-vip',
        order_no: 'VIP_LATEST',
        plan_id: 'quarter',
        plan_snapshot: {
          name: '季卡会员',
          memberType: 'quarterly',
        },
        membership_start_at: new Date('2026-10-01T00:00:00.000Z'),
        membership_end_at: new Date('2099-01-01T00:00:00.000Z'),
        paid_at: new Date('2026-10-01T00:00:00.000Z'),
      },
    ] as any);
    const controller = new UserController();

    const result = await (controller as any).attachVipInfo([
      { openid: 'openid-vip' },
      { openid: 'openid-guest' },
    ]);

    expect(result[0]).toEqual(
      expect.objectContaining({
        user_id: 'openid-vip',
        vip_type: 'quarterly',
        vip_name: '季卡会员',
        vip_order_no: 'VIP_LATEST',
        vip_active: true,
      })
    );
    expect(result[1]).toEqual(
      expect.objectContaining({
        user_id: 'openid-guest',
        vip_type: 'guest',
        vip_order_no: null,
        vip_active: false,
      })
    );
  });
});
