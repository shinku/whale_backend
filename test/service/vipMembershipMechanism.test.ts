import {
  calculateMembershipExtension,
  isMembershipActive,
  isVipActive,
} from '../../src/core/vip';
import { UserModel } from '../../src/model/UserModel';
import { VipOrderModel } from '../../src/model/VipOrderModel';
import { VipAuthMiddleware } from '../../src/middleware/vipAuth';
import { DEFAULT_EXTRA_CONFIG } from '../../src/service/ExtraConfigService';
import { VipMembershipService } from '../../src/service/VipMembershipService';
import { VipService } from '../../src/service/VipService';

describe('VIP membership mechanism', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-31T00:00:00.000Z'));
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('treats a record as active based on expiry only', () => {
    expect(isMembershipActive(null)).toBe(true);
    expect(isMembershipActive(new Date('2026-11-01T00:00:00.000Z'))).toBe(true);
    expect(isMembershipActive(new Date('2026-10-30T00:00:00.000Z'))).toBe(
      false
    );
    expect(isVipActive('infinity', new Date('2020-01-01T00:00:00.000Z'))).toBe(
      true
    );
  });

  it('keeps infinity membership without an expiry', () => {
    const result = calculateMembershipExtension(
      'infinity',
      new Date('2026-01-01T00:00:00.000Z'),
      null,
      30
    );

    expect(result.membershipStart).toEqual(
      new Date('2026-01-01T00:00:00.000Z')
    );
    expect(result.membershipEnd).toBeNull();
  });

  it('creates a three-day guest record in vip_order only', async () => {
    const now = new Date();
    const order = {
      user_id: 'openid-guest',
      plan_id: 'guest',
      plan_snapshot: { name: '体验会员', memberType: 'guest' },
      membership_start_at: now,
      membership_end_at: new Date(now.getTime() + 3 * 86400000),
    };
    jest
      .spyOn(VipOrderModel, 'findOrCreate')
      .mockResolvedValue([order as any, true]);
    const service = new VipService();
    service.vipMembershipService = {
      getCurrentMembership: jest.fn().mockResolvedValue(null),
      toMembershipInfo: (value: any) =>
        new VipMembershipService().toMembershipInfo(value),
    } as any;

    const result = await service.userVipInitializatin('openid-guest');

    expect(result.type).toBe('guest');
    expect(result.available_end).toEqual(order.membership_end_at);
    expect(VipOrderModel.findOrCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          user_id: 'openid-guest',
          plan_id: 'guest',
          status: 'GRANTED',
        },
        defaults: expect.objectContaining({
          order_no: null,
          plan_id: 'guest',
          amount_cents: 0,
          status: 'GRANTED',
          membership_end_at: order.membership_end_at,
        }),
      })
    );
  });

  it('does not initialize a new guest VIP when disabled', async () => {
    const findOrCreate = jest.spyOn(VipOrderModel, 'findOrCreate');
    const service = new VipService();
    service.vipMembershipService = {
      getCurrentMembership: jest.fn().mockResolvedValue(null),
    } as any;
    service.extraConfigService = {
      getConfig: jest.fn().mockReturnValue({
        ...DEFAULT_EXTRA_CONFIG,
        guestVipInitialization: false,
      }),
    } as any;

    const result = await service.userVipInitializatin('openid-no-guest');

    expect(result).toEqual({
      type: 'guest',
      name: '体验会员',
      active: false,
      available_start: null,
      available_end: null,
    });
    expect(findOrCreate).not.toHaveBeenCalled();
  });

  it('uses the configured guest validity days', async () => {
    const now = new Date();
    const order = {
      user_id: 'openid-custom-guest',
      plan_id: 'guest',
      plan_snapshot: { name: '体验会员', memberType: 'guest' },
      membership_start_at: now,
      membership_end_at: new Date(now.getTime() + 7 * 86400000),
    };
    jest
      .spyOn(VipOrderModel, 'findOrCreate')
      .mockResolvedValue([order as any, true]);
    const service = new VipService();
    service.vipMembershipService = {
      getCurrentMembership: jest.fn().mockResolvedValue(null),
      toMembershipInfo: (value: any) =>
        new VipMembershipService().toMembershipInfo(value),
    } as any;
    service.extraConfigService = {
      getConfig: jest.fn().mockReturnValue({
        ...DEFAULT_EXTRA_CONFIG,
        guestValidityDays: 7,
      }),
    } as any;

    const result = await service.userVipInitializatin('openid-custom-guest');

    expect(result.available_end).toEqual(order.membership_end_at);
    expect(VipOrderModel.findOrCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        defaults: expect.objectContaining({
          membership_end_at: order.membership_end_at,
          plan_snapshot: expect.objectContaining({
            durationDays: 7,
          }),
        }),
      })
    );
  });

  it('grants infinity only through the special service path', async () => {
    const order = {
      user_id: 'openid-infinity',
      plan_id: 'infinity',
      plan_snapshot: { name: '永久会员', memberType: 'infinity' },
      membership_start_at: new Date('2026-10-01T00:00:00.000Z'),
      membership_end_at: null,
    };
    jest.spyOn(UserModel, 'findOne').mockResolvedValue({} as any);
    jest
      .spyOn(VipOrderModel, 'findOrCreate')
      .mockResolvedValue([order as any, false]);
    const service = new VipService();
    service.vipMembershipService = new VipMembershipService();

    const result = await service.grantInfinityVip('openid-infinity');

    expect(result.active).toBe(true);
    expect(VipOrderModel.findOrCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        defaults: expect.objectContaining({
          order_no: null,
          plan_id: 'infinity',
          status: 'GRANTED',
          membership_end_at: null,
        }),
      })
    );
  });

  it('returns only one active infinity VIP in user information', async () => {
    const findAll = jest.spyOn(VipOrderModel, 'findAll').mockResolvedValue([
      {
        order_no: 'VIP_INFINITY',
        plan_id: 'infinity',
        plan_snapshot: { name: '永久会员', memberType: 'infinity' },
        membership_start_at: new Date('2026-01-01T00:00:00.000Z'),
        membership_end_at: null,
      },
    ] as any);
    const service = new VipService();
    service.vipMembershipService = new VipMembershipService();

    const result = await service.getVipInfo('openid-infinity');

    expect(result).toEqual([
      {
        type: 'infinity',
        name: '永久会员',
        active: true,
        available_start: new Date('2026-01-01T00:00:00.000Z'),
        available_end: null,
      },
    ]);
    expect(findAll).toHaveBeenCalled();
  });
});

describe('VipAuthMiddleware membership expiry', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('marks an infinity user active without checking member type', async () => {
    const middleware = new VipAuthMiddleware();
    middleware.vipMembershipService = {
      getCurrentMembership: jest.fn().mockResolvedValue({
        type: 'infinity',
        active: true,
      }),
    } as any;
    middleware.authService = {
      verifyAccessToken: jest.fn().mockReturnValue({
        sub: 'openid-1',
        lane: 'whale',
      }),
    } as any;
    const ctx = {
      get: jest.fn().mockReturnValue('Bearer token'),
    } as any;
    const next = jest.fn().mockResolvedValue('next');

    const result = await middleware.resolve()(ctx, next);

    expect(result).toBe('next');
    expect(ctx.vipAuth).toEqual({
      openid: 'openid-1',
      lane: 'whale',
      vipType: 'infinity',
      vipActive: true,
    });
  });
});
