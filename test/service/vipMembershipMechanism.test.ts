import {
  calculateMembershipExtension,
  isMembershipActive,
  isVipActive,
} from '../../src/core/vip';
import { UserModel } from '../../src/model/UserModel';
import { UserVipModel } from '../../src/model/UserVipModel';
import { VipOrderModel } from '../../src/model/VipOrderModel';
import { VipAuthMiddleware } from '../../src/middleware/vipAuth';
import { DEFAULT_EXTRA_CONFIG } from '../../src/service/ExtraConfigService';
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

  it('creates a three-day guest record in user_vip_record and vip_order', async () => {
    const now = new Date();
    const record = {
      user_id: 'openid-guest',
      type: 'guest',
      available_start: now,
      available_end: new Date(now.getTime() + 3 * 86400000),
    };
    jest
      .spyOn(UserVipModel, 'findOrCreate')
      .mockResolvedValue([record as any, true]);
    jest
      .spyOn(VipOrderModel, 'findOrCreate')
      .mockResolvedValue([{} as any, true]);
    const service = new VipService();

    const result = await service.userVipInitializatin('openid-guest');

    expect(result.type).toBe('guest');
    expect(result.available_end).toEqual(record.available_end);
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
          membership_end_at: record.available_end,
        }),
      })
    );
  });

  it('does not initialize a new guest VIP when disabled', async () => {
    jest.spyOn(UserVipModel, 'findOne').mockResolvedValue(null);
    const findOrCreate = jest.spyOn(UserVipModel, 'findOrCreate');
    const service = new VipService();
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
    const record = {
      user_id: 'openid-custom-guest',
      type: 'guest',
      available_start: now,
      available_end: new Date(now.getTime() + 7 * 86400000),
    };
    jest
      .spyOn(UserVipModel, 'findOrCreate')
      .mockResolvedValue([record as any, true]);
    jest
      .spyOn(VipOrderModel, 'findOrCreate')
      .mockResolvedValue([{} as any, true]);
    const service = new VipService();
    service.extraConfigService = {
      getConfig: jest.fn().mockReturnValue({
        ...DEFAULT_EXTRA_CONFIG,
        guestValidityDays: 7,
      }),
    } as any;

    const result = await service.userVipInitializatin('openid-custom-guest');

    expect(result.available_end).toEqual(record.available_end);
    expect(VipOrderModel.findOrCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        defaults: expect.objectContaining({
          membership_end_at: record.available_end,
          plan_snapshot: expect.objectContaining({
            durationDays: 7,
          }),
        }),
      })
    );
  });

  it('grants infinity only through the special service path', async () => {
    const record = {
      user_id: 'openid-infinity',
      type: 'guest',
      available_start: new Date('2026-10-01T00:00:00.000Z'),
      available_end: new Date('2026-11-01T00:00:00.000Z'),
      save: jest.fn().mockResolvedValue(undefined),
    };
    jest.spyOn(UserModel, 'findOne').mockResolvedValue({} as any);
    jest
      .spyOn(UserVipModel, 'findOrCreate')
      .mockResolvedValue([record as any, false]);
    jest
      .spyOn(VipOrderModel, 'findOrCreate')
      .mockResolvedValue([{} as any, true]);
    const service = new VipService();

    const result = await service.grantInfinityVip('openid-infinity');

    expect(record.type).toBe('infinity');
    expect(record.available_end).toBeNull();
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
    jest.spyOn(UserVipModel, 'findOne').mockResolvedValue({
      type: 'infinity',
      available_start: new Date('2026-01-01T00:00:00.000Z'),
      available_end: new Date('2020-01-01T00:00:00.000Z'),
    } as any);
    const findAll = jest.spyOn(VipOrderModel, 'findAll');
    const service = new VipService();

    const result = await service.getVipInfo('openid-infinity');

    expect(result).toEqual([
      {
        type: 'infinity',
        name: '永久会员',
        active: true,
        available_start: new Date('2026-01-01T00:00:00.000Z'),
        available_end: new Date('2020-01-01T00:00:00.000Z'),
      },
    ]);
    expect(findAll).not.toHaveBeenCalled();
  });
});

describe('VipAuthMiddleware membership expiry', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('marks an infinity user active without checking member type', async () => {
    jest.spyOn(UserVipModel, 'findOne').mockResolvedValue({
      type: 'infinity',
      available_start: new Date('2026-01-01T00:00:00.000Z'),
      available_end: null,
    } as any);
    const middleware = new VipAuthMiddleware();
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
