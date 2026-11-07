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

export interface ImageTranslationRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ImageTranslationItem {
  message: string;
  rect: ImageTranslationRect;
  color: string;
  background: string;
  fontSize: number;
}

export type ImageTranslationDirection = 'en_to_zh' | 'zh_to_pinyin';

export interface ImageTranslateInput {
  image: string;
  model?: string;
  direction?: ImageTranslationDirection;
  imageWidth?: number;
  imageHeight?: number;
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

const IMAGE_TRANSLATE_COMMON_RULES = `1. 保持原始阅读顺序，以“视觉行”为单位返回，每一行必须单独输出一个对象。
2. rect 是原图左上角为原点的像素坐标，x/y 为左上角，w/h 为宽高。
3. rect 必须覆盖对应原文区域，不要覆盖无关内容；每一行只覆盖这一行文字。
4. color 是原文字的主要颜色，必须返回 #RRGGBB 格式。
5. background 是该行文字背后的主要背景颜色，必须返回 #RRGGBB 格式。
6. fontSize 是该行原文的近似字体大小，单位为原图像素，必须是正数。
7. message 内绝对禁止包含换行符或转义换行符。同一段落因自动换行分成多行时，必须拆成多个对象，分别提供 y/h。
8. 空白行不返回；不要合并上下两行。
9. 看不清的段落不要编造，直接省略。
10. 必须只输出合法 JSON，不要 Markdown 或解释。`;

function buildImageTranslatePrompt(
  direction: ImageTranslationDirection,
  imageWidth?: number,
  imageHeight?: number
) {
  const task =
    direction === 'zh_to_pinyin'
      ? `识别图片中的中文文字，并将中文转写为带声调符号的标准汉语拼音。
- message 必须返回拼音，不返回中文原文，也不翻译成英文。
- 使用小写拼音和标准声调符号，例如“你好”返回“nǐ hǎo”。
- 根据词语上下文处理多音字。
- 只处理中文源内容；英文、数字等非中文内容不转写、不返回。`
      : `识别图片中的文字，并将非中文内容翻译成自然、准确的简体中文。
- 只处理英文源内容，将英文翻译成自然、准确的简体中文。
- 中文源内容不参与翻译、不返回。`;

  return `${task}

原图实际尺寸：width=${imageWidth || '未知'}, height=${imageHeight || '未知'}。
rect 的 x、y、w、h 必须基于这个实际像素尺寸计算。

通用要求：
${IMAGE_TRANSLATE_COMMON_RULES}

输出格式：
{
  "translations": [
    {
      "message": "nǐ hǎo / 这是一段翻译",
      "rect": { "x": 10, "y": 10, "w": 200, "h": 20 },
      "color": "#333333",
      "background": "#FFFFFF",
      "fontSize": 16
    }
  ]
}`;
}

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

  async imageTranslate(input: ImageTranslateInput) {
    if (
      typeof input.image !== 'string' ||
      (!input.image.startsWith('data:image/') &&
        !/^https?:\/\//i.test(input.image))
    ) {
      throw new BusinessError(
        '翻译图片格式无效',
        400,
        'INVALID_TRANSLATE_IMAGE'
      );
    }

    const direction = input.direction || 'en_to_zh';
    if (direction !== 'en_to_zh' && direction !== 'zh_to_pinyin') {
      throw new BusinessError(
        '图片翻译方向无效',
        400,
        'INVALID_TRANSLATION_DIRECTION'
      );
    }
    const stream = await this.chat(
      [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: buildImageTranslatePrompt(
                direction,
                input.imageWidth,
                input.imageHeight
              ),
            },
            {
              type: 'image_url',
              image_url: {
                url: input.image,
              },
            },
          ],
        },
      ],
      {
        model: input.model,
        temperature: 0.1,
        maxCompletionTokens: 8192,
        enableThinking: false,
        responseFormat: 'json_object',
      }
    );

    let content = '';
    try {
      for await (const part of stream) {
        const delta = part.choices[0]?.delta as
          | { content?: string | null }
          | undefined;
        if (typeof delta?.content === 'string') {
          content += delta.content;
        }
      }
    } catch (error) {
      if (error instanceof BusinessError) {
        throw error;
      }
      console.error('[qwen] image translate stream failed', error);
      throw new BusinessError('Qwen 模型调用失败', 502, 'QWEN_REQUEST_FAILED');
    }
    return this.parseImageTranslationResult(content);
  }

  parseImageTranslationResult(content: string): ImageTranslationItem[] {
    let parsed: any;
    try {
      const normalized = content.trim();
      const fenced = normalized.match(/```(?:json)?\s*([\s\S]*?)```/i);
      const candidate = (fenced?.[1] || normalized).trim();
      const start = candidate.indexOf('{');
      const end = candidate.lastIndexOf('}');
      if (start < 0 || end < start) {
        throw new Error('JSON object not found');
      }
      parsed = JSON.parse(candidate.slice(start, end + 1));
    } catch {
      throw new BusinessError(
        'Qwen 图片翻译结果格式错误',
        502,
        'QWEN_INVALID_TRANSLATION_RESPONSE'
      );
    }

    const translations = parsed?.translations;
    if (!Array.isArray(translations) || translations.length > 100) {
      throw new BusinessError(
        'Qwen 图片翻译结果格式错误',
        502,
        'QWEN_INVALID_TRANSLATION_RESPONSE'
      );
    }
    const result: ImageTranslationItem[] = [];
    for (const rawItem of translations) {
      const item = this.normalizeTranslationItem(rawItem);
      if (item) {
        result.push(...this.splitTranslationLines(item));
      }
    }
    return result;
  }

  private normalizeTranslationItem(item: any): ImageTranslationItem | null {
    const message =
      typeof item?.message === 'string' ? item.message.trim() : '';
    const rect = item?.rect;
    const values = [
      Number(rect?.x),
      Number(rect?.y),
      Number(rect?.w),
      Number(rect?.h),
    ];
    if (
      !message ||
      values.some(value => !Number.isFinite(value)) ||
      values[0] < 0 ||
      values[1] < 0 ||
      values[2] <= 0 ||
      values[3] <= 0
    ) {
      return null;
    }
    const color = /^#[0-9a-f]{6}$/i.test(String(item?.color || ''))
      ? String(item.color).toLowerCase()
      : '#333333';
    const background = /^#[0-9a-f]{6}$/i.test(String(item?.background || ''))
      ? String(item.background).toLowerCase()
      : '#ffffff';
    const rawFontSize = Number(item?.fontSize ?? item?.font_size);
    const fontSize =
      Number.isFinite(rawFontSize) && rawFontSize > 0
        ? Math.max(1, Math.round(rawFontSize))
        : Math.max(1, Math.round(values[3]));
    return {
      message: message.slice(0, 5000),
      rect: {
        x: Math.round(values[0]),
        y: Math.round(values[1]),
        w: Math.round(values[2]),
        h: Math.round(values[3]),
      },
      color,
      background,
      fontSize,
    };
  }

  private splitTranslationLines(
    item: ImageTranslationItem
  ): ImageTranslationItem[] {
    const lines = item.message
      .replace(/\r\n/g, '\n')
      .split('\n')
      .map(line => line.trim());
    if (lines.length <= 1) {
      return item.message.includes('\n') ? [] : [item];
    }
    const result: ImageTranslationItem[] = [];
    lines.forEach((message, index) => {
      if (!message) {
        return;
      }
      const top =
        item.rect.y + Math.round((item.rect.h * index) / lines.length);
      const next =
        item.rect.y + Math.round((item.rect.h * (index + 1)) / lines.length);
      result.push({
        ...item,
        message: message.slice(0, 5000),
        rect: {
          ...item.rect,
          y: top,
          h: Math.max(1, next - top),
        },
        fontSize: item.fontSize,
      });
    });
    return result;
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
