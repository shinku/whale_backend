import { Get, Inject, Post, Provide } from '@midwayjs/core';
import { Context } from 'egg';
import { WechatMessagePushService } from '../service/WechatMessagePushService';
import Api from './api/Api';

@Provide()
@Api()
export class WechatMessagePushController {
  @Inject()
  ctx!: Context;

  @Inject()
  messagePushService!: WechatMessagePushService;

  @Get('/wx_message')
  async verifyUrl() {
    const result = this.messagePushService.verifyUrl(this.ctx.query);
    this.ctx.type = 'text/plain';
    return result;
  }

  @Post('/wx_message')
  async receiveMessage() {
    await this.messagePushService.handleMessage(
      this.ctx.query,
      this.ctx.request.body || {}
    );
    this.ctx.type = 'text/plain';
    return 'success';
  }
}
