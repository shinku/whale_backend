import { ChatOpenAI } from '@langchain/openai';
import { Config, Provide } from '@midwayjs/core';
import axios from 'axios';

export interface DeepSeekAgentModelOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}

@Provide()
export class DeepSeekService {
  @Config('deepseek')
  config!: {
    appId: string;
  };

  async chatWithDeepSeek(prompt: string, systemPrompt?: string) {
    const apiKey = this.config?.appId;
    if (!apiKey) {
      throw new Error('DeepSeek API key is not configured');
    }
    try {
      const response = await axios.post(
        'https://api.deepseek.com/v1/chat/completions',
        {
          model: 'deepseek-chat',
          messages: [
            ...(systemPrompt
              ? [{ role: 'system', content: systemPrompt }]
              : []),
            { role: 'user', content: prompt },
          ],
          temperature: 0.7,
        },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 120000,
        }
      );
      return String(response.data?.choices?.[0]?.message?.content || '');
    } catch (error) {
      console.error('DeepSeek API Error:', error);
      throw new Error('Failed to get response from DeepSeek API');
    }
  }

  createAgentChatModel(options: DeepSeekAgentModelOptions = {}) {
    const apiKey = this.config?.appId;
    if (!apiKey) {
      throw new Error('DeepSeek API key is not configured');
    }
    return new ChatOpenAI({
      model: options.model || 'deepseek-chat',
      apiKey,
      temperature: options.temperature ?? 0.3,
      maxTokens: options.maxTokens ?? 16384,
      streaming: true,
      configuration: {
        baseURL: 'https://api.deepseek.com/v1',
        timeout: options.timeoutMs ?? 120000,
      },
    });
  }
}
