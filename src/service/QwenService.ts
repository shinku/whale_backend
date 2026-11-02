import { Config, Provide } from '@midwayjs/core';
import { ChatOpenAI } from '@langchain/openai';
import { randomUUID } from 'crypto';
import OpenAI, { APIConnectionTimeoutError, APIError } from 'openai';
import { BusinessError } from '../core/errors';

interface QwenConfig {
  appkey: string;
}

export type QwenChatMessage = OpenAI.Chat.ChatCompletionMessageParam;

export type QwenMessageContentPart = OpenAI.Chat.ChatCompletionContentPart;

export interface QwenChatOptions {
  model?: string;
  temperature?: number;
  maxCompletionTokens?: number;
  /** 默认关闭，只有显式传 true 时才开启 thinking。 */
  enableThinking?: boolean;
  responseFormat?: 'json_object';
}

export interface QwenAgentModelOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  enableThinking?: boolean;
  timeoutMs?: number;
}

export type ExamSubject = '数学' | '英语' | '语文' | '历史' | '地理';

export interface ExamCoordinate {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface ExamSubQuestionResult {
  id: string;
  questionText: string;
  studentAnswer: string;
  correct: boolean;
  correctAnswer: string | null;
  coordinate: ExamCoordinate;
}

export interface ExamQuestionResult extends ExamSubQuestionResult {
  type: 'choice' | 'fill_blank' | 'short_answer' | 'other';
  subQuestions: ExamSubQuestionResult[];
}

export interface ExamCheckResult {
  subject: ExamSubject;
  questions: ExamQuestionResult[];
}

export interface ExamCheckInput {
  image: string;
  model?: string;
  maxCompletionTokens?: number;
}

const QWEN_API_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const DEFAULT_QWEN_MODEL = 'qwen3.7-plus';
const DEFAULT_EXAM_CHECK_MAX_TOKENS = 16384;
const QWEN_REQUEST_TIMEOUT_MS = 60000;

type QwenChatCompletionRequest =
  OpenAI.Chat.ChatCompletionCreateParamsStreaming & {
    enable_thinking?: boolean;
  };

const EXAM_CHECK_PROMPT = `你是一名严谨的作业批改老师，负责根据用户提供的作业图片批改题目。

首先判断作业科目，科目只能是数学、英语、语文、历史、地理。然后完整识别图片中的所有题目，并逐题判断学生答案是否正确。必须严格输出合法 JSON，不要输出 Markdown 代码块或任何解释文字。

坐标规则：
1. coordinate 使用原图归一化坐标，x1/y1/x2/y2 取值范围均为 0 到 1。
2. 坐标原点在图片左上角，x 向右递增，y 向下递增。
3. 坐标必须覆盖题目文字和作答区域，不要覆盖无关内容。

题目规则：
1. 普通题目的 subQuestions 返回空数组。
2. 填空题、多空题必须按树形结构返回：大题通过 coordinate 标记大题范围，小题放在 subQuestions 中，并按作答顺序排列。
3. 每道题必须包含 id、type、questionText、studentAnswer、correct、correctAnswer、coordinate。
4. correct 必须是布尔值。正确时 correctAnswer 为 null；错误时 correctAnswer 填写完整正确答案。
5. 看不清、无法确定作答或无法判断时，不要臆测，correct 返回 false，并在 correctAnswer 中说明“无法识别，请重新拍摄”。
6. type 只能是 choice、fill_blank、short_answer、other。
7. 输出结构只要JSON，不要任何额外的内容！！
输出结构：
{
  "subject": "数学",
  "questions": [
    {
      "id": "1",
      "type": "fill_blank",
      "questionText": "大题题干",
      "studentAnswer": "学生在该大题的整体作答（没有则为空字符串）",
      "correct": false,
      "correctAnswer": "大题的正确答案（没有则为 null）",
      "coordinate": { "x1": 0.05, "y1": 0.10, "x2": 0.95, "y2": 0.30 },
      "subQuestions": [
        {
          "id": "1.1",
          "questionText": "小题题干",
          "studentAnswer": "学生答案",
          "correct": true,
          "correctAnswer": null,
          "coordinate": { "x1": 0.05, "y1": 0.12, "x2": 0.95, "y2": 0.18 }
        }
      ]
    }
  ]
}`;

@Provide()
export class QwenService {
  @Config('qwen')
  config!: QwenConfig;

  private client: OpenAI | null = null;
  private clientAppKey = '';

  async chat(messages: QwenChatMessage[], options: QwenChatOptions = {}) {
    const appkey = this.config?.appkey;
    if (!appkey) {
      throw new BusinessError('Qwen 模型未配置', 503, 'QWEN_NOT_CONFIGURED');
    }

    const model = options.model || DEFAULT_QWEN_MODEL;
    const enableThinking = options.enableThinking ?? false;
    const chatId = randomUUID();
    const startedAt = Date.now();
    const messageSummary = this.summarizeMessages(messages);
    console.log('[qwen] chat request', {
      chatId,
      model,
      baseURL: QWEN_API_URL,
      timeoutMs: QWEN_REQUEST_TIMEOUT_MS,
      maxRetries: 0,
      stream: true,
      temperature: options.temperature,
      maxCompletionTokens: options.maxCompletionTokens,
      enableThinking,
      responseFormat: options.responseFormat,
      messageCount: messages.length,
      textCharacters: messageSummary.textCharacters,
      imageCount: messageSummary.imageCount,
      imagePayloadCharacters: messageSummary.imagePayloadCharacters,
      messages: messageSummary.messages,
    });
    try {
      const request: QwenChatCompletionRequest = {
        model,
        messages,
        stream: true,
        ...(options.temperature !== undefined
          ? { temperature: options.temperature }
          : {}),
        ...(options.maxCompletionTokens !== undefined
          ? { max_completion_tokens: options.maxCompletionTokens }
          : {}),
        enable_thinking: enableThinking,
        ...(options.responseFormat
          ? {
              response_format: {
                type: options.responseFormat,
              },
            }
          : {}),
      };
      const stream = await this.getClient(appkey).chat.completions.create(
        request
      );
      return stream;
    } catch (error: unknown) {
      const apiError = error instanceof APIError ? error : null;
      const cause =
        error instanceof Error
          ? (error as Error & { cause?: unknown }).cause
          : undefined;
      const causeCode =
        cause && typeof cause === 'object' && 'code' in cause
          ? String((cause as { code?: unknown }).code || '')
          : '';
      const isTimeout =
        error instanceof APIConnectionTimeoutError ||
        apiError?.code === 'ETIMEDOUT' ||
        causeCode.toUpperCase().includes('TIMEOUT');
      console.error('[qwen] chat failed', {
        chatId,
        model,
        baseURL: QWEN_API_URL,
        durationMs: Date.now() - startedAt,
        timeoutMs: QWEN_REQUEST_TIMEOUT_MS,
        isTimeout,
        messageCount: messages.length,
        textCharacters: messageSummary.textCharacters,
        imageCount: messageSummary.imageCount,
        imagePayloadCharacters: messageSummary.imagePayloadCharacters,
        errorType:
          error instanceof Error ? error.constructor.name : typeof error,
        status: apiError?.status,
        code: apiError?.code,
        requestId: apiError?.requestID,
        message:
          apiError?.message ||
          (error instanceof Error ? error.message : 'unknown'),
        causeCode: causeCode || null,
        causeMessage:
          cause instanceof Error ? cause.message : cause ? String(cause) : null,
      });
      throw new BusinessError('Qwen 模型调用失败', 502, 'QWEN_REQUEST_FAILED');
    }
  }

  private getClient(appkey: string) {
    if (!this.client || this.clientAppKey !== appkey) {
      this.client = new OpenAI({
        apiKey: appkey,
        baseURL: QWEN_API_URL,
        timeout: QWEN_REQUEST_TIMEOUT_MS,
        maxRetries: 0,
      });
      this.clientAppKey = appkey;
    }
    return this.client;
  }

  createAgentChatModel(options: QwenAgentModelOptions = {}) {
    const appkey = this.config?.appkey;
    if (!appkey) {
      throw new BusinessError('Qwen 模型未配置', 503, 'QWEN_NOT_CONFIGURED');
    }

    return new ChatOpenAI({
      model: options.model || DEFAULT_QWEN_MODEL,
      apiKey: appkey,
      temperature: options.temperature ?? 0.3,
      maxTokens: options.maxTokens ?? 16384,
      streaming: true,
      configuration: {
        baseURL: QWEN_API_URL,
        timeout: options.timeoutMs ?? 120000,
      },
      modelKwargs: {
        enable_thinking: options.enableThinking ?? false,
      },
    });
  }

  private summarizeMessages(messages: QwenChatMessage[]) {
    let textCharacters = 0;
    let imageCount = 0;
    let imagePayloadCharacters = 0;
    const summary = messages.map(message => {
      const content = message.content;
      if (typeof content === 'string') {
        textCharacters += content.length;
        return {
          role: message.role,
          contentType: 'text',
          textLength: content.length,
          imageCount: 0,
        };
      }
      if (!Array.isArray(content)) {
        return {
          role: message.role,
          contentType: 'empty',
          textLength: 0,
          imageCount: 0,
        };
      }

      let textLength = 0;
      let messageImageCount = 0;
      const parts = content.map(rawPart => {
        const part = rawPart as {
          type?: string;
          text?: string;
          image_url?: { url?: string };
        };
        if (part.type === 'text') {
          const length = String(part.text || '').length;
          textLength += length;
          return {
            type: 'text',
            textLength: length,
          };
        }
        if (part.type === 'image_url') {
          const url = String(part.image_url?.url || '');
          const dataUrl = /^data:([^;,]+);base64,/i.exec(url);
          messageImageCount += 1;
          imagePayloadCharacters += url.length;
          return {
            type: 'image_url',
            transport: dataUrl
              ? 'data_url'
              : /^https?:\/\//i.test(url)
              ? 'remote_url'
              : 'invalid',
            mimeType: dataUrl?.[1] || null,
            payloadLength: url.length,
          };
        }
        return {
          type: part.type || 'unknown',
        };
      });
      textCharacters += textLength;
      imageCount += messageImageCount;
      return {
        role: message.role,
        contentType: 'parts',
        textLength,
        imageCount: messageImageCount,
        parts,
      };
    });

    return {
      messages: summary,
      textCharacters,
      imageCount,
      imagePayloadCharacters,
    };
  }

  async examCheckStream(input: ExamCheckInput) {
    const messages = this.buildExamCheckMessages(input);
    return this.chat(messages, {
      model: input.model,
      maxCompletionTokens:
        input.maxCompletionTokens || DEFAULT_EXAM_CHECK_MAX_TOKENS,
      responseFormat: 'json_object',
      enableThinking: false,
    });
  }

  private buildExamCheckMessages(input: ExamCheckInput): QwenChatMessage[] {
    if (
      typeof input.image !== 'string' ||
      (!input.image.startsWith('data:image/') &&
        !/^https?:\/\//i.test(input.image))
    ) {
      throw new BusinessError('作业图片格式无效', 400, 'INVALID_EXAM_IMAGE');
    }
    return [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: EXAM_CHECK_PROMPT,
          },
          {
            type: 'image_url',
            image_url: {
              url: input.image,
            },
          },
        ],
      },
    ];
  }

  parseExamCheckResult(content: string): ExamCheckResult {
    let parsed: Partial<ExamCheckResult>;
    try {
      const normalizedContent = content.trim();
      const fenced = normalizedContent.match(/```(?:json)?\s*([\s\S]*?)```/i);
      const candidate = (fenced?.[1] || normalizedContent).trim();
      const start = candidate.indexOf('{');
      const end = candidate.lastIndexOf('}');
      if (start < 0 || end < start) {
        throw new Error('JSON object not found');
      }
      parsed = JSON.parse(candidate.slice(start, end + 1));
    } catch {
      throw new BusinessError(
        'Qwen 作业检查结果格式错误',
        502,
        'QWEN_INVALID_RESPONSE'
      );
    }
    if (!parsed || !Array.isArray(parsed.questions)) {
      throw new BusinessError(
        'Qwen 作业检查结果格式错误',
        502,
        'QWEN_INVALID_RESPONSE'
      );
    }
    if (!this.isExamSubject(parsed.subject)) {
      throw new BusinessError(
        'Qwen 作业检查结果格式错误',
        502,
        'QWEN_INVALID_RESPONSE'
      );
    }
    return {
      subject: parsed.subject,
      questions: parsed.questions,
    };
  }

  private isExamSubject(value: unknown): value is ExamSubject {
    return ['数学', '英语', '语文', '历史', '地理'].includes(String(value));
  }
}
