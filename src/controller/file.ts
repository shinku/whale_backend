import {
  Config,
  Fields,
  Files,
  Get,
  Inject,
  Param,
  Post,
  Provide,
} from '@midwayjs/core';
import axios from 'axios';
import { Document, Packer, Paragraph, TextRun } from 'docx';
import { Context } from 'egg';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlink,
  writeFile,
  writeFileSync,
} from 'fs';
import { join } from 'path';
import { PassThrough, Stream } from 'stream';
import { LANE } from '../core/enums';
import { FileRecordMiddleware } from '../middleware/fileRecord';
import { VipCheckMiddleware } from '../middleware/vipCheck';
import { UserRecordModel } from '../model/UserRecord';
import { ErrorCollectService } from '../service/ErrorCollectService';
import { FileService } from '../service/FileService';
import { ImageService } from '../service/ImageService';
import { OssService } from '../service/OssService';
import { buildUserOssPath } from '../service/utils/file';
import Api from './api/Api';

export type TActionType =
  | 'clear_hands_write'
  | 'convert_file'
  | 'qa'
  | 'pic_to_pdf';

const FILE_RECORD_DEFAULT_LIMIT = 20;
const FILE_RECORD_MAX_LIMIT = 50;

function parseQueryInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER
) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum) {
    return fallback;
  }
  return Math.min(number, maximum);
}

export function buildFileRecordUrl(file: string) {
  const normalizedFile = file.trim();
  if (/^https?:\/\//i.test(normalizedFile)) {
    return normalizedFile;
  }
  return `https://fms.whalepea.com/${normalizedFile.replace(/^\/+/, '')}`;
}

export function base64ToImage(base64String: string, outputFilePath: string) {
  // 移除Base64编码的前缀（如：data:image/png;base64,）
  const base64Data = base64String.replace(/^data:\w+;base64,/, '');

  // 将Base64字符串转换为Buffer
  const imageBuffer = Buffer.from(base64Data, 'base64');

  // 将Buffer写入文件
  writeFile(outputFilePath, imageBuffer, err => {
    if (err) {
      console.error('保存文件时出错:', err);
    } else {
      console.log('文件已成功保存到:', outputFilePath);
    }
  });
}

export function base64ToBuffer(base64String: string) {
  // 移除Base64编码的前缀（如：data:image/png;base64,）
  const base64Data = base64String.replace(/^data:[^,]*,/, '');

  // 将Base64字符串转换为Buffer
  const imageBuffer = Buffer.from(base64Data, 'base64');
  return imageBuffer;
}

/**
 * base64转stream
 * @param base64String
 * @returns
 */
export function base64ToStream(base64String: string) {
  const base64Data = base64String.replace(/^data:image\/\w+;base64,/, '');
  const buffer = Buffer.from(base64Data, 'base64');
  // 创建流
  const stream = new PassThrough();
  stream.end(buffer);
  return stream;
}

@Api('/file')
@Provide()
export class FileController {
  @Inject()
  ctx!: Context;

  @Inject()
  imageService!: ImageService;

  @Inject()
  fileService!: FileService;

  @Inject()
  errorCollectService!: ErrorCollectService;

  @Get('/get/:bucketname/:filename')
  async accessFile(
    @Param('filename') filename: string,
    @Param('bucketname') bucketname: string
  ) {
    this.ctx.redirect(`https://fms.whalepea.com/${bucketname}/${filename}`);
    //return await axios.get(
    //  `https://fms.whalepea.com/${bucketname}/${filename}`
    //);
  }

  @Config('outputDir')
  outputDir!: string;

  @Inject()
  ossService!: OssService;

  @Post('/upload')
  async uploadFile(@Files() files: any[]) {
    if (!files || files.length === 0) {
      throw new Error('file_is_empty');
    }
    const filePath = files[0].data;
    if (filePath) {
      const userId = this.requireUserId();
      const fileName = buildUserOssPath(
        userId,
        filePath.split('/').pop() || `upload_${Date.now()}`
      );
      const result = await this.ossService.uploadFile({
        filePath: filePath,
        fileName,
      });
      return result;
    } else {
      throw new Error('file_upload_fail');
    }
  }

  @Post('/upload/clear_hands_write', {
    middleware: [VipCheckMiddleware, FileRecordMiddleware],
  })
  async clearHandsWrite(
    @Files() files: any[],
    @Fields() fields: Record<string, any>
  ) {
    return this.uploadAndActionFile(files, fields, 'clear_hands_write');
  }

  @Post('/upload/convert_file', {
    middleware: [VipCheckMiddleware, FileRecordMiddleware],
  })
  async convertFile(
    @Files() files: any[],
    @Fields() fields: Record<string, any>
  ) {
    return this.uploadAndActionFile(files, fields, 'convert_file');
  }

  private async uploadAndActionFile(
    files: any[] | undefined,
    fields: Record<string, any>,
    action: 'clear_hands_write' | 'convert_file'
  ) {
    const userId = this.requireUserId();
    const fileUrl = fields?.file_url || this.ctx.request.body?.file_url;
    const data = files ? readFileSync(join(files[0].data)) : null;

    switch (action) {
      case 'clear_hands_write': {
        if (!data) {
          throw new Error('data file is required');
        }
        const result = await this.imageService.eraserHandWriteImage(data);
        const filename = `${Date.now()}_${Math.random()
          .toString(36)
          .slice(2, 8)}_after.jpg`;
        if (result.data.code === 40003) {
          return {
            code: 40003,
            message: '当前主账户余额不足，请联系官方充值',
          };
        }
        const stream = base64ToStream(result.data?.result?.image);
        const file = buildUserOssPath(userId, filename);
        await this.ossService.uploadStream({
          stream,
          fileName: file,
          forbidOverride: 'true',
        });
        return {
          file,
        };
      }
      case 'convert_file': {
        // 获取coverttype
        const convertType = this.ctx.query['type'] || 'pdf2doc';
        const result = await this.fileService.convert({
          type: convertType,
          file: files ? join(files[0].data) : undefined,
          fileUrl: fileUrl,
          userId,
        });
        return { file: result };
      }
    }
  }

  @Get('/myupload')
  async getMyUpload() {
    const userId = this.ctx.userId || this.ctx.get('x-user-id');
    if (!userId) {
      throw new Error('userId is required');
    }

    const query = this.ctx.query || {};
    const lane =
      typeof query.lane === 'string' && query.lane ? query.lane : LANE.WHALE;
    const limit = parseQueryInteger(
      query.limit,
      FILE_RECORD_DEFAULT_LIMIT,
      1,
      FILE_RECORD_MAX_LIMIT
    );
    const offset =
      query.page !== undefined
        ? (parseQueryInteger(query.page, 1, 1) - 1) * limit
        : parseQueryInteger(query.offset, 0, 0);
    const page = Math.floor(offset / limit) + 1;
    const where = {
      user_id: userId,
      lane,
    };

    const [count, records] = await Promise.all([
      UserRecordModel.count({ where }),
      UserRecordModel.findAll({
        attributes: ['id', 'image_url_after', 'lane', 'createdAt'],
        where,
        offset,
        limit,
        order: [['id', 'DESC']],
        raw: true,
      }),
    ]);
    const list = records.map(record => ({
      id: record.id,
      file: record.image_url_after,
      image_url_after: record.image_url_after,
      url: buildFileRecordUrl(record.image_url_after),
      lane: record.lane,
      createdAt: record.createdAt,
    }));

    return {
      count,
      list,
      page,
      limit,
      offset,
      hasMore: offset + list.length < count,
    };
  }

  async getQa(file: Buffer, fields: Record<string, any>) {
    const { text = '这道题目怎么解' } = fields;
    const requestUrl = 'https://token.market.alicloudapi.com/qSlove';
    const base64 = file.toString('base64');
    const appCode = '7e4c3cfdf95d4b26b6fbc78effb594fd';
    const header = {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      Authorization: 'APPCODE ' + appCode,
    };
    const result = await axios.post(
      requestUrl,
      {
        text,
        image_base64: base64,
      },
      {
        headers: header,
      }
    );
    return result.data?.showapi_res_body?.answer;
  }

  /**
   * 天壤智能试卷题目检测 / 错题收集
   * {
   *  "media_id": "data:image/png;base64,..."
   * }
   */
  @Post('/error_collect', {
    middleware: [VipCheckMiddleware, FileRecordMiddleware],
  })
  async errorCollect() {
    const result = await this.errorCollectService.collect(
      this.ctx.request.body?.media_id
    );
    return result;
  }

  /**
   * 多张图片拼接成一个pdf
   * {
   *  "file_urls": ["",""]
   * }
   */
  @Post('/expend_2_file', {
    middleware: [VipCheckMiddleware, FileRecordMiddleware],
  })
  async doExpend2File() {
    const userId = this.requireUserId();
    /**
     * 基于request的file_urls参数
     */
    const fileUrls = this.ctx.request.body.file_urls;
    const to_type = this.ctx.request.body.to_type || 'pdf';
    if (!fileUrls || fileUrls.length === 0) {
      throw new Error('file_urls is empty');
    }
    if (!['pdf', 'docx'].includes(to_type)) {
      throw new Error('to_type is not support');
    }
    switch (to_type) {
      case 'pdf': {
        const stream = await this.imageService.tiImageToPdf(fileUrls);
        const fileName = `${Date.now()}_${Math.random()
          .toString(36)
          .slice(2, 8)}.pdf`;
        const file = buildUserOssPath(userId, fileName);
        await this.ossService.uploadStream({
          stream: Stream.Readable.from(stream),
          fileName: file,
          forbidOverride: 'true',
        });
        return file;
      }
      case 'docx': {
        // 将图片合并为pdf
        const stream = await this.imageService.tiImageToPdf(fileUrls);
        // const fileName = `tmp/${Date.now()}_${Math.random() * 100}.pdf`;
        const docFileName = `${Date.now()}_${Math.random() * 100}.docx`;
        const uploadedDoc = await this.imageService.tiPdfToDocx(stream);
        /**
         * 临时目录
         */
        if (!existsSync(join(this.outputDir, 'tmp'))) {
          mkdirSync(join(this.outputDir, 'tmp'));
        }
        const docxPath = join(this.outputDir, 'tmp/', docFileName);
        writeFileSync(docxPath, uploadedDoc);
        // 将doc文件上传到oss
        await this.ossService.uploadFile({
          filePath: docxPath,
          fileName: buildUserOssPath(userId, docFileName),
          forbidOverride: 'true',
        });
        unlink(docxPath, (...params) => {
          console.log('unlink pdf', params);
        });
        return buildUserOssPath(userId, docFileName);
        //return result;
      }
    }
  }

  /**
   * 多张 base64 图片拼接成一个 pdf
   * {
   *  "base64_list": ["data:image/png;base64,...", "data:image/png;base64,..."]
   * }
   */
  @Post('/base64_to_pdf', {
    middleware: [VipCheckMiddleware, FileRecordMiddleware],
  })
  async base64ToPdf() {
    const userId = this.requireUserId();
    const base64List = this.ctx.request.body.base64_list;
    if (!base64List || base64List.length === 0) {
      throw new Error('base64_list is empty');
    }
    const stream = await this.imageService.tiBase64ImageToPdf(base64List);
    const fileName = `${Date.now()}_${Math.random()
      .toString(36)
      .slice(2, 8)}.pdf`;
    const file = buildUserOssPath(userId, fileName);
    await this.ossService.uploadStream({
      stream: Stream.Readable.from(stream),
      fileName: file,
      forbidOverride: 'true',
    });
    return file;
  }

  /**
   * 图片 base64 识别并转换成 word（docx）
   * {
   *  "base64": "data:image/png;base64,..."
   * }
   */
  @Post('/base64_to_word', {
    middleware: [VipCheckMiddleware, FileRecordMiddleware],
  })
  async base64ToWord() {
    const userId = this.requireUserId();
    const base64 = this.ctx.request.body.base64;
    if (!base64) {
      throw new Error('base64 is empty');
    }
    const buffer = await this.imageService.tiBase64ImageToWord(base64);
    const fileName = `${Date.now()}_${Math.random()
      .toString(36)
      .slice(2, 8)}.docx`;
    const file = buildUserOssPath(userId, fileName);
    await this.ossService.uploadStream({
      stream: Stream.Readable.from(buffer),
      fileName: file,
      forbidOverride: 'true',
    });
    return file;
  }

  /**
   * base64 图片直接转存到 OSS
   * {
   *  "base64": "data:image/png;base64,..."
   * }
   * 上传位置：pub/<openid>/<时间戳>_<随机数>.png
   */
  @Post('/base64_to_image')
  async base64ToImage() {
    const userId = this.requireUserId();
    const base64 = this.ctx.request.body?.base64;
    if (!base64) {
      throw new Error('base64 is empty');
    }
    const buffer = base64ToBuffer(base64);
    const fileName = `${Date.now()}_${Math.random()
      .toString(36)
      .slice(2, 8)}.png`;
    const file = buildUserOssPath(userId, fileName);
    await this.ossService.uploadStream({
      stream: Stream.Readable.from(buffer),
      fileName: file,
      forbidOverride: 'true',
    });
    return file;
  }

  /**
   * HTML 转 PDF
   * {
   *  "html": "<h1>标题</h1><p>正文</p>",
   *  "landscape": false
   * }
   */
  @Post('/html_to_pdf', {
    middleware: [FileRecordMiddleware],
  })
  async htmlToPdf() {
    return this.htmlToFile({
      ext: 'pdf',
      build: html =>
        this.fileService.htmlToPdf(html, {
          landscape: this.ctx.request.body.landscape,
          printBackground: this.ctx.request.body.print_background,
          format: this.ctx.request.body.format,
        }),
    });
  }

  /**
   * HTML 转 Word（.docx）
   *
   * 请求体：
   * {
   *  "html": "<h1>标题</h1><p>正文</p>",
   *  "toStrategy": "regural" | "pdfkit-convert",  // 可选，默认 regural
   *  "lane": "whale"                              // 可选
   * }
   *
   * toStrategy 两种取值：
   * - regural：常规策略，html-docxjs-compiler 把 HTML 解析成 docx 元素，稳定、产物可编辑
   * - pdfkit-convert：HTML 先渲染成 PDF，再把 PDF 每页转成图片塞进 docx，保真但偶发报错
   *
   * 调用示例（x-user-id 必填）：
   *   # 常规策略
   *   curl -X POST 'http://localhost:7001/api/file/html_to_doc' \
   *     -H 'Content-Type: application/json' -H 'x-user-id: <openid>' \
   *     -d '{"html":"<h1>标题</h1><p>正文</p>","toStrategy":"regural"}'
   *
   *   # PDF 保真策略
   *   curl -X POST 'http://localhost:7001/api/file/html_to_doc' \
   *     -H 'Content-Type: application/json' -H 'x-user-id: <openid>' \
   *     -d '{"html":"<h1>标题</h1><p>正文</p>","toStrategy":"pdfkit-convert"}'
   *
   * 返回：{ "status": 200, "data": "pub/<openid>/<时间戳>_<随机数>.docx" }
   */
  @Post('/html_to_doc', {
    middleware: [FileRecordMiddleware],
  })
  async htmlToDoc() {
    const strategy = this.ctx.request.body.toStrategy || 'regural';
    return this.htmlToFile({
      ext: 'docx',
      build: html => this.fileService.htmlToDoc(html, strategy),
    });
  }

  /**
   * html_to_pdf / html_to_doc 的公共执行体：
   * 校验参数 -> 生成文件 Buffer -> 上传 OSS -> 扣减次数 -> 返回文件名
   * @param option.ext 产物后缀
   * @param option.build 由 html 生成文件 Buffer 的方法
   */
  private async htmlToFile(option: {
    ext: 'pdf' | 'docx';
    build: (html: string) => Buffer | Promise<Buffer>;
  }) {
    const userId = this.requireUserId();
    const html = this.ctx.request.body.html;
    if (!html) {
      throw new Error('html is empty');
    }
    const buffer = await option.build(html);
    const fileName = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${
      option.ext
    }`;
    const file = buildUserOssPath(userId, fileName);
    await this.ossService.uploadStream({
      stream: Stream.Readable.from(buffer),
      fileName: file,
      forbidOverride: 'true',
    });
    return file;
  }

  /*@Get('/test_file')
  async testFile() {
    const targetFile = join(
      this.outputDir,
      '/tmp/',
      'shingu.gu2.219080161279252after.jpg'
    );
    return await this.ossService.uploadFile({
      fileName: 'pub/shingu.gu2.219080161279252after.jpg',
      filePath: targetFile,
      override: 'false',
    });
  }*/
  @Post('/text_2_word', {
    middleware: [VipCheckMiddleware, FileRecordMiddleware],
  })
  async text2Word() {
    const userId = this.requireUserId();
    const text = this.ctx.request.body.text;
    console.log('text', text);
    if (!text) {
      throw new Error('text is empty');
    }
    /**
     * 临时目录
     */
    if (!existsSync(join(this.outputDir, 'tmp'))) {
      mkdirSync(join(this.outputDir, 'tmp'));
    }
    const docFileName = `${Date.now()}_${Math.random() * 100}.docx`;
    const docxPath = join(this.outputDir, 'tmp/', docFileName);
    await this.createWordDocument(text, docxPath);
    // 将doc文件上传到oss
    await this.ossService.uploadFile({
      filePath: docxPath,
      fileName: buildUserOssPath(userId, docFileName),
      forbidOverride: 'true',
    });
    unlink(docxPath, (...params) => {
      console.log('unlink pdf', params);
    });
    return buildUserOssPath(userId, docFileName);
  }

  async createWordDocument(text: string, filePath: string) {
    const doc = new Document({
      sections: [
        {
          properties: {},
          children: ('\n\n\n\n' + text).split('\n').map(str => {
            return new Paragraph({
              children: [new TextRun(str)],
            });
          }),
        },
      ],
    });

    const buffer = await Packer.toBuffer(doc);
    writeFileSync(filePath, buffer);
  }

  private requireUserId() {
    const userId =
      this.ctx.vipCheck?.openid || this.ctx.userId || this.ctx.get('x-user-id');
    if (!userId) {
      throw new Error('userId is required');
    }
    return userId;
  }
}
