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

  /***
   * 老的接口，保留一段时间，方便前端过渡
   */
  @Post('/activity')
  async getActivity() {
    const { actId, config, prompt } = this.ctx.request.body;
    const systemPrompt = prompt || await this.promptService.getPrompt(actId);
    return this.aiService.chatWithDeepSeek(
      JSON.stringify(config),
      systemPrompt
    );
  }

  /**
   * 新的接口，直接传入配置和 system prompt
   * @returns 
   */
  @Post('/subjects')
  async getSubjects() {
    const {config, prompt } = this.ctx.request.body;
    if (!config || !prompt) {
      throw new Error('config and prompt are required');
    }
    const systemPrompt = prompt
    return this.aiService.chatWithDeepSeek(
      JSON.stringify(config),
      systemPrompt
    );
  }
}
