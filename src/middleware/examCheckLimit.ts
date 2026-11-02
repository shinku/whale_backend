import { Inject, Middleware } from '@midwayjs/core';
import { Context, IMiddleware } from 'egg';
import { BusinessError } from '../core/errors';
import { BetaLimitQuota, BetaLimitService } from '../service/BetaLimitService';
import {
  DEFAULT_EXTRA_CONFIG,
  ExtraConfigService,
} from '../service/ExtraConfigService';

export const EXAM_HELP_CHECK_FEATURE = 'exam_help_check';

@Middleware()
export class ExamCheckLimitMiddleware implements IMiddleware {
  @Inject()
  betaLimitService!: BetaLimitService;

  @Inject()
  extraConfigService!: ExtraConfigService;

  resolve() {
    return async (ctx: Context<any>, next: () => Promise<any>) => {
      const openid = ctx.vipCheck?.openid || ctx.userId || ctx.get('x-user-id');
      if (!openid) {
        throw new BusinessError('请先登录', 401, 'AUTH_REQUIRED');
      }

      const extraConfig =
        this.extraConfigService?.getConfig() || DEFAULT_EXTRA_CONFIG;
      const quota: BetaLimitQuota = await this.betaLimitService.check(
        openid,
        EXAM_HELP_CHECK_FEATURE,
        extraConfig.examCheckDailyLimit
      );
      ctx.betaLimit = quota;
      return next();
    };
  }
}
