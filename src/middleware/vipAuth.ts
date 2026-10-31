import { Inject, Middleware } from '@midwayjs/core';
import { Context, IMiddleware } from 'egg';
import { BusinessError } from '../core/errors';
import { isVipActive } from '../core/vip';
import { UserVipModel } from '../model/UserVipModel';
import { AuthService } from '../service/AuthService';

@Middleware()
export class VipAuthMiddleware implements IMiddleware {
  @Inject()
  authService!: AuthService;

  resolve() {
    return async (ctx: Context<any>, next: () => Promise<any>) => {
      const authorization = ctx.get('authorization');
      const match = authorization.match(/^Bearer\s+(.+)$/i);
      if (!match) {
        throw new BusinessError('请先登录', 401, 'AUTH_REQUIRED');
      }
      const payload = this.authService.verifyAccessToken(match[1].trim());
      const vipRecord = await UserVipModel.findOne({
        attributes: ['type', 'available_start', 'available_end'],
        where: {
          user_id: payload.sub,
        },
        raw: true,
      });
      ctx.vipAuth = {
        openid: payload.sub,
        lane: payload.lane,
        vipType: vipRecord?.type || 'guest',
        vipActive: vipRecord
          ? isVipActive(vipRecord.type, vipRecord.available_end)
          : false,
      };
      return next();
    };
  }
}
