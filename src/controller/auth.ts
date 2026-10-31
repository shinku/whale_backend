import { Inject, Post, Provide } from '@midwayjs/core';
import { Context } from 'egg';
import { LANE } from '../core/enums';
import { AuthService } from '../service/AuthService';
import { VipService } from '../service/VipService';
import { WehchatApiService } from '../service/WechatApiService';
import Api from './api/Api';

@Provide()
@Api('/auth')
export class AuthController {
  @Inject()
  ctx!: Context;

  @Inject()
  authService!: AuthService;

  @Inject()
  vipService!: VipService;

  @Inject()
  wechatService!: WehchatApiService;

  @Post('/wechat-login')
  async wechatLogin() {
    const { code } = this.ctx.request.body || {};
    const lane = this.ctx.lane || LANE.WHALE;
    const loginResult = await this.wechatService.exchangeLoginCode(code);
    const openid = String(loginResult.openid);
    console.log({
      code,
      lane,
      loginResult
    })
    const token = this.authService.signAccessToken(openid, lane);
    return {
      data: {
        ...token,
        user: {
          openid,
        },
      },
    };
  }
}
