import { VipOrderModel } from '../../src/model/VipOrderModel';
import { VipTransactionModel } from '../../src/model/VipTransactionModel';
import { VipMembershipService } from '../../src/service/VipMembershipService';
import { VipService } from '../../src/service/VipService';

let restoreSequelize: (() => void) | undefined;

function mockDatabaseTransaction() {
  const original = Object.getOwnPropertyDescriptor(VipOrderModel, 'sequelize');
  const commit = jest.fn().mockResolvedValue(undefined);
  const rollback = jest.fn().mockResolvedValue(undefined);
  Object.defineProperty(VipOrderModel, 'sequelize', {
    configurable: true,
    value: {
      transaction: jest.fn().mockResolvedValue({
        commit,
        rollback,
      }),
    },
  });
  const result = {
    commit,
    rollback,
  };
  restoreSequelize = () => {
    if (original) {
      Object.defineProperty(VipOrderModel, 'sequelize', original);
    } else {
      delete (VipOrderModel as any).sequelize;
    }
  };
  return result;
}

describe('VipService virtual payment delivery', () => {
  afterEach(() => {
    restoreSequelize?.();
    restoreSequelize = undefined;
    jest.restoreAllMocks();
  });

  it('extends an active membership using the mapped monthly product', async () => {
    const db = mockDatabaseTransaction();
    const previousStart = new Date('2026-10-01T00:00:00.000Z');
    const previousEnd = new Date('2026-12-30T00:00:00.000Z');
    const order = {
      user_id: 'openid-1',
      plan_id: 'vip_9_9',
      status: 'PENDING',
      amount_cents: 990,
      reload: jest.fn().mockResolvedValue(undefined),
      update: jest.fn().mockResolvedValue(undefined),
    };
    jest
      .spyOn(VipOrderModel, 'findOrCreate')
      .mockResolvedValue([order as any, true]);
    jest
      .spyOn(VipTransactionModel, 'findOrCreate')
      .mockResolvedValue([{} as any, true]);
    const service = new VipService();
    service.vipMembershipService = new VipMembershipService();
    jest
      .spyOn(service.vipMembershipService, 'getCurrentMembership')
      .mockResolvedValue({
        type: 'quarterly',
        name: '季卡会员',
        active: true,
        available_start: previousStart,
        available_end: previousEnd,
        order: {
          plan_snapshot: { memberType: 'quarterly' },
        },
      } as any);
    const paidTime = Math.floor(Date.now() / 1000);

    await service.applyVirtualPayPurchase({
      openid: 'openid-1',
      productId: 'vip_9_9',
      quantity: 1,
      outTradeNo: 'VP_ORDER_1',
      env: 0,
      paidTime,
      actualPrice: 990,
      transactionId: 'WX_TRANSACTION_1',
    });

    const expectedEnd = new Date(
      previousEnd.getTime() + 30 * 24 * 60 * 60 * 1000
    );
    expect(order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'PAID',
        transaction_id: 'WX_TRANSACTION_1',
        membership_start_at: previousStart,
        membership_end_at: expectedEnd,
      }),
      {
        transaction: expect.any(Object),
      }
    );
    expect(VipTransactionModel.findOrCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          order_no: 'VP_ORDER_1',
        },
        defaults: expect.objectContaining({
          source: 'VIRTUAL_PAY',
          amount_cents: 990,
        }),
      })
    );
    expect(db.commit).toHaveBeenCalledTimes(1);
    expect(db.rollback).not.toHaveBeenCalled();
  });

  it('does not extend membership again for a duplicate OutTradeNo', async () => {
    const db = mockDatabaseTransaction();
    jest.spyOn(VipOrderModel, 'findOrCreate').mockResolvedValue([
      {
        user_id: 'openid-1',
        plan_id: 'vip_28_8',
        status: 'PAID',
      } as any,
      false,
    ]);
    const service = new VipService();
    service.vipMembershipService = new VipMembershipService();
    const membershipLookup = jest.spyOn(
      service.vipMembershipService,
      'getCurrentMembership'
    );

    await service.applyVirtualPayPurchase({
      openid: 'openid-1',
      productId: 'vip_28_8',
      quantity: 1,
      outTradeNo: 'VP_DUPLICATE',
      env: 0,
    });

    expect(membershipLookup).not.toHaveBeenCalled();
    expect(db.commit).toHaveBeenCalledTimes(1);
    expect(db.rollback).not.toHaveBeenCalled();
  });

  it('rejects an unknown product before opening a transaction', async () => {
    const service = new VipService();

    await expect(
      service.applyVirtualPayPurchase({
        openid: 'openid-1',
        productId: 'vip_unknown',
        quantity: 1,
        outTradeNo: 'VP_UNKNOWN',
        env: 0,
      })
    ).rejects.toThrow('虚拟支付道具映射不存在');
  });
});
