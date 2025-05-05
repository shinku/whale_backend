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
import { Context } from 'egg';
import { readFileSync, writeFile, writeFileSync } from 'fs';
import { join } from 'path';
import { PassThrough, Stream } from 'stream';
import { UserRecordModel } from '../model/UserRecord';
import { FileService } from '../service/FileService';
import { ImageService } from '../service/ImageService';
import { OssService } from '../service/OssService';
import Api from './api/Api';

export type TActionType =
  | 'clear_hands_write'
  | 'convert_file'
  | 'qa'
  | 'pic_to_pdf';

export function base64ToImage(base64String, outputFilePath) {
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
  const base64Data = base64String.replace(/^data:\w+;base64,/, '');

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
  ctx: Context;

  @Inject()
  imageService: ImageService;

  @Inject()
  fileService: FileService;
  @Get('/get/:bucketname/:filename')
  async accessFile(
    @Param('filename') filename: string,
    @Param('bucketname') bucketname: string
  ) {
    this.ctx.redirect(`https://fms.whalepea.com/${bucketname}/${filename}`);
  }

  @Config('outputDir')
  outputDir: string;

  @Inject()
  ossService: OssService;

  @Post('/upload/:action')
  async uploadFile(@Files() files, @Fields() fields) {
    const action = this.ctx.params['action'] as TActionType;

    const userId = fields.userId || this.ctx.get('x-user-id');
    const data = readFileSync(join(files[0].data));
    switch (action) {
      case 'clear_hands_write': {
        const result = await this.imageService.eraserHandWriteImage(data);
        const filename = fields.userId + Math.random() * 100 + 'after.jpg';
        if (result.data.code === 40003) {
          return {
            code: 40003,
            message: '当前主账户余额不足，请联系官方充值',
          };
        }
        const stream = base64ToStream(result.data?.result?.image);
        await this.ossService.uploadStream({
          stream,
          fileName: filename,
          forbidOverride: 'true',
          folderName: 'pub/',
        });
        // 保存文件记录
        try {
          await UserRecordModel.create({
            image_url_after: filename,
            user_id: userId,
            image_url_before: '',
            lane: fields.lane || 'whale',
          });
        } catch (e) {
          console.log(e);
        }
        return {
          file: 'pub/' + filename,
        };
      }
      case 'convert_file': {
        // 获取coverttype
        const convertType = this.ctx.query['type'] || 'pdf2doc';
        const result = await this.fileService.convert({
          type: convertType,
          file: join(files[0].data),
          userId,
        });
        await UserRecordModel.create({
          image_url_after: result,
          user_id: userId,
          image_url_before: '',
          lane: fields.lane || 'whale',
        });
        return result;
      }
      case 'qa': {
        // return await this.getQa(data, fields);
      }
    }
  }

  @Get('/myupload')
  async getMyUpload() {
    const userId = this.ctx.userId;
    const { lane = 'whale', offset = '0' } = this.ctx.query || {};
    const count = await UserRecordModel.count({
      where: {
        user_id: userId,
        lane,
      },
    });
    const records = await UserRecordModel.findAll({
      attributes: ['image_url_after', 'lane'],
      where: {
        user_id: userId,
        lane,
      },
      offset: Number(offset),
      limit: 10,
      raw: true,
    });
    return {
      count,
      list: records,
    };
  }

  async getQa(file: Buffer, fields) {
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
   * 多张图片拼接成一个pdf
   * {
   *  "file_urls": ["",""]
   * }
   */
  @Post('/convert')
  async doExpend2File() {
    /**
     * 基于request的file_urls参数
     */
    const fileUrls = this.ctx.request.body.file_urls;
    const to_type = this.ctx.request.body.to_type || 'pdf';
    switch (to_type) {
      case 'pdf': {
        const stream = await this.imageService.tiImageToPdf(fileUrls);
        const fileName = `pub/${Date.now()}_${Math.random() * 100}.pdf`;
        await this.ossService.uploadStream({
          stream: Stream.Readable.from(stream),
          fileName: fileName,
          forbidOverride: 'true',
        });
        return fileName;
      }
      case 'docx': {
        const stream = await this.imageService.tiImageToPdf(fileUrls);
        const fileName = `tmp/${Date.now()}_${Math.random() * 100}.pdf`;
        const docFileName = `${Date.now()}_${Math.random() * 100}.docx`;
        // 保存为本地pdf文件
        writeFileSync(join(this.outputDir, fileName), stream);
        // 转换为docx
        await this.fileService.doPdfToWord(
          join(this.outputDir, fileName),
          join(this.outputDir, 'tmp/', docFileName)
        );
        await this.ossService.uploadStream({
          stream: Stream.Readable.from(stream),
          fileName: docFileName,
          forbidOverride: 'true',
          folderName: 'pub/',
        });
        return 'pub/' + docFileName;
        //return result;
      }
    }
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
}
