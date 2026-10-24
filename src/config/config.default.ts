import { MidwayAppInfo, MidwayConfig } from '@midwayjs/core';
import { join } from 'path';

export default (appInfo: MidwayAppInfo) => {
  const isLocal =
    process.env.NODE_ENV === 'local' || process.env.NODE_ENV === 'unittest';
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
    auth: {
      tokenSecret:
        process.env.AUTH_TOKEN_SECRET ||
        (isLocal ? 'local-only-change-this-auth-token-secret' : ''),
      tokenTtlSeconds: Number(process.env.AUTH_TOKEN_TTL_SECONDS || 7200),
    },
    weixinMiniProgram: {
      appid: process.env.WX_APP_ID || process.env.WX_PAY_APP_ID || '',
      appsecret: process.env.WX_APP_SECRET || '',
    },
    wxPay: {
      appId: process.env.WX_PAY_APP_ID || '',
      mchId: process.env.WX_PAY_MCH_ID || '',
      mchSerialNo: process.env.WX_PAY_MCH_SERIAL_NO || '',
      privateKeyPath: process.env.WX_PAY_PRIVATE_KEY_PATH || '',
      apiV3Key: process.env.WX_PAY_API_V3_KEY || '',
      notifyUrl: process.env.WX_PAY_NOTIFY_URL || '',
      refundNotifyUrl: process.env.WX_PAY_REFUND_NOTIFY_URL || '',
      platformCertPath: process.env.WX_PAY_PLATFORM_CERT_PATH || '',
      platformSerialNo: process.env.WX_PAY_PLATFORM_SERIAL_NO || '',
      apiBaseUrl:
        process.env.WX_PAY_API_BASE_URL || 'https://api.mch.weixin.qq.com',
      requestTimeoutMs: Number(process.env.WX_PAY_REQUEST_TIMEOUT_MS || 10000),
    },
    /**
     * 请求体大小限制。
     * html_to_pdf / html_to_doc 会在 body 里内联大段 HTML（常含 base64 图片），
     * 默认 1mb 会直接抛 PayloadTooLargeError，这里放宽到 50mb。
     */
    bodyParser: {
      jsonLimit: '50mb',
      formLimit: '50mb',
      textLimit: '50mb',
    },
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
      maxSavePerRun: 15,
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
      // 非 local 环境每天最多手动刷新 2 次，local 不限次数
      refreshDailyLimit: 2,
      // 手动刷新的按天调用凭证，相对项目根目录（logs/ 已在 .gitignore 里）
      refreshRecordFile: 'logs/edu-news-refresh.txt',
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
