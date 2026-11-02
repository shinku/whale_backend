import { Inject, Middleware } from '@midwayjs/core';
import { Context, IMiddleware } from 'egg';
import { BusinessError } from '../core/errors';
import { AuthService } from '../service/AuthService';
import {
  DEFAULT_EXTRA_CONFIG,
  ExtraConfigService,
} from '../service/ExtraConfigService';
import { VipMembershipService } from '../service/VipMembershipService';

@Middleware()
export class VipCheckMiddleware implements IMiddleware {
  @Inject()
  authService!: AuthService;

  @Inject()
  extraConfigService!: ExtraConfigService;

  @Inject()
  vipMembershipService!: VipMembershipService;

  resolve() {
    return async (ctx: Context<any>, next: () => Promise<any>) => {
      const extraConfig =
        this.extraConfigService?.getConfig() || DEFAULT_EXTRA_CONFIG;
      if (!extraConfig.vipCheckEnabled) {
        return next();
      }

      let openid = ctx.userId || ctx.get('x-user-id');
      const authorization = ctx.get('authorization');
      if (authorization) {
        const match = authorization.match(/^Bearer\s+(.+)$/i);
        if (!match) {
          throw new BusinessError('请先登录', 401, 'AUTH_REQUIRED');
        }
        openid = this.authService.verifyAccessToken(match[1].trim()).sub;
      }
      if (!openid) {
        throw new BusinessError('请先登录', 401, 'AUTH_REQUIRED');
      }

      const membership = await this.vipMembershipService.getCurrentMembership(
        openid
      );
      const vipActive = Boolean(membership?.active);
      ctx.vipCheck = {
        openid,
        vipType: membership?.type || 'guest',
        vipActive,
      };
      if (!vipActive) {
        throw new BusinessError(
          '当前会员已过期，请先续费',
          403,
          'VIP_REQUIRED'
        );
      }
      return next();
    };
  }
}
