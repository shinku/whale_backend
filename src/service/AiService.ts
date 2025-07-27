import { Config, Init, Provide } from '@midwayjs/core';
import axios from 'axios';

class DeepSeekClient {
  config: {
    appId: string;
  };
  systemPrompt: string;
  constructor(option: { appId: string }) {
    this.config = {
      appId: option.appId,
    };
  }

  private getApiUrl() {
    return 'https://api.deepseek.com/v1';
  }

  async chatCompletion(
    promots: {
      chat: string;
      history?: string[];
    },
    options: {
      model?: string;
      temperature?: number;
      max_tokens?: number;
    } = {}
  ) {
    try {
      const response = await axios.post(
        `${this.getApiUrl()}/chat/completions`,
        {
          model: options.model || 'deepseek-chat',
          messages: [
            { role: 'system', content: this.systemPrompt },
            { role: 'user', content: promots.chat },
          ],
          temperature: options.temperature || 0.7,
          max_tokens: options.max_tokens || 2048,
        },
        {
          headers: {
            Authorization: `Bearer ${this.config.appId}`,
            'Content-Type': 'application/json',
          },
        }
      );

      return response.data.choices[0].message.content;
    } catch (error) {
      console.error('DeepSeek API Error:', error);
      throw new Error('Failed to get response from DeepSeek API');
    }
  }
}

@Provide()
export class AIService {
  @Config('deepseek')
  config: {
    appId: string;
  };

  deepSeekClient: DeepSeekClient;

  @Init()
  init() {
    this.deepSeekClient = new DeepSeekClient({
      appId: this.config.appId,
    });
  }

  async getPrompt(actId: string) {
    switch (actId) {
      case '1': {
        this.deepSeekClient.systemPrompt =
          '你非常擅长写作文，你将基于我听过的要求，包括作文主题，作文类型，语言类型，以及作文字数写一篇作文，给我参考';
        break;
      }
      case 'caculate': {
        this.deepSeekClient.systemPrompt =
          '你是一个小学的数学老师，你将基于我给的的提示给出几道基础的计算题目。并以回车区分每一道题目';
        break;
      }
    }
    // return this.deepSeekClient;
  }

  async chatWithDeepSeek(prompt: string): Promise<string> {
    return this.deepSeekClient.chatCompletion({
      chat: prompt,
    });
  }
}
