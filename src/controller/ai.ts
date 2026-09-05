import { Get, Inject, Post, Provide } from '@midwayjs/core';
import { Context } from 'egg';
import { AIService } from '../service/AiService';
import { PromptService } from '../service/PromptService';
import Api from './api/Api';

@Provide()
@Api('/ai')
export class Ai {
  @Inject()
  ctx!: Context;

  @Inject()
  aiService!: AIService;

  @Inject()
  promptService!: PromptService;

  @Get('/activity')
  async getActivityList() {
    return {
      data: await this.promptService.getPromptList()
    };
  }

  @Post('/activity')
  async getActivity() {
    const { actId, config } = this.ctx.request.body;
    const systemPrompt = await this.promptService.getPrompt(actId);
    return this.aiService.chatWithDeepSeek(
      JSON.stringify(config),
      systemPrompt
    );
  }
}
