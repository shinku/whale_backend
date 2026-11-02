import { VipCheckMiddleware } from '../../src/middleware/vipCheck';
import { DEFAULT_EXTRA_CONFIG } from '../../src/service/ExtraConfigService';

function createMiddleware(
  membership: Record<string, any> | null = {
    type: 'monthly',
    active: true,
  }
) {
  const middleware = new VipCheckMiddleware();
  middleware.authService = {
    verifyAccessToken: jest.fn().mockReturnValue({
      sub: 'openid-token',
      lane: 'whale',
    }),
  } as any;
  middleware.extraConfigService = {
    getConfig: jest.fn().mockReturnValue({
      ...DEFAULT_EXTRA_CONFIG,
      vipCheckEnabled: true,
    }),
  } as any;
  middleware.vipMembershipService = {
    getCurrentMembership: jest.fn().mockResolvedValue(membership),
  } as any;
  return middleware;
}

describe('VipCheckMiddleware', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-31T00:00:00.000Z'));
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('continues when a normal membership has not expired', async () => {
    const ctx = {
      userId: 'openid-1',
      get: jest.fn().mockReturnValue(undefined),
    } as any;
    const next = jest.fn().mockResolvedValue('next');

    await expect(createMiddleware().resolve()(ctx, next)).resolves.toBe('next');
    expect(ctx.vipCheck).toEqual({
      openid: 'openid-1',
      vipType: 'monthly',
      vipActive: true,
    });
  });

  it('continues for infinity even when the stored expiry is stale', async () => {
    const middleware = createMiddleware({
      type: 'infinity',
      active: true,
    });
    const ctx = {
      userId: 'openid-infinity',
      get: jest.fn().mockReturnValue(undefined),
    } as any;
    const next = jest.fn().mockResolvedValue('next');

    await expect(middleware.resolve()(ctx, next)).resolves.toBe('next');
  });

  it('rejects an expired membership', async () => {
    const middleware = createMiddleware(null);
    const ctx = {
      userId: 'openid-expired',
      get: jest.fn().mockReturnValue(undefined),
    } as any;
    const next = jest.fn();

    await expect(middleware.resolve()(ctx, next)).rejects.toMatchObject({
      status: 403,
      code: 'VIP_REQUIRED',
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('prefers the authenticated Bearer token user', async () => {
    const middleware = createMiddleware({
      type: 'guest',
      active: true,
    });
    const get = jest.fn((name: string) =>
      name.toLowerCase() === 'authorization' ? 'Bearer signed-token' : undefined
    );
    const ctx = {
      userId: 'spoofed-openid',
      get,
    } as any;

    await middleware.resolve()(ctx, jest.fn().mockResolvedValue('next'));

    expect(middleware.authService.verifyAccessToken).toHaveBeenCalledWith(
      'signed-token'
    );
    expect(
      middleware.vipMembershipService.getCurrentMembership
    ).toHaveBeenCalledWith('openid-token');
  });

  it('allows all requests when VIP checking is disabled', async () => {
    const middleware = new VipCheckMiddleware();
    middleware.extraConfigService = {
      getConfig: jest.fn().mockReturnValue({
        ...DEFAULT_EXTRA_CONFIG,
        vipCheckEnabled: false,
      }),
    } as any;
    middleware.vipMembershipService = {
      getCurrentMembership: jest.fn(),
    } as any;
    const ctx = {
      get: jest.fn(),
    } as any;
    const next = jest.fn().mockResolvedValue('next');

    await expect(middleware.resolve()(ctx, next)).resolves.toBe('next');
    expect(
      middleware.vipMembershipService.getCurrentMembership
    ).not.toHaveBeenCalled();
    expect(ctx.get).not.toHaveBeenCalled();
  });
});
