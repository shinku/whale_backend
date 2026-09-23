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
    /**
     * 教育政策新闻采集（deepagents + playwright）
     */
    eduNews: {
      // 定时任务开关，本地默认关闭，线上默认打开
      enabled: true,
      // 注意：采集站点地址不在这里配置，写在 NewsService 的 system prompt 里
      // 每个站点列表页取多少条
      fetchLimit: 20,
      // 每轮最多打开多少个详情页（三个站点合计）
      maxFetchPerRun: 30,
      // 每轮最多入库多少条
      maxSavePerRun: 10,
      // 无头模式
      headless: true,
      // 浏览器启动参数
      launchArgs: ['--no-sandbox', '--disable-dev-shm-usage'],
      // 单页超时
      timeout: 30000,
      // 一轮 agent 执行的软超时
      runTimeoutMs: 600000,
      // 图片上传到 OSS 的目录
      ossFolder: 'edu-news/',
      // 模型，复用 deepseek 配置
      model: 'deepseek-chat',
      baseUrl: 'https://api.deepseek.com/v1',
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
