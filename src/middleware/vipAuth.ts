import { Inject, Middleware } from '@midwayjs/core';
import { Context, IMiddleware } from 'egg';
import { BusinessError } from '../core/errors';
import { AuthService } from '../service/AuthService';
import { VipMembershipService } from '../service/VipMembershipService';

@Middleware()
export class VipAuthMiddleware implements IMiddleware {
  @Inject()
  authService!: AuthService;

  @Inject()
  vipMembershipService!: VipMembershipService;

  resolve() {
    return async (ctx: Context<any>, next: () => Promise<any>) => {
      const authorization = ctx.get('authorization');
      const match = authorization.match(/^Bearer\s+(.+)$/i);
      if (!match) {
        throw new BusinessError('请先登录', 401, 'AUTH_REQUIRED');
      }
      const payload = this.authService.verifyAccessToken(match[1].trim());
      const membership = await this.vipMembershipService.getCurrentMembership(
        payload.sub
      );
      ctx.vipAuth = {
        openid: payload.sub,
        lane: payload.lane,
        vipType: membership?.type || 'guest',
        vipActive: Boolean(membership?.active),
      };
      return next();
    };
  }
}
