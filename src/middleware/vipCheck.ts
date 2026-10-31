import { Inject, Middleware } from '@midwayjs/core';
import { Context, IMiddleware } from 'egg';
import { BusinessError } from '../core/errors';
import { isVipActive } from '../core/vip';
import { UserVipModel } from '../model/UserVipModel';
import { AuthService } from '../service/AuthService';
import {
  DEFAULT_EXTRA_CONFIG,
  ExtraConfigService,
} from '../service/ExtraConfigService';

@Middleware()
export class VipCheckMiddleware implements IMiddleware {
  @Inject()
  authService!: AuthService;

  @Inject()
  extraConfigService!: ExtraConfigService;

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

      const vipRecord = await UserVipModel.findOne({
        attributes: ['type', 'available_start', 'available_end'],
        where: {
          user_id: openid,
        },
        raw: true,
      });
      const vipActive = vipRecord
        ? isVipActive(vipRecord.type, vipRecord.available_end)
        : false;
      ctx.vipCheck = {
        openid,
        vipType: vipRecord?.type || 'guest',
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
