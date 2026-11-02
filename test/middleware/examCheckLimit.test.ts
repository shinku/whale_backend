import {
  EXAM_HELP_CHECK_FEATURE,
  ExamCheckLimitMiddleware,
} from '../../src/middleware/examCheckLimit';
import { DEFAULT_EXTRA_CONFIG } from '../../src/service/ExtraConfigService';

function createMiddleware() {
  const middleware = new ExamCheckLimitMiddleware();
  middleware.extraConfigService = {
    getConfig: jest.fn().mockReturnValue({
      ...DEFAULT_EXTRA_CONFIG,
      examCheckDailyLimit: 5,
    }),
  } as any;
  middleware.betaLimitService = {
    check: jest.fn().mockResolvedValue({
      openid: 'openid-1',
      feature: EXAM_HELP_CHECK_FEATURE,
      usageDate: '2026-10-31',
      used: 2,
      limit: 5,
      remaining: 3,
    }),
  } as any;
  return middleware;
}

describe('ExamCheckLimitMiddleware', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('checks the configured daily quota for the VIP user', async () => {
    const middleware = createMiddleware();
    const ctx = {
      vipCheck: {
        openid: 'openid-1',
      },
      get: jest.fn(),
    } as any;
    const next = jest.fn().mockResolvedValue('next');

    await expect(middleware.resolve()(ctx, next)).resolves.toBe('next');
    expect(middleware.betaLimitService.check).toHaveBeenCalledWith(
      'openid-1',
      EXAM_HELP_CHECK_FEATURE,
      5
    );
    expect(ctx.betaLimit).toEqual(
      expect.objectContaining({
        openid: 'openid-1',
        used: 2,
        limit: 5,
      })
    );
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('requires a logged-in user before checking quota', async () => {
    const middleware = createMiddleware();
    const ctx = {
      get: jest.fn(),
    } as any;
    const next = jest.fn();

    await expect(middleware.resolve()(ctx, next)).rejects.toMatchObject({
      status: 401,
      code: 'AUTH_REQUIRED',
    });
    expect(middleware.betaLimitService.check).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });
});
