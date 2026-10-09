import { Get, Inject, Post, Provide } from '@midwayjs/core';
import { randomUUID } from 'crypto';
import { Context } from 'egg';
import { AI_SUBJECT_STORE_TTL } from '../core/limits';
import { AiSubjectStoreModel } from '../model/AiSubjectStoreModel';
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
   *
   * 每次调用生成一个唯一 requestid，结果落库 ai_subject_store（有效期 24 小时），
   * 返回值同时带上 requestid，前端可凭它通过 GET /api/ai/subjects 复查结果。
   */
  @Post('/subjects')
  async getSubjects() {
    const {config, prompt } = this.ctx.request.body;
    if (!config || !prompt) {
      throw new Error('config and prompt are required');
    }
    const systemPrompt = prompt
    const requestid = randomUUID();
    const content = await this.aiService.chatWithDeepSeek(
      JSON.stringify(config),
      systemPrompt
    );
    await AiSubjectStoreModel.create({
      requestid,
      store_content: content,
    });
    return {
      data: content,
      requestid,
    };
  }

  /**
   * 按 requestid 查询出题结果
   * GET /api/ai/subjects?requestid=xxx
   *
   * 结果只保留 24 小时：超过 24 小时的记录即使还没被定时任务清理，也按已过期处理。
   */
  @Get('/subjects')
  async getSubjectByRequestId() {
    const requestid = this.ctx.query.requestid || this.ctx.query.requestId;
    if (!requestid) {
      throw new Error('requestid is required');
    }
    const record = await AiSubjectStoreModel.findOne({
      where: { requestid },
    });
    if (!record) {
      throw new Error('subject not found');
    }
    if (
      Date.now() - new Date(record.createdAt).getTime() >
      AI_SUBJECT_STORE_TTL
    ) {
      throw new Error('subject is expired');
    }
    return {
      data: record.store_content,
      requestid: record.requestid,
    };
  }
}
