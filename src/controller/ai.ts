import { Inject, Post, Provide } from '@midwayjs/core';
import { Context } from 'egg';
import { AIService } from '../service/AiService';
import Api from './api/Api';

@Provide()
@Api('/ai')
export class Ai {
  @Inject()
  ctx: Context;

  @Inject()
  aiService: AIService;

  @Post('/activity')
  async getActivity() {
    const { actId, config } = this.ctx.request.body;

    await this.aiService.getPrompt(actId);
    return this.aiService.chatWithDeepSeek(JSON.stringify(config));
  }
}
