import { Inject, Provide, Scope, ScopeEnum } from '@midwayjs/core';
import { tool } from '@langchain/core/tools';
import axios from 'axios';
import { createHash } from 'crypto';
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';
import { Readable } from 'stream';
import { z } from 'zod';
import {
  FILE_ERROR_COLLECT_COUNT_LIMIT,
  FILE_EXPEND_2_FILE_COUNT_LIMIT,
  FILE_TEXT_2_WORD_COUNT_LIMIT,
  FILE_UPLOAD_ACTION_COUNT_LIMIT,
  TUserCountLimitField,
} from '../core/limits';
import { LANE } from '../core/enums';
import { UserRecordModel } from '../model/UserRecord';
import { AgentUserProfile, UserService } from './UserService';
import { ErrorCollectService } from './ErrorCollectService';
import { FileService } from './FileService';
import { ImageService } from './ImageService';
import { OssService } from './OssService';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const OUTPUT_PREFIX = 'pub/agent/';

export interface LearningAgentToolContext {
  profile: AgentUserProfile;
  history?: LearningAgentHistoryMessage[];
}

export interface LearningAgentHistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

@Provide()
@Scope(ScopeEnum.Request, { allowDowngrade: true })
export class LearningAgentToolsService {
  @Inject()
  userService!: UserService;

  @Inject()
  errorCollectService!: ErrorCollectService;

  @Inject()
  fileService!: FileService;

  @Inject()
  imageService!: ImageService;

  @Inject()
  ossService!: OssService;

  buildTools(context: LearningAgentToolContext) {
    const openid = context.profile.openid;
    const lane = context.profile.lane || LANE.WHALE;

    const readChatHistory = tool(
      async input =>
        this.runTool(async () => {
          const history = context.history || [];
          const query = String(input.query || '')
            .trim()
            .toLowerCase();
          const limit = Math.min(Math.max(input.limit || 6, 1), 20);
          const matched = query
            ? history.filter(item => item.content.toLowerCase().includes(query))
            : history;
          return {
            total: history.length,
            matched: matched.length,
            items: matched.slice(-limit),
          };
        }),
      {
        name: 'read_chat_history',
        description:
          '按需读取更早的聊天记录。只有用户提到之前聊过、指代上一题或需要延续旧计划时才调用。不要每轮都调用。',
        schema: z.object({
          query: z
            .string()
            .optional()
            .describe('可选的检索关键词；不传则返回最近的聊天记录'),
          limit: z
            .number()
            .int()
            .min(1)
            .max(20)
            .optional()
            .describe('最多返回多少条，默认 6 条'),
        }),
      }
    );

    const collectWrongQuestions = tool(
      async input =>
        this.runTool(async () => {
          const buffer = await this.readImage(input);
          return this.withCountLimit(
            openid,
            lane,
            FILE_ERROR_COLLECT_COUNT_LIMIT,
            async () => ({
              result: await this.errorCollectService.collect(
                buffer.toString('base64')
              ),
            })
          );
        }),
      {
        name: 'collect_wrong_questions',
        description:
          '识别作业图片中的题目和错题区域，用于错题收集。imageUrl 或 imageBase64 二选一。',
        schema: z.object({
          imageUrl: z.string().optional().describe('公网可访问的图片 URL'),
          imageBase64: z
            .string()
            .optional()
            .describe('图片 Base64，可带 data:image/...;base64, 前缀'),
        }),
      }
    );

    const clearHandwriting = tool(
      async input =>
        this.runTool(async () => {
          const buffer = await this.readImage(input);
          return this.withCountLimit(
            openid,
            lane,
            FILE_UPLOAD_ACTION_COUNT_LIMIT.clear_hands_write,
            async () => {
              const response = await this.imageService.eraserHandWriteImage(
                buffer
              );
              const image = response.data?.result?.image;
              if (typeof image !== 'string' || !image) {
                throw new Error(
                  response.data?.message ||
                    '清除手写笔迹失败，请更换清晰图片后重试'
                );
              }
              const uploaded = await this.uploadBuffer(
                openid,
                this.decodeBase64(image),
                'jpg'
              );
              this.recordFile(
                openid,
                lane,
                uploaded.file,
                this.sourceUrl(input.imageUrl)
              );
              return uploaded;
            }
          );
        }),
      {
        name: 'clear_handwriting',
        description:
          '清除作业图片中的手写笔迹，生成干净题目图片并上传，返回 file 和 url。imageUrl 或 imageBase64 二选一。',
        schema: z.object({
          imageUrl: z.string().optional().describe('公网可访问的图片 URL'),
          imageBase64: z
            .string()
            .optional()
            .describe('图片 Base64，可带 data:image/...;base64, 前缀'),
        }),
      }
    );

    const imagesToPdf = tool(
      async input =>
        this.runTool(async () => {
          return this.withCountLimit(
            openid,
            lane,
            FILE_EXPEND_2_FILE_COUNT_LIMIT,
            async () => {
              const base64List = await Promise.all(
                input.imageUrls.map(item =>
                  this.readImage({ imageUrl: item }).then(buffer =>
                    buffer.toString('base64')
                  )
                )
              );
              const buffer = await this.imageService.tiBase64ImageToPdf(
                base64List
              );
              const uploaded = await this.uploadBuffer(openid, buffer, 'pdf');
              this.recordFile(openid, lane, uploaded.file);
              return uploaded;
            }
          );
        }),
      {
        name: 'images_to_pdf',
        description:
          '把 1 到 10 张题目图片合并成一个 PDF 并上传，返回 file 和 url。',
        schema: z.object({
          imageUrls: z
            .array(z.string())
            .min(1)
            .max(10)
            .describe('图片 URL 或 data URL 列表'),
        }),
      }
    );

    const markdownToWord = tool(
      async input =>
        this.runTool(async () => {
          return this.withCountLimit(
            openid,
            lane,
            FILE_TEXT_2_WORD_COUNT_LIMIT,
            async () => {
              const buffer = await this.markdownToDocx(input.markdown);
              const uploaded = await this.uploadBuffer(openid, buffer, 'docx');
              this.recordFile(openid, lane, uploaded.file);
              return uploaded;
            }
          );
        }),
      {
        name: 'markdown_to_word',
        description:
          '把 Markdown 格式的学习计划、试卷或辅导内容导出为 Word 文档并上传。',
        schema: z.object({
          markdown: z
            .string()
            .min(1)
            .max(50000)
            .describe('需要导出的 Markdown 正文'),
        }),
      }
    );

    const convertFile = tool(
      async input =>
        this.runTool(async () => {
          return this.withCountLimit(
            openid,
            lane,
            FILE_UPLOAD_ACTION_COUNT_LIMIT.convert_file,
            async () => {
              const file = await this.fileService.convert({
                type: 'pdf2doc_textin',
                fileUrl: input.fileUrl,
                userId: openid,
              });
              if (!file) {
                throw new Error('文件转换失败');
              }
              this.recordFile(openid, lane, file, input.fileUrl);
              return {
                file,
                url: this.fileUrl(file),
              };
            }
          );
        }),
      {
        name: 'convert_pdf_to_word',
        description:
          '把公网可访问的 PDF 文件转换成 Word 文档并上传，返回 file 和 url。',
        schema: z.object({
          fileUrl: z.string().url().describe('公网可访问的 PDF URL'),
        }),
      }
    );

    const listUploads = tool(
      async input =>
        this.runTool(async () => {
          const records = await UserRecordModel.findAll({
            attributes: ['id', 'image_url_after', 'createdAt'],
            where: {
              user_id: openid,
              lane,
            },
            order: [['id', 'DESC']],
            limit: input.limit || 20,
            raw: true,
          });
          return {
            items: records.map(record => ({
              id: record.id,
              file: record.image_url_after,
              url: this.fileUrl(record.image_url_after),
              createdAt: record.createdAt,
            })),
          };
        }),
      {
        name: 'list_my_uploaded_files',
        description:
          '查询当前用户最近生成或上传的文件，用于继续处理已有学习资料。',
        schema: z.object({
          limit: z.number().int().min(1).max(50).optional(),
        }),
      }
    );

    return [
      readChatHistory,
      collectWrongQuestions,
      clearHandwriting,
      imagesToPdf,
      markdownToWord,
      convertFile,
      listUploads,
    ];
  }

  private async runTool<T extends object>(action: () => Promise<T>) {
    try {
      return {
        ok: true,
        ...(await action()),
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async withCountLimit<T>(
    openid: string,
    lane: string,
    limitField: TUserCountLimitField,
    action: () => Promise<T>
  ) {
    await this.userService.assertCountLimitAvailable(openid, lane, limitField);
    const result = await action();
    await this.userService.consumeCountLimit(openid, lane, limitField);
    return result;
  }

  private async readImage(input: { imageUrl?: string; imageBase64?: string }) {
    const base64 = input.imageBase64?.trim();
    if (base64) {
      const buffer = this.decodeBase64(base64);
      this.assertImageSize(buffer);
      return buffer;
    }

    const imageUrl = input.imageUrl?.trim();
    if (!imageUrl) {
      throw new Error('imageUrl 或 imageBase64 至少提供一个');
    }
    if (imageUrl.startsWith('data:image/')) {
      const buffer = this.decodeBase64(imageUrl);
      this.assertImageSize(buffer);
      return buffer;
    }
    if (!/^https?:\/\//i.test(imageUrl)) {
      throw new Error('图片地址必须是 http/https URL 或 data URL');
    }

    const response = await axios.get<ArrayBuffer>(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 30000,
      maxContentLength: MAX_IMAGE_BYTES,
    });
    const buffer = Buffer.from(response.data);
    this.assertImageSize(buffer);
    return buffer;
  }

  private decodeBase64(value: string) {
    const compact = value.replace(/^data:[^,]*,/, '').replace(/\s/g, '');
    if (!compact) {
      throw new Error('图片 Base64 为空');
    }
    return Buffer.from(compact, 'base64');
  }

  private assertImageSize(buffer: Buffer) {
    if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) {
      throw new Error('图片不能为空且不能超过 10MB');
    }
  }

  private async uploadBuffer(
    openid: string,
    buffer: Buffer,
    extension: string
  ) {
    const userKey = createHash('sha256')
      .update(openid)
      .digest('hex')
      .slice(0, 12);
    const fileName = `${userKey}_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2, 8)}.${extension}`;
    const result = await this.ossService.uploadStream({
      stream: Readable.from(buffer),
      fileName,
      folderName: OUTPUT_PREFIX,
      forbidOverride: 'true',
    });
    if (!result) {
      throw new Error('文件上传失败');
    }
    const file = `${OUTPUT_PREFIX}${fileName}`;
    return {
      file,
      url: this.fileUrl(file),
    };
  }

  private async markdownToDocx(markdown: string) {
    const lines = markdown.replace(/\r\n/g, '\n').split('\n');
    const children = lines.map(line => {
      const heading = /^(#{1,3})\s+(.+)$/.exec(line);
      if (heading) {
        const levels = [
          HeadingLevel.HEADING_1,
          HeadingLevel.HEADING_2,
          HeadingLevel.HEADING_3,
        ];
        return new Paragraph({
          text: heading[2],
          heading: levels[heading[1].length - 1],
        });
      }
      return new Paragraph({
        children: [new TextRun(line)],
        spacing: { after: 100 },
      });
    });
    const document = new Document({
      sections: [{ properties: {}, children }],
    });
    return Packer.toBuffer(document);
  }

  private recordFile(openid: string, lane: string, file: string, before = '') {
    void UserRecordModel.create({
      user_id: openid,
      lane,
      image_url_before: before,
      image_url_after: file,
    }).catch(error => {
      console.error('[learningAgent] save file record failed', error);
    });
  }

  private fileUrl(file: string) {
    if (/^https?:\/\//i.test(file)) {
      return file;
    }
    return `https://fms.whalepea.com/${file.replace(/^\/+/, '')}`;
  }

  private sourceUrl(value?: string) {
    return value && /^https?:\/\//i.test(value) ? value : '';
  }
}
