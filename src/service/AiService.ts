import { Config, Init, Provide } from '@midwayjs/core';
import axios from 'axios';

class DeepSeekClient {
  config: {
    appId: string;
  };
  systemPrompt!: string;
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
  config!: {
    appId: string;
  };

  deepSeekClient!: DeepSeekClient;

  @Init()
  init() {
    this.deepSeekClient = new DeepSeekClient({
      appId: this.config.appId,
    });
  }

  async chatWithDeepSeek(
    prompt: string,
    systemPrompt?: string
  ): Promise<string> {
    if (systemPrompt) {
      this.deepSeekClient.systemPrompt = systemPrompt;
    }
    return this.deepSeekClient.chatCompletion({
      chat: prompt,
    });
  }
}
