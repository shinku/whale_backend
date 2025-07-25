import { MidwayAppInfo, MidwayConfig } from '@midwayjs/core';
import { join } from 'path';

export default (appInfo: MidwayAppInfo) => {
  return {
    // use for cookie sign key, should change to your own and keep security
    keys: appInfo.name + '_1742034871993_6436',
    outputDir: appInfo.appDir + '/output',
    appDir: appInfo.appDir,
    security: {
      csrf: {
        enable: false,
      },
    },
    egg: {
      port: 7001,
      hostname: '0.0.0.0',
    },
    middleware: ['logMiddleware', 'laneMiddleware', 'allMiddleware'],
    python: {
      bin: 'python3',
    },
    upload: {
      // mode: UploadMode, 默认为file，即上传到服务器临时目录，可以配置为 stream
      mode: 'file',
      // fileSize: string, 最大上传文件大小，默认为 10mb
      fileSize: '10mb',
      // whitelist: string[]，文件扩展名白名单
      whitelist: [
        '.jpg',
        '.jpeg',
        '.png',
        '.gif',
        '.bmp',
        '.wbmp',
        '.webp',
        '.pdf',
        '.svg',
      ],
      // tmpdir: string，上传的文件临时存储路径
      tmpdir: join(appInfo.appDir + '/output', 'midway-upload-files'),
      // cleanTimeout: number，上传的文件在临时目录中多久之后自动删除，默认为 5 分钟
      cleanTimeout: 5 * 60 * 1000,
      // base64: boolean，设置原始body是否是base64格式，默认为false，一般用于腾讯云的兼容
      base64: false,
      // 仅在匹配路径到 /api/file/upload 的时候去解析 body 中的文件信息
      match: /upload/,
    },
    sequelize: {
      dataSource: {
        default: {},
      },
    },
  } as MidwayConfig;
};
