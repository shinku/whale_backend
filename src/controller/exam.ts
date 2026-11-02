import { Files, Inject, Post, Provide } from '@midwayjs/core';
import { Context } from 'egg';
import { readFileSync } from 'fs';
import { Readable } from 'stream';
import { BusinessError } from '../core/errors';
import { ExamCheckLimitMiddleware } from '../middleware/examCheckLimit';
import { VipCheckMiddleware } from '../middleware/vipCheck';
import { BetaLimitQuota, BetaLimitService } from '../service/BetaLimitService';
import { QwenService } from '../service/QwenService';
import Api from './api/Api';

const MAX_EXAM_IMAGE_BYTES = 10 * 1024 * 1024;
@Provide()
@Api('/exam')
export class ExamController {
  @Inject()
  ctx!: Context;

  @Inject()
  qwenService!: QwenService;

  @Inject()
  betaLimitService!: BetaLimitService;

  @Post('/help_check', {
    middleware: [VipCheckMiddleware, ExamCheckLimitMiddleware],
  })
  async helpCheck(@Files() files: any[]) {
    const body = this.ctx.request.body || {};
    const image = this.getImageDataUrl(files, body);
    console.log('[exam] help_check stream start', {
      imageCharacters: image.length,
      transport: image.startsWith('data:image/') ? 'data_url' : 'remote_url',
    });

    this.ctx.status = 200;
    this.ctx.type = 'text/event-stream; charset=utf-8';
    this.ctx.set('Cache-Control', 'no-cache, no-transform');
    this.ctx.set('Connection', 'keep-alive');
    this.ctx.set('X-Accel-Buffering', 'no');
    return Readable.from(this.createExamCheckStream(image, this.ctx.betaLimit));
  }

  private getImageDataUrl(files: any[] | undefined, body: Record<string, any>) {
    if (files?.length) {
      const file = files[0];
      if (Number(file.size || 0) > MAX_EXAM_IMAGE_BYTES) {
        throw new BusinessError(
          '作业图片不能超过 10MB',
          400,
          'EXAM_IMAGE_TOO_LARGE'
        );
      }
      const data =
        file.data instanceof Buffer ? file.data : readFileSync(file.data);
      if (data.length > MAX_EXAM_IMAGE_BYTES) {
        throw new BusinessError(
          '作业图片不能超过 10MB',
          400,
          'EXAM_IMAGE_TOO_LARGE'
        );
      }
      const mime = file.mimeType || file.mime || 'image/jpeg';
      if (!String(mime).startsWith('image/')) {
        throw new BusinessError(
          '上传文件必须是图片',
          400,
          'INVALID_EXAM_IMAGE'
        );
      }
      return `data:${mime};base64,${data.toString('base64')}`;
    }

    const image = body.image || body.imageBase64 || body.image_url;
    if (typeof image !== 'string' || image.length === 0) {
      throw new BusinessError('请上传作业图片', 400, 'EXAM_IMAGE_REQUIRED');
    }
    if (image.startsWith('data:image/') || /^https?:\/\//i.test(image)) {
      return image;
    }
    return `data:image/jpeg;base64,${image}`;
  }

  private async *createExamCheckStream(
    image: string,
    betaLimit?: BetaLimitQuota
  ) {
    let content = '';
    let chunkCount = 0;
    try {
      const stream = await this.qwenService.examCheckStream({ image });
      for await (const part of stream) {
        const choice = part.choices[0];
        const delta = choice?.delta as
          | {
              content?: string | null;
              reasoning_content?: string | null;
            }
          | undefined;
        const chunkContent =
          typeof delta?.content === 'string' ? delta.content : '';
        const reasoningContent =
          typeof delta?.reasoning_content === 'string'
            ? delta.reasoning_content
            : null;
        chunkCount += 1;
        console.log({
          chunkIndex: chunkCount,
          chunkContent,
          reasoningContent,
          finishReason: choice?.finish_reason || null,
        });
        if (chunkContent) {
          content += chunkContent;
          yield this.toSse('delta', {
            content: chunkContent,
          });
        }
      }
      yield this.toSse('done', {
        data: this.qwenService.parseExamCheckResult(content),
      });
    } catch (error: unknown) {
      const status =
        Number((error as any)?.status || (error as any)?.statusCode) || 500;
      const code = (error as any)?.code;
      yield this.toSse('error', {
        status,
        message: error instanceof Error ? error.message : '作业检查失败',
        ...(code ? { code } : {}),
      });
    } finally {
      if (betaLimit) {
        try {
          await this.betaLimitService.consume(betaLimit);
        } catch (error: unknown) {
          console.error('[exam] beta limit update failed', {
            openid: betaLimit.openid,
            feature: betaLimit.feature,
            usageDate: betaLimit.usageDate,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
  }

  private toSse(event: string, data: unknown) {
    return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  }
}
