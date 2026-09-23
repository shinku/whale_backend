import { Config, ILogger, Inject, Provide } from '@midwayjs/core';
import { HumanMessage } from '@langchain/core/messages';
import { tool } from '@langchain/core/tools';
import { ChatOpenAI } from '@langchain/openai';
import { createDeepAgent } from 'deepagents';
import { createHash } from 'crypto';
import { unlink, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Op } from 'sequelize';
import { z } from 'zod';
import { EduNewsModel } from '../model/EduNewsModel';
import { EduNewsAgentReporter, oneLine } from './EduNewsAgentReporter';
import { OssService } from './OssService';
import {
  IArticleDetail,
  IArticleListItem,
  IEduNewsConfig,
  PlaywrightService,
} from './PlaywrightService';

export interface ICollectStats {
  /** 列表页拿到的条数 */
  scanned: number;
  /** 打开过的详情页数量 */
  fetched: number;
  /** 入库条数 */
  saved: number;
  /** 已存在跳过条数 */
  duplicated: number;
  /** 判定为非政策相关，过滤掉的条数 */
  filtered: number;
  /** 抓取失败条数 */
  failed: number;
  /** 本轮新上传的图片数 */
  uploadedImages: number;
}

export interface ICollectResult extends ICollectStats {
  trigger: 'cron' | 'manual';
  skipped: boolean;
  reason?: string;
  error?: string;
  durationMs: number;
}

/**
 * 政策类新闻关键词，仅用于 agent 判定失效时的兜底
 */
const POLICY_KEYWORDS = [
  '政策',
  '通知',
  '意见',
  '办法',
  '规定',
  '条例',
  '规划',
  '纲要',
  '改革',
  '方案',
  '部署',
  '印发',
  '出台',
  '新规',
  '标准',
  '规范',
  '双减',
  '招生',
  '考试',
  '学籍',
  '督导',
  '评估',
  '资助',
  '就业',
  '教育部',
  '教育厅',
];

export const isPolicyRelated = (text: string) => {
  const target = text || '';
  return POLICY_KEYWORDS.some(keyword => target.includes(keyword));
};

const truncate = (text: string, max: number) => {
  const value = text || '';
  return value.length > max ? value.slice(0, max) : value;
};

/**
 * 按 +08:00 输出时间文本，方便给到模型
 */
const formatDateTime = (date: Date) => {
  return new Date(date.getTime() + 8 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 19)
    .replace('T', ' ');
};

const SYSTEM_PROMPT = [
  '你是教育新闻采集助手，负责从下面这几个教育资讯站点里挑选“教育政策相关”的新闻并归档。',
  '',
  '采集站点（列表页地址就在这里，调用 listEducationNews 时按顺序把地址传进去，不要自己编地址）：',
  '1. 中国青年网 · 教育要闻：https://edu.youth.cn/wzlb/',
  '2. 高考网 · 高考新闻：https://www.gaokao.com/baokao/yxdq/gkxxs/',
  '3. 中考网 · 中考政策：https://www.zhongkao.com/baokao/zkzc/',
  '',
  '工作原则：',
  '1. 只处理你确实打开过详情页、拿到正文的新闻，绝不编造标题、正文、来源和时间；',
  '1.1 站点地址只允许用上面给出的列表页地址，其他站点一律不要抓；',
  '2. 判定标准：内容涉及教育政策、法规、通知、意见、规划、改革举措、招生考试、教育治理、教育标准等，才算政策相关；单纯的校园活动、人物报道、观点评论不算；',
  '3. 入库存的是详情页原文，你只需要调用 saveEduNews 并给出 url 和 category，正文由系统从原页面复制；',
  '3.1 图片只能使用 fetchArticle 返回的 images 里的地址，images 为空就不要调用上传工具；',
  '3.2 正文是 Markdown 文档，图片位置是 [[IMG_n]] 占位符，n 对应 images 数组下标 +1；占位符你不用管，系统会在入库时替换成 OSS 地址；',
  '4. 优先处理最新的新闻，已入库（alreadySaved 为 true）的跳过；',
  '5. 工具返回 ok=false 或 saved=false 时说明原因并继续处理下一条，不要中断整个任务。',
  '6. 思考过程和最终汇报都用中文，不要用英文。',
].join('\n');

/**
 * 采集站点统一从 prompt 里解析，避免配置和提示词两处维护
 */
export const EDU_NEWS_SOURCES = (
  SYSTEM_PROMPT.match(/https?:\/\/[^\s，。]+/g) || [
    'https://edu.youth.cn/wzlb/',
  ]
).map(url => ({
  url,
  host: (() => {
    try {
      return new URL(url).hostname;
    } catch (e) {
      return '';
    }
  })(),
}));

export const EDU_NEWS_HOSTS = EDU_NEWS_SOURCES.map(item => item.host).filter(
  Boolean
);

/**
 * 每天 6:00 / 18:00 通过 deepagents 采集教育政策新闻
 */
@Provide()
export class NewsService {
  @Config('eduNews')
  config!: IEduNewsConfig;

  @Config('deepseek')
  deepseekConfig!: {
    appId: string;
  };

  @Inject()
  playwrightService!: PlaywrightService;

  @Inject()
  ossService!: OssService;

  @Inject()
  logger!: ILogger;

  /** 同一次采集内复用详情页结果，避免重复开页面 */
  private articleCache = new Map<string, IArticleDetail>();

  /** 图片原始地址 -> OSS 地址 */
  private uploadedImages = new Map<string, string>();

  /** 本轮列表页见过的文章地址（按 url 去重，算扫描总数） */
  private scannedUrls = new Set<string>();

  private running = false;

  /**
   * 统一日志出口，走 Midway logger（控制台 + 日志文件），脱离容器运行时退回 console
   */
  private print(message: string) {
    if (this.logger && typeof this.logger.info === 'function') {
      this.logger.info(message);
    } else {
      console.log(message);
    }
  }

  private printWarn(message: string) {
    if (this.logger && typeof this.logger.warn === 'function') {
      this.logger.warn(message);
    } else {
      console.warn(message);
    }
  }

  private printError(message: string, error?: any) {
    const detail = error ? `${message}：${error.message || error}` : message;
    if (this.logger && typeof this.logger.error === 'function') {
      this.logger.error(detail);
    } else {
      console.error(detail);
    }
  }

  /**
   * 采集一轮
   */
  async runCollect(
    trigger: 'cron' | 'manual' = 'cron'
  ): Promise<ICollectResult> {
    const startedAt = Date.now();
    const stats: ICollectStats = {
      scanned: 0,
      fetched: 0,
      saved: 0,
      duplicated: 0,
      filtered: 0,
      failed: 0,
      uploadedImages: 0,
    };

    if (this.running) {
      return {
        ...stats,
        trigger,
        skipped: true,
        reason: '上一轮采集还没结束，本次跳过',
        durationMs: 0,
      };
    }

    this.running = true;
    this.print(`[eduNews] ===== 开始采集（触发方式：${trigger}）=====`);
    try {
      this.articleCache.clear();
      this.scannedUrls.clear();
      let agentFailed = false;
      try {
        await this.runAgent(stats);
      } catch (e) {
        agentFailed = true;
        this.printError('[eduNews] agent 执行失败', e);
      }

      // 只在 agent 崩了、或压根没打开过任何详情页时兜底。
      // agent 正常跑完却一条都没入库，说明它判定这些新闻不属于教育政策，尊重这个结论。
      const allDuplicated =
        stats.scanned > 0 && stats.duplicated >= stats.scanned;
      if (
        stats.saved === 0 &&
        !allDuplicated &&
        (agentFailed || stats.fetched === 0)
      ) {
        this.print('[eduNews] agent 没有处理任何新闻，转关键词兜底');
        await this.keywordFallback(stats);
      }

      this.print(
        `[eduNews] ===== 采集完成：扫描 ${stats.scanned} 条，打开详情 ${
          stats.fetched
        } 条，入库 ${stats.saved} 条，已存在 ${stats.duplicated} 条，过滤 ${
          stats.filtered
        } 条，失败 ${stats.failed} 条，上传图片 ${
          stats.uploadedImages
        } 张，耗时 ${((Date.now() - startedAt) / 1000).toFixed(1)}s =====`
      );
      return {
        ...stats,
        trigger,
        skipped: false,
        durationMs: Date.now() - startedAt,
      };
    } catch (e) {
      this.printError('[eduNews] 采集失败', e);
      return {
        ...stats,
        trigger,
        skipped: false,
        error: e.message,
        durationMs: Date.now() - startedAt,
      };
    } finally {
      this.running = false;
    }
  }

  /**
   * 最新 10 条（只取 available = true）
   */
  async getLatestNews(limit = 10) {
    const size = Number(limit) > 0 && Number(limit) <= 50 ? Number(limit) : 10;
    const rows = await EduNewsModel.findAll({
      where: { available: true },
      order: [
        ['publish_time', 'DESC'],
        ['id', 'DESC'],
      ],
      limit: size,
    });
    return rows.map(row => ({
      id: row.id,
      title: row.title,
      content: row.content,
      source: row.source,
      publish_time: row.publish_time,
      category: row.category,
      url: row.url,
    }));
  }

  /**
   * 交给 deepagents 编排：列表 -> 详情 -> 判政策 -> 传图 -> 入库
   */
  private async runAgent(stats: ICollectStats) {
    const model = new ChatOpenAI({
      model: this.config.model || 'deepseek-chat',
      apiKey: this.deepseekConfig.appId,
      temperature: 0,
      configuration: {
        baseURL: this.config.baseUrl || 'https://api.deepseek.com/v1',
      },
    });

    const agent = createDeepAgent({
      model,
      tools: this.buildTools(stats),
      systemPrompt: SYSTEM_PROMPT,
    });

    this.print(
      '[eduNews] agent 已启动，开始按步骤执行（模型 / 工具调用会逐步打印）'
    );
    const reporter = new EduNewsAgentReporter({
      log: message => this.print(message),
    });

    const task = [
      '开始今天的教育政策新闻采集：',
      `1. 对系统提示里列出的每个站点，依次调用 listEducationNews（每个站点取最新 ${
        this.config.fetchLimit || 20
      } 条），一共 ${EDU_NEWS_SOURCES.length} 个站点，都要抓；`,
      '2. 跳过 alreadySaved 为 true 的条目；',
      '3. 按时间从新到旧处理，逐条调用 fetchArticle 拿到正文；',
      `4. 本轮最多打开 ${this.config.maxFetchPerRun || 30} 个详情页；`,
      '5. 判断是否与教育政策相关，相关的才继续处理，不相关的直接跳过；',
      '6. 相关的：先对正文配图调用 uploadImageToOss，再调用 saveEduNews 入库（只需要传 url 和 category）；',
      `7. 本轮最多入库 ${this.config.maxSavePerRun || 10} 条；`,
      '8. 最后用一句话汇报：每个站点扫描多少条、入库多少条、跳过多少条。',
    ].join('\n');

    let timer: NodeJS.Timeout | undefined;
    try {
      const result = await Promise.race([
        agent.invoke({ messages: [new HumanMessage(task)] } as any, {
          recursionLimit: 100,
          callbacks: [reporter],
        }),
        new Promise((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error('agent 执行超时')),
            this.config.runTimeoutMs || 600000
          );
        }),
      ]);

      const messages: any[] = (result as any)?.messages || [];
      const last = messages[messages.length - 1];
      const summary =
        typeof last?.content === 'string'
          ? last.content
          : JSON.stringify(last?.content || '');
      this.print(`[eduNews] agent 汇报：${oneLine(summary, 500)}`);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  /**
   * 注册给 deepagents 的 tools
   */
  private buildTools(stats: ICollectStats) {
    const listTool = tool(
      async input =>
        this.runTool('listEducationNews', async () => {
          const target = String(input?.url || '').trim();
          const host = (() => {
            try {
              return new URL(target).hostname;
            } catch (e) {
              return '';
            }
          })();
          if (!host) {
            return {
              ok: false,
              error: `列表页地址无效：${target}，请使用 prompt 里给出的站点地址`,
            };
          }
          if (!EDU_NEWS_HOSTS.includes(host)) {
            return {
              ok: false,
              error: `站点 ${host} 不在允许范围内，可用站点：${EDU_NEWS_HOSTS.join(
                '、'
              )}`,
            };
          }
          const limit = Math.min(
            Math.max(Number(input?.limit) || this.config.fetchLimit || 20, 1),
            50
          );
          const items = await this.playwrightService.listArticles(
            target,
            limit
          );
          items.forEach(item => this.scannedUrls.add(item.url));
          stats.scanned = this.scannedUrls.size;
          const existing = await this.existingUrls(items.map(item => item.url));
          const fresh = items.length - existing.size;
          this.print(
            `[eduNews] 列表页抓取完成（${host}）：共 ${items.length} 条，其中 ${existing.size} 条已入库，${fresh} 条待处理`
          );
          items.slice(0, 5).forEach((item, index) => {
            this.print(
              `[eduNews]   ${index + 1}. ${item.date} ${oneLine(
                item.title,
                60
              )}${existing.has(item.url) ? '（已入库）' : ''}`
            );
          });
          if (items.length > 5) {
            this.print(`[eduNews]   … 其余 ${items.length - 5} 条略`);
          }
          return {
            ok: true,
            count: items.length,
            items: items.map(item => ({
              ...item,
              alreadySaved: existing.has(item.url),
            })),
          };
        }),
      {
        name: 'listEducationNews',
        description:
          '抓取某个站点的新闻列表页，返回新闻标题、链接、日期，并标记该条是否已经入库。url 必须是系统提示里给出的站点地址。',
        schema: z.object({
          url: z
            .string()
            .describe('列表页地址，必须是系统提示里给出的站点地址'),
          limit: z
            .number()
            .int()
            .min(1)
            .max(50)
            .optional()
            .describe('该站点抓取条数，默认 20'),
        }),
      }
    );

    const fetchTool = tool(
      async input =>
        this.runTool('fetchArticle', async () => {
          const maxFetch = this.config.maxFetchPerRun || 30;
          if (stats.fetched >= maxFetch) {
            return {
              ok: false,
              error: `本轮打开详情页已达上限 ${maxFetch} 条，请直接结束本轮采集`,
            };
          }
          const detail = await this.getArticle(input.url);
          stats.fetched += 1;
          if (!detail.title || !detail.content) {
            return {
              ok: false,
              error: `详情页没有解析出${detail.title ? '正文' : '标题'}：${
                input.url
              }`,
            };
          }
          this.logDetail(detail);
          return {
            ok: true,
            url: detail.url,
            title: detail.title,
            source: detail.source,
            publishTime: detail.publishTime
              ? formatDateTime(detail.publishTime)
              : detail.publishTimeText,
            content: truncate(detail.content, 4000),
            contentLength: detail.content.length,
            images: detail.images,
          };
        }),
      {
        name: 'fetchArticle',
        description:
          '用无头浏览器打开新闻详情页，返回标题、正文（Markdown，图片位置是 [[IMG_n]] 占位符）、来源、新闻时间和正文配图地址。',
        schema: z.object({
          url: z.string().describe('新闻详情页链接'),
        }),
      }
    );

    const uploadTool = tool(
      async input =>
        this.runTool('uploadImageToOss', async () => {
          const result = await this.uploadImageToOss(
            input.imageUrl,
            input.referer
          );
          if (!result.cached) {
            stats.uploadedImages += 1;
          }
          this.print(
            `[eduNews] 图片${result.cached ? '命中缓存' : '上传成功'}：${
              result.url
            }`
          );
          return { ok: true, ossUrl: result.url };
        }),
      {
        name: 'uploadImageToOss',
        description:
          '通过 OssService 把新闻配图上传到 OSS，返回可公网访问的地址。',
        schema: z.object({
          imageUrl: z.string().describe('图片原始地址'),
          referer: z
            .string()
            .optional()
            .describe('图片来源页地址，用于绕过防盗链'),
        }),
      }
    );

    const saveTool = tool(
      async input =>
        this.runTool('saveEduNews', async () =>
          this.saveArticle({ url: input.url, category: input.category }, stats)
        ),
      {
        name: 'saveEduNews',
        description:
          '把一条教育政策相关新闻写入 edu_news 表。标题、正文、来源、新闻时间、图片都由系统从详情页原文复制，无需传入。',
        schema: z.object({
          url: z.string().describe('新闻详情页链接'),
          category: z.string().optional().describe('分类，默认“教育政策”'),
        }),
      }
    );

    return [listTool, fetchTool, uploadTool, saveTool];
  }

  /**
   * tool 内部异常不让它冒泡出去：模型拿到错误信息后可以继续处理下一条
   */
  private async runTool(name: string, handler: () => Promise<any>) {
    try {
      return JSON.stringify(await handler());
    } catch (e) {
      this.printError(`[eduNews] tool ${name} 执行失败`, e);
      return JSON.stringify({ ok: false, error: e.message });
    }
  }

  /**
   * 详情页结果缓存，正文入库始终以原文为准
   */
  private logDetail(detail: IArticleDetail) {
    this.print(
      `[eduNews] 详情页解析完成：${oneLine(detail.title, 80)}｜来源 ${
        detail.source
      }｜${
        detail.publishTime
          ? formatDateTime(detail.publishTime)
          : detail.publishTimeText
      }｜正文 ${detail.content.length} 字｜配图 ${detail.images.length} 张`
    );
  }

  private async getArticle(url: string): Promise<IArticleDetail> {
    const cached = this.articleCache.get(url);
    if (cached) {
      return cached;
    }
    const detail = await this.playwrightService.fetchArticle(url);
    this.articleCache.set(url, detail);
    return detail;
  }

  private async existingUrls(urls: string[]) {
    const existing = new Set<string>();
    if (!urls.length) {
      return existing;
    }
    const rows = await EduNewsModel.findAll({
      attributes: ['url'],
      where: { url: { [Op.in]: urls } },
    });
    rows.forEach(row => existing.add(row.url));
    return existing;
  }

  /**
   * 写库：标题/正文/来源/时间 来自原文，url 唯一索引兜底去重
   */
  private async saveArticle(
    input: { url: string; category?: string },
    stats: ICollectStats
  ): Promise<{ saved: boolean; reason: string; id?: number }> {
    const maxSave = this.config.maxSavePerRun || 10;
    if (stats.saved >= maxSave) {
      return { saved: false, reason: `本轮入库已达上限 ${maxSave} 条` };
    }

    const detail = await this.getArticle(input.url);
    if (!detail.title) {
      return { saved: false, reason: '标题为空，拒绝入库' };
    }
    if (!detail.content || detail.content.length < 30) {
      return { saved: false, reason: '正文为空或过短，拒绝入库' };
    }

    const existed = await EduNewsModel.findOne({ where: { url: detail.url } });
    if (existed) {
      stats.duplicated += 1;
      return { saved: false, reason: '该新闻已入库，跳过' };
    }

    const uploaded = await this.uploadImages(detail, stats);
    const { content, imageCount } = this.fillImagePlaceholders(
      detail,
      uploaded
    );

    try {
      const created = await EduNewsModel.create({
        title: truncate(detail.title, 500),
        content,
        source: truncate(detail.source, 120),
        publish_time: detail.publishTime,
        url: detail.url,
        category: input.category || '教育政策',
        available: true,
        collected_at: new Date(),
      } as any);
      stats.saved += 1;
      this.print(
        `[eduNews] 入库成功 id=${created.id}｜${oneLine(
          detail.title,
          80
        )}｜配图 ${imageCount} 张`
      );
      return { saved: true, reason: '入库成功', id: created.id };
    } catch (e) {
      if (e.name === 'SequelizeUniqueConstraintError') {
        stats.duplicated += 1;
        return { saved: false, reason: '该新闻已入库，跳过' };
      }
      stats.failed += 1;
      return { saved: false, reason: `入库失败：${e.message}` };
    }
  }

  private async uploadImages(detail: IArticleDetail, stats: ICollectStats) {
    const uploaded = new Map<string, string>();
    for (const imageUrl of detail.images) {
      try {
        const result = await this.uploadImageToOss(imageUrl, detail.url);
        if (!result.cached) {
          stats.uploadedImages += 1;
        }
        uploaded.set(imageUrl, result.url);
      } catch (e) {
        // 配图失败不影响新闻入库
        this.printWarn(
          `[eduNews] 配图上传失败，跳过 ${imageUrl}：${e.message}`
        );
      }
    }
    return uploaded;
  }

  /**
   * 把正文里的 [[IMG_n]] 占位符替换成上传后的 OSS 地址（前缀为 OssService.mainDomain）；
   * 上传失败的图连占位符一起去掉，图片地址最终只存在于 content 里。
   */
  private fillImagePlaceholders(
    detail: IArticleDetail,
    uploaded: Map<string, string>
  ) {
    let imageCount = 0;
    const content = (detail.content || '').replace(
      /\[\[IMG_(\d+)\]\]/g,
      (_matched, rawIndex: string) => {
        const index = Number(rawIndex) - 1;
        const sourceUrl = detail.images[index];
        const ossUrl = sourceUrl ? uploaded.get(sourceUrl) : '';
        if (!ossUrl) {
          return '';
        }
        const alt = (detail.imageAlts && detail.imageAlts[index]) || '图片';
        imageCount += 1;
        return `![${alt}](${ossUrl})`;
      }
    );
    return { content, imageCount };
  }

  /**
   * 图片下载后走现有的 OssService 上传，返回 OSS 地址
   */
  async uploadImageToOss(
    imageUrl: string,
    referer?: string
  ): Promise<{ url: string; cached: boolean }> {
    const cached = this.uploadedImages.get(imageUrl);
    if (cached) {
      return { url: cached, cached: true };
    }

    const { buffer, ext } = await this.playwrightService.fetchImage(
      imageUrl,
      referer
    );
    // 用内容哈希命名，重复采集不会产生新对象，也不会覆盖到别的图
    const hash = createHash('md5').update(buffer).digest('hex');
    const fileName = `edu_news_${hash}.${ext}`;
    const tempPath = join(tmpdir(), fileName);
    writeFileSync(tempPath, buffer);

    try {
      const { data } = await this.ossService.uploadFile({
        filePath: tempPath,
        fileName,
        folderName: this.config.ossFolder || 'edu-news/',
        forbidOverride: 'false',
      });
      // 统一用 OssService.mainDomain 做前缀，不依赖上传接口返回的域名
      const objectKey = data.replace(/^https?:\/\/[^/]+/, '');
      const url = `${this.ossService.mainDomain}${objectKey}`;
      this.uploadedImages.set(imageUrl, url);
      return { url, cached: false };
    } finally {
      unlink(tempPath, () => null);
    }
  }

  /**
   * 兜底：agent 判定失效或一轮没入库时，用政策关键词再过一遍
   */
  private async keywordFallback(stats: ICollectStats) {
    const items: IArticleListItem[] = [];
    for (const source of EDU_NEWS_SOURCES) {
      try {
        const list = await this.playwrightService.listArticles(
          source.url,
          this.config.fetchLimit || 20
        );
        items.push(...list);
      } catch (e) {
        this.printWarn(
          `[eduNews] 兜底抓取列表失败 ${source.url}：${e.message}`
        );
      }
    }
    items.forEach(item => this.scannedUrls.add(item.url));
    stats.scanned = this.scannedUrls.size;
    const existing = await this.existingUrls(items.map(item => item.url));
    this.print(
      `[eduNews] 兜底模式：共 ${items.length} 条，其中 ${existing.size} 条已入库`
    );

    for (const item of items) {
      const maxFetch = this.config.maxFetchPerRun || 30;
      if (
        stats.saved >= (this.config.maxSavePerRun || 10) ||
        stats.fetched >= maxFetch
      ) {
        break;
      }
      if (existing.has(item.url)) {
        stats.duplicated += 1;
        continue;
      }
      try {
        const detail = await this.getArticle(item.url);
        stats.fetched += 1;
        this.logDetail(detail);
        if (!isPolicyRelated(`${detail.title}\n${detail.content}`)) {
          stats.filtered += 1;
          this.print(
            `[eduNews] 关键词判定非政策相关，跳过：${oneLine(detail.title, 60)}`
          );
          continue;
        }
        await this.saveArticle(
          { url: detail.url, category: '教育政策' },
          stats
        );
      } catch (e) {
        stats.failed += 1;
        this.printWarn(`[eduNews] 兜底抓取失败 ${item.url}：${e.message}`);
      }
    }
  }
}
