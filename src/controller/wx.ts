import { Inject, Post, Provide } from '@midwayjs/core';
import { Context } from 'egg';
import { WehchatApiService } from '../service/WechatApiService';
import Api from './api/Api';

@Provide()
@Api('/wx')
export class Wx {
  @Inject()
  ctx: Context;

  @Inject()
  wxService: WehchatApiService;

  @Post('/decrype_info')
  async descrypeInfo() {
    const { encrypted_data, iv, session_key } = this.ctx.request.body;
    return this.wxService.decryptPhoneNumber(session_key, encrypted_data, iv);
  }
}
