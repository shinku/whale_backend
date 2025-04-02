import { Inject, Post, Provide } from '@midwayjs/core';
import { Context } from 'egg';
import Api from './api/Api';

@Api('/operate')
@Provide()
export class OperateController {
  @Inject()
  ctx: Context;

  @Post('/leaveMessage')
  async leaveMessage() {
    const { message, image } = this.ctx.request.body as {
      message: string;
      image: string; // base64
    };
    return {
      message,
      image,
    };
  }
}
