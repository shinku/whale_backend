import { Config, Init, Provide } from '@midwayjs/core';
import * as OSS from 'ali-oss';
import { Stream } from 'stream';
import path = require('path');
export interface IOssConfig {
  accessKey: string;
  accessSecret: string;
  bucket: {
    region?: string;
  };
}

export interface IUploadOption {
  filePath?: string;
  fileName?: string;
  folderName?: string;
  forbidOverride?: 'true' | 'false';
  stream?: Stream | Buffer;
}

export const genUploadHeader = ({ forbidOverride, filename }) => {
  return {
    // 指定Object的存储类型。
    'x-oss-storage-class': 'Standard',
    // 指定Object的访问权限。
    'x-oss-object-acl': 'public-read',
    // 通过文件URL访问文件时，指定以附件形式下载文件，下载后的文件名称定义为example.txt。
    'Content-Disposition': 'filename="' + filename,
    // 指定PutObject操作时是否覆盖同名目标Object。此处设置为true，表示禁止覆盖同名Object。
    'x-oss-forbid-overwrite': forbidOverride || 'true',
  };
};

@Provide()
export class OssService {
  @Config('ali')
  config: IOssConfig;

  client: OSS;

  mainDomain = 'https://fms.whalepea.com';

  @Init()
  async init() {
    this.client = OSS({
      region: this.config.bucket.region,
      // 从环境变量中获取访问凭证。运行本代码示例之前，请确保已设置环境变量OSS_ACCESS_KEY_ID和OSS_ACCESS_KEY_SECRET。
      accessKeyId: this.config.accessKey,
      accessKeySecret: this.config.accessSecret,
      bucket: 'whale-pub',
    });
  }
  /**
   * 上传文件
   * @param option
   * @returns
   */
  async uploadFile(option: IUploadOption) {
    const headers = genUploadHeader({
      forbidOverride: option.forbidOverride,
      filename: option.fileName,
    });
    const filePath = path.normalize(option.filePath);
    const result = await this.client
      .put(`${option.folderName || ''}${option.fileName}`, filePath, {
        headers,
      })
      .catch(e => {
        console.log(e);
        throw e;
      });
    const { url } = result;
    if (!url) {
      throw new Error('upload file failed');
    }
    // 域名替换
    // const mainDomain = 'https://fms.whalepea.com';
    // 命中任意域名正则表达式,包括http和https协议
    const domainReg = /^https?:\/\/[^/]+/;
    return { data: url.replace(domainReg, this.mainDomain) };
  }

  async getFile(src: string, type = 'buffer') {
    const domainReg = /^(https?:\/\/)?([\w.-]+)(:\d+)?\/api\/file\/get\//;
    const url = src.replace(domainReg, '');
    const result = await this.client.get(url);
    return result;
  }

  async uploadStream(option: IUploadOption) {
    const headers = genUploadHeader({
      forbidOverride: option.forbidOverride,
      filename: option.fileName,
    });
    return await this.client
      .putStream(
        `${option.folderName || ''}${option.fileName}`,
        option.stream,
        {
          headers,
        }
      )
      .catch(e => {
        console.log(e);
      });
  }
}
