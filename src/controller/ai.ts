import { Get, Inject, Param, Post, Provide } from '@midwayjs/core';
import { loadImage } from '@napi-rs/canvas';
import { randomUUID } from 'crypto';
import { Context } from 'egg';
import { Readable } from 'stream';
import { AI_SUBJECT_STORE_TTL } from '../core/limits';
import { BusinessError } from '../core/errors';
import { VipCheckMiddleware } from '../middleware/vipCheck';
import { AiSubjectStoreModel } from '../model/AiSubjectStoreModel';
import { AIService } from '../service/AiService';
import { PromptService } from '../service/PromptService';
import { ImageTranslationDirection, QwenService } from '../service/QwenService';
import { OssService } from '../service/OssService';
import Api from './api/Api';

const MAX_TRANSLATE_IMAGE_BYTES = 10 * 1024 * 1024;

@Provide()
@Api('/ai')
export class Ai {
  @Inject()
  ctx!: Context;

  @Inject()
  aiService!: AIService;

  @Inject()
  promptService!: PromptService;

  @Inject()
  qwenService!: QwenService;

  @Inject()
  ossService!: OssService;

  @Get('/activity')
  async getActivityList() {
    return {
      data: await this.promptService.getPromptList(),
    };
  }

  /***
   * 老的接口，保留一段时间，方便前端过渡
   */
  @Post('/activity')
  async getActivity() {
    const { actId, config, prompt } = this.ctx.request.body;
    const systemPrompt = prompt || (await this.promptService.getPrompt(actId));
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
  @Post('/subjects', {
    middleware: [VipCheckMiddleware],
  })
  async getSubjects() {
    const { config, prompt } = this.ctx.request.body;
    if (!config || !prompt) {
      throw new Error('config and prompt are required');
    }
    const systemPrompt = prompt;
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

  @Post('/subject/translate', {
    middleware: [VipCheckMiddleware],
  })
  async translateSubject() {
    const direction = this.getTranslateDirection();
    const input = await this.getTranslateImage();
    const result = (
      await this.qwenService.imageTranslate({
        image: input.dataUrl,
        direction,
        imageWidth: input.imageWidth,
        imageHeight: input.imageHeight,
      })
    ).map(item => this.ensureTranslationStyle(item));
    const imageUrl = await this.uploadTranslateImage(input.dataUrl);
    const payload = {
      source: imageUrl,
      result,
      direction,
      imageWidth: input.imageWidth,
      imageHeight: input.imageHeight,
    };
    const requestid = randomUUID();
    await AiSubjectStoreModel.create({
      requestid,
      store_content: JSON.stringify(payload),
    });
    return {
      data: payload,
      id: requestid,
    };
  }

  @Get('/subject/translate/:id')
  async getTranslatedSubject(@Param('id') id: string) {
    if (!id) {
      throw new BusinessError(
        '翻译结果 id 不能为空',
        400,
        'TRANSLATION_ID_REQUIRED'
      );
    }
    const record = await AiSubjectStoreModel.findOne({
      where: { requestid: id },
    });
    if (!record) {
      throw new BusinessError('翻译结果不存在', 404, 'TRANSLATION_NOT_FOUND');
    }
    if (
      Date.now() - new Date(record.createdAt).getTime() >
      AI_SUBJECT_STORE_TTL
    ) {
      throw new BusinessError('翻译结果已过期', 410, 'TRANSLATION_EXPIRED');
    }
    let payload: {
      source: string;
      result: unknown[];
      direction?: ImageTranslationDirection;
      imageWidth?: number;
      imageHeight?: number;
    };
    try {
      payload = JSON.parse(record.store_content);
    } catch {
      throw new BusinessError(
        '翻译结果格式错误',
        500,
        'INVALID_TRANSLATION_STORE'
      );
    }
    if (typeof payload?.source !== 'string' || !Array.isArray(payload.result)) {
      throw new BusinessError(
        '翻译结果格式错误',
        500,
        'INVALID_TRANSLATION_STORE'
      );
    }
    return {
      data: {
        source: this.relativeSource(payload.source),
        result: payload.result.map(item => this.ensureTranslationStyle(item)),
        direction: this.normalizeTranslateDirection(payload.direction),
        imageWidth: this.normalizeDimension(payload.imageWidth),
        imageHeight: this.normalizeDimension(payload.imageHeight),
      },
      id: record.requestid,
    };
  }

  private ensureTranslationStyle(item: any) {
    if (!item || typeof item !== 'object') {
      return item;
    }
    const fontSize = Number(item.fontSize ?? item.font_size);
    const background = /^#[0-9a-f]{6}$/i.test(String(item.background || ''))
      ? String(item.background).toLowerCase()
      : '#ffffff';
    return {
      ...item,
      background,
      fontSize:
        Number.isFinite(fontSize) && fontSize > 0
          ? Math.max(1, Math.round(fontSize))
          : Math.max(1, Math.round(Number(item.rect?.h) || 1)),
    };
  }

  private getTranslateDirection(): ImageTranslationDirection {
    return this.normalizeTranslateDirection(this.ctx.request.body?.direction);
  }

  private normalizeDimension(value: unknown) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.round(number) : null;
  }

  private normalizeTranslateDirection(
    value: unknown
  ): ImageTranslationDirection {
    if (value === undefined || value === null || value === '') {
      return 'en_to_zh';
    }
    if (value === 'en_to_zh' || value === 'zh_to_pinyin') {
      return value;
    }
    throw new BusinessError(
      '翻译方向无效',
      400,
      'INVALID_TRANSLATION_DIRECTION'
    );
  }

  private async uploadTranslateImage(dataUrl: string) {
    const match = /^data:(image\/[a-z0-9.+-]+);base64,([\s\S]+)$/i.exec(
      dataUrl
    );
    if (!match) {
      throw new BusinessError(
        '翻译图片格式无效',
        400,
        'INVALID_TRANSLATE_IMAGE'
      );
    }
    const mime = match[1].toLowerCase();
    const extension =
      {
        'image/jpeg': 'jpg',
        'image/png': 'png',
        'image/gif': 'gif',
        'image/webp': 'webp',
      }[mime] || 'jpg';
    const fileName = `translate_${Date.now()}_${randomUUID()}.${extension}`;
    const result = await this.ossService.uploadStream({
      stream: Readable.from(Buffer.from(match[2], 'base64')),
      fileName,
      folderName: 'pub/ai-translate/',
      forbidOverride: 'true',
    });
    if (!result) {
      throw new BusinessError(
        '翻译图片上传失败',
        502,
        'TRANSLATE_IMAGE_UPLOAD_FAILED'
      );
    }
    return `pub/ai-translate/${fileName}`;
  }

  private relativeSource(source: string) {
    return source.replace(/^https?:\/\/fms\.whalepea\.com\/+/i, '');
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

  private async getTranslateImage() {
    const body = this.ctx.request.body || {};
    const image = body.source || body.imageBase64 || body.image;
    if (typeof image !== 'string' || !image.trim()) {
      throw new BusinessError(
        '请提供 Base64 翻译图片',
        400,
        'TRANSLATE_IMAGE_REQUIRED'
      );
    }
    const normalized = image.trim();
    const dataUrl = /^data:(image\/[a-z0-9.+-]+);base64,([\s\S]+)$/i.exec(
      normalized
    );
    const mime = dataUrl?.[1] || 'image/jpeg';
    const base64 = (dataUrl?.[2] || normalized).replace(/\s/g, '');
    if (
      !base64 ||
      base64.length % 4 === 1 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)
    ) {
      throw new BusinessError(
        '翻译图片 Base64 格式无效',
        400,
        'INVALID_TRANSLATE_IMAGE'
      );
    }
    const data = Buffer.from(base64, 'base64');
    if (!data.length) {
      throw new BusinessError(
        '翻译图片不能为空',
        400,
        'TRANSLATE_IMAGE_REQUIRED'
      );
    }
    if (data.length > MAX_TRANSLATE_IMAGE_BYTES) {
      throw new BusinessError(
        '翻译图片不能超过 10MB',
        413,
        'TRANSLATE_IMAGE_TOO_LARGE'
      );
    }
    let decodedImage: Awaited<ReturnType<typeof loadImage>>;
    try {
      decodedImage = await loadImage(data);
    } catch {
      throw new BusinessError(
        '无法读取翻译图片尺寸',
        400,
        'INVALID_TRANSLATE_IMAGE'
      );
    }
    return {
      dataUrl: `data:${mime};base64,${base64}`,
      imageWidth: decodedImage.width,
      imageHeight: decodedImage.height,
    };
  }
}
