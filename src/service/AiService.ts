import { Inject, Provide } from '@midwayjs/core';
import { DeepSeekService } from './DeepSeekService';

/**
 * 兼容原有 subject/activity 接口的 AI 服务。
 * DeepSeek 调用统一收敛到 DeepSeekService。
 */
@Provide()
export class AIService {
  @Inject()
  deepSeekService!: DeepSeekService;

  async chatWithDeepSeek(
    prompt: string,
    systemPrompt?: string
  ): Promise<string> {
    return this.deepSeekService.chatWithDeepSeek(prompt, systemPrompt);
  }
}
