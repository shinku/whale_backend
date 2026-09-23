import { Config, Destroy, Provide } from '@midwayjs/core';
import { Browser, BrowserContext, chromium } from 'playwright';
import TurndownService = require('turndown');
import gfm = require('turndown-plugin-gfm');

const turndownService = new TurndownService({
  headingStyle: 'atx',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
  emDelimiter: '*',
  strongDelimiter: '**',
});
turndownService.use(gfm.gfm);
turndownService.remove(['script', 'style']);

/**
 * 正文 HTML -> Markdown
 */
export const htmlToMarkdown = (html: string) =>
  turndownService.turndown(html || '').trim();

export interface IEduNewsConfig {
  enabled: boolean;
  /** 每个站点列表页取多少条 */
  fetchLimit: number;
  /** 一轮最多打开多少个详情页 */
  maxFetchPerRun: number;
  /** 一轮最多入库多少条 */
  maxSavePerRun: number;
  headless: boolean;
  launchArgs: string[];
  timeout: number;
  runTimeoutMs: number;
  ossFolder: string;
  model: string;
  baseUrl: string;
}

export interface IArticleListItem {
  title: string;
  url: string;
  date: string;
}

export interface IArticleDetail {
  title: string;
  url: string;
  /** 正文 Markdown，图片位置用 [[IMG_n]] 占位，入库前替换成 OSS 地址 */
  content: string;
  source: string;
  publishTime: Date | null;
  publishTimeText: string;
  /** 与 [[IMG_n]] 一一对应的原图地址 */
  images: string[];
  /** 与 images 对应的 alt 文案 */
  imageAlts: string[];
}

export interface IImagePayload {
  buffer: Buffer;
  contentType: string;
  ext: string;
}

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const DEFAULT_LAUNCH_ARGS = ['--no-sandbox', '--disable-dev-shm-usage'];

/**
 * 站点图标 / 二维码 / 广告位等，不算新闻配图
 */
const IMAGE_BLACKLIST =
  /(logo|ewm|qrcode|qr_|icon|blank|spacer|share|anquan|loading|advert|banner|promo|guanggao|activityconf|speiyou)/i;

/**
 * 正文顶部残留的“时间 + 来源/编辑”行
 */
const LEADING_DATE_LINE =
  /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\s*\d{0,2}:?\d{0,2}(?::\d{2})?\s*\S{0,20}$/;

/**
 * 站点默认来源名，页面里没有来源时兜底
 */
const SITE_NAMES: Record<string, string> = {
  'edu.youth.cn': '中国青年网',
  'gaokao.com': '高考网',
  'www.gaokao.com': '高考网',
  'zhongkao.com': '中考网',
  'www.zhongkao.com': '中考网',
};

/**
 * 正文里混进来的页面交互文案（展开全文按钮等）
 */
const CONTENT_NOISE = /^(展开全文|收起全文|收起|阅读全文|全文)$/;

/**
 * 正文顶部的来源 / 作者 / 时间信息行
 */
const LEADING_META =
  /(来源|稿源|作者|编辑|责任编辑|发布时间|发稿时间|阅读量|分享|评论|标签|关键字|上一篇|下一篇)\s*[:：]/;

const pad = (value: string) => value.padStart(2, '0');

const compact = (text: string) =>
  (text || '')
    .replace(/[\s\u3000]/g, '')
    .replace(/[[\]]/g, '')
    .replace(/[“”"'‘’《》()（）:：,，.。、\-—_|｜#>/]/g, '')
    .replace(/\*/g, '');

/**
 * 清理正文 Markdown：去掉顶部来源/作者/时间行、页面交互文案和多余空行
 */
export const cleanMarkdown = (raw: string, title?: string) => {
  const lines = (raw || '')
    .split('\n')
    .map(line => line.replace(/[ \t\u3000]+$/, '').trim());

  const titleKey = title ? compact(title) : '';
  const kept: string[] = [];
  let leading = true;

  for (const line of lines) {
    const bare = line.replace(/[#>*_\-\s]/g, '');
    if (CONTENT_NOISE.test(bare)) {
      continue;
    }
    if (leading) {
      const isMetaLine = LEADING_META.test(line) && line.length < 160;
      const isTitleLine =
        !!titleKey &&
        line.length < titleKey.length + 80 &&
        compact(line).indexOf(titleKey.slice(0, 12)) === 0;
      const isDateLine = LEADING_DATE_LINE.test(line) && line.length < 60;
      const isLinkOnlyLine = LINK_ONLY_LINE.test(line);
      // 顶部零碎残留（导航、阅读量等）
      if (
        isMetaLine ||
        isTitleLine ||
        isDateLine ||
        isLinkOnlyLine ||
        bare.length < 6
      ) {
        continue;
      }
      leading = false;
    }
    kept.push(line);
  }

  return kept
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

const MARKDOWN_IMAGE = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

/**
 * 只有一条链接的行（正文顶部的栏目导航、相关推荐入口）
 */
const LINK_ONLY_LINE = /^\[[^\]]*\]\([^)]*\)$/;

/**
 * Markdown 里的图片替换成 [[IMG_n]] 占位符，返回占位符与原图地址的对应关系
 */
export const applyImagePlaceholders = (
  markdown: string,
  articleUrl: string,
  publishTime: Date | null
) => {
  const images: string[] = [];
  const imageAlts: string[] = [];
  const content = (markdown || '')
    .replace(MARKDOWN_IMAGE, (_matched, alt: string, src: string) => {
      const url = resolveImageUrl(src, articleUrl) || src;
      // 站点广告图、图标直接丢掉
      if (IMAGE_BLACKLIST.test(url) || isStaleImage(url, publishTime)) {
        return '';
      }
      images.push(url);
      imageAlts.push((alt || '').trim() || '图片');
      return `[[IMG_${images.length}]]`;
    })
    // 图片被丢掉后残留的空链接
    .replace(/\[\s*\]\([^)]*\)/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { content, images, imageAlts };
};

/**
 * 去掉站点名的标题后缀：xxx_频道_站名
 */
export const cleanTitle = (docTitle: string) =>
  (docTitle || '').split(/[_|]/)[0].trim();

/**
 * 来源后面常跟着“作者：xxx 时间：xxx”，一并砍掉
 */
export const cleanSource = (text: string) => {
  const value = (text || '').replace(/\s+/g, ' ').trim();
  const cut = value.split(
    /\s*(?:作者|编辑|责任编辑|记者|时间|发布)\s*[:：]/
  )[0];
  return (cut || value).trim().slice(0, 40);
};

/**
 * 解析新闻时间，统一按 +08:00 时区处理，避免服务器时区不同导致入库时间漂移
 */
export const parsePublishTime = (
  timeText: string,
  dateText: string
): Date | null => {
  const timeMatch = (timeText || '').match(
    /(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})日?(?:\s*(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/
  );
  if (timeMatch) {
    const [, year, month, day, hour = '00', minute = '00', second = '00'] =
      timeMatch;
    const parsed = new Date(
      `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:${pad(
        second
      )}+08:00`
    );
    if (!isNaN(parsed.getTime())) {
      return parsed;
    }
  }
  const dateMatch = (dateText || '').match(
    /(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})/
  );
  if (dateMatch) {
    const parsed = new Date(
      `${dateMatch[1]}-${pad(dateMatch[2])}-${pad(dateMatch[3])}T00:00:00+08:00`
    );
    if (!isNaN(parsed.getTime())) {
      return parsed;
    }
  }
  return null;
};

/**
 * 从文章 URL 里取日期（这些站点的链接都带日期：/e/20251119/xxx.shtml、t20260923_123.htm）
 */
export const parsePublishTimeFromUrl = (url: string): Date | null => {
  const match = (url || '').match(/(?:t|\/)(20\d{2})(\d{2})(\d{2})/);
  if (!match) {
    return null;
  }
  const parsed = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00+08:00`);
  return isNaN(parsed.getTime()) ? null : parsed;
};

/**
 * 图片地址里带日期、且明显早于发稿时间的，多半是站点广告位
 */
export const isStaleImage = (imageUrl: string, publishTime: Date | null) => {
  if (!publishTime) {
    return false;
  }
  const match = (imageUrl || '').match(
    /(?:^|\/)(20\d{2})[/-](\d{2})[/-](\d{2})/
  );
  if (!match) {
    return false;
  }
  const imageTime = new Date(
    `${match[1]}-${match[2]}-${match[3]}T00:00:00+08:00`
  ).getTime();
  return publishTime.getTime() - imageTime > 60 * 24 * 3600 * 1000;
};

/**
 * 页面里没有来源时，用站点名兜底
 */
export const siteNameOf = (url: string) => {
  try {
    const host = new URL(url).hostname;
    return SITE_NAMES[host] || host;
  } catch (e) {
    return '';
  }
};

const guessExt = (url: string, contentType: string) => {
  const typeMap: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/bmp': 'bmp',
  };
  if (typeMap[contentType]) {
    return typeMap[contentType];
  }
  const urlMatch = url.split('?')[0].match(/\.(jpg|jpeg|png|gif|webp|bmp)$/i);
  return urlMatch ? urlMatch[1].toLowerCase().replace('jpeg', 'jpg') : 'jpg';
};

/**
 * 图片地址补全/校验，模型偶尔会给出相对地址或空串
 */
export const resolveImageUrl = (
  url: string,
  referer?: string
): string | null => {
  const value = (url || '').trim();
  if (!value) {
    return null;
  }
  if (/^https?:\/\//i.test(value)) {
    return value;
  }
  if (value.indexOf('//') === 0) {
    return `https:${value}`;
  }
  if (referer && /^https?:\/\//i.test(referer)) {
    try {
      return new URL(value, referer).toString();
    } catch (e) {
      return null;
    }
  }
  return null;
};

/**
 * 列表页通用提取：页面里带日期的文章链接
 * 不依赖具体站点的 DOM，站点地址由 prompt 提供
 */
function extractListItems() {
  const dateRe = /(\d{4})[-/年.](\d{1,2})[-/月.](\d{1,2})/;
  const urlDateRe = /(?:t|\/)(20\d{2})(\d{2})(\d{2})/;
  const articleUrlRe = /\.s?html?(\?|$)/i;
  const two = (value: string) => String(value).padStart(2, '0');
  const list: { title: string; url: string; date: string }[] = [];

  document.querySelectorAll('a[href]').forEach(node => {
    const link = node as HTMLAnchorElement;
    const href = (link.getAttribute('href') || '').trim();
    const title = (link.getAttribute('title') || link.textContent || '').trim();
    if (!href || href.indexOf('#') === 0 || href.indexOf('javascript') === 0) {
      return;
    }
    if (title.length < 8 || !/[\u4e00-\u9fa5]/.test(title)) {
      return;
    }
    let url = '';
    try {
      url = new URL(href, location.href).toString();
    } catch (e) {
      return;
    }
    if (!/^https?:/.test(url)) {
      return;
    }
    const hasUrlDate = urlDateRe.test(url);
    if (!articleUrlRe.test(url.split('?')[0]) && !hasUrlDate) {
      return;
    }
    const container = link.closest('li,dl,dd,tr,div') || link.parentElement;
    const around = ((container as HTMLElement | null)?.innerText || '').slice(
      0,
      200
    );
    const matched = around.match(dateRe);
    list.push({
      title: title.replace(/\s+/g, ' '),
      url,
      date: matched
        ? `${matched[1]}-${two(matched[2])}-${two(matched[3])}`
        : '',
    });
  });

  return list;
}

/**
 * 文章页通用提取：正文块打分 + 元信息
 */
function extractArticle() {
  const metaOf = (names: string[]) => {
    for (const name of names) {
      const el =
        document.querySelector(`meta[name="${name}"]`) ||
        document.querySelector(`meta[property="${name}"]`);
      const value = (el?.getAttribute('content') || '').trim();
      if (value) {
        return value;
      }
    }
    return '';
  };

  const candidateSelectors = [
    '.TRS_Editor',
    'article',
    '[id*="content"]',
    '[class*="article"]',
    '[class*="content"]',
    '[class*="detail"]',
    '[class*="zhengwen"]',
    '[class*="text"]',
    'main',
  ];

  const scoreOf = (el: HTMLElement) => {
    const text = (el.innerText || '').replace(/\s/g, '');
    const chars = text.length;
    if (chars < 120) {
      return -1;
    }
    const links = el.querySelectorAll('a');
    let linkChars = 0;
    links.forEach(a => {
      linkChars += (a.textContent || '').length;
    });
    const linkRatio = chars ? linkChars / chars : 1;
    if (linkRatio > 0.5) {
      return -1;
    }
    return chars * (1 - linkRatio) + el.querySelectorAll('p').length * 30;
  };

  let best: HTMLElement | null = null;
  let bestScore = 0;
  candidateSelectors.forEach(selector => {
    document.querySelectorAll(selector).forEach(node => {
      const el = node as HTMLElement;
      const score = scoreOf(el);
      if (score > bestScore) {
        bestScore = score;
        best = el;
      }
    });
  });

  const pageText = (document.body?.innerText || '').slice(0, 4000);
  const sourceMatch =
    pageText.match(/来源\s*[:：]\s*([^\n]{1,30})/) ||
    pageText.match(/稿源\s*[:：]\s*([^\n]{1,30})/);
  const timeMatch =
    pageText.match(
      /(?:发布时间|发稿时间|时间|日期)\s*[:：]?\s*(20\d{2}[-/年.]\d{1,2}[-/月.]\d{1,2}(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?)/
    ) ||
    pageText.match(
      /(20\d{2}[-/年.]\d{1,2}[-/月.]\d{1,2}(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?)/
    );

  // 正文块里的分享条、相关阅读、广告位先摘掉，再交给 markdown 转换
  const JUNK =
    /(share|comment|related|recommend|advert|banner|qrcode|ewm|footer|nav|aside|tags)/i;
  if (best) {
    const content = best as HTMLElement;
    content
      .querySelectorAll('script,style,noscript,iframe,form,button')
      .forEach(node => node.remove());
    content.querySelectorAll('[class],[id]').forEach(node => {
      const el = node as HTMLElement;
      if (el === content) {
        return;
      }
      const key = `${el.className || ''} ${el.id || ''}`;
      if (JUNK.test(key)) {
        el.remove();
      }
    });
    // 懒加载图片：把真实地址写回 src，并把小图标去掉
    content.querySelectorAll('img').forEach(node => {
      const img = node as HTMLImageElement;
      const src = (
        img.currentSrc ||
        img.getAttribute('src') ||
        img.getAttribute('data-src') ||
        img.getAttribute('data-original') ||
        ''
      ).trim();
      const width = img.naturalWidth || Number(img.getAttribute('width') || 0);
      const height =
        img.naturalHeight || Number(img.getAttribute('height') || 0);
      const tooSmall =
        (width > 0 && width < 120) || (height > 0 && height < 90);
      if (!src || src.indexOf('data:') === 0 || tooSmall) {
        img.remove();
        return;
      }
      img.setAttribute('src', src);
      img.removeAttribute('srcset');
      img.removeAttribute('data-src');
      img.removeAttribute('data-original');
      img.removeAttribute('width');
      img.removeAttribute('height');
    });
  }

  return {
    pageTitle: (
      document.querySelector('.page_bt .pbt')?.textContent || ''
    ).trim(),
    h1: (document.querySelector('h1')?.textContent || '').trim(),
    docTitle: document.title || '',
    sourceMeta: metaOf(['source', 'article:source', 'og:site_name']),
    timeMeta: metaOf([
      'publishdate',
      'pubdate',
      'article:published_time',
      'og:release_date',
    ]),
    sourceText: sourceMatch ? sourceMatch[1].trim() : '',
    timeText: timeMatch ? timeMatch[1].trim() : '',
    contentHtml: best ? (best as HTMLElement).innerHTML : '',
  };
}

/**
 * 无头浏览器抓取：列表页 / 文章页 / 图片下载
 */
@Provide()
export class PlaywrightService {
  @Config('eduNews')
  config!: IEduNewsConfig;

  private browser: Browser | null = null;

  private context: BrowserContext | null = null;

  private opening: Promise<BrowserContext> | null = null;

  private get timeout() {
    return this.config?.timeout || 30000;
  }

  private get launchArgs() {
    const args = this.config?.launchArgs;
    return args && args.length ? args : DEFAULT_LAUNCH_ARGS;
  }

  private async launch(extraArgs: string[] = []) {
    return chromium.launch({
      headless: this.config?.headless !== false,
      args: [...this.launchArgs, ...extraArgs],
    });
  }

  /**
   * 浏览器上下文复用，图片下载也走它，才能带上 referer / cookie
   */
  async getContext(): Promise<BrowserContext> {
    if (this.context) {
      return this.context;
    }
    if (!this.opening) {
      this.opening = this.openContext().finally(() => {
        this.opening = null;
      });
    }
    return this.opening;
  }

  private async openContext(): Promise<BrowserContext> {
    try {
      this.browser = await this.launch();
    } catch (e) {
      // 受限沙箱（容器 / CI）里 chromium 多进程启动可能被拒绝，降级单进程再试一次
      console.warn(
        '[eduNews] chromium 常规模式启动失败，降级 single-process 重试：',
        e.message
      );
      this.browser = await this.launch(['--single-process']);
    }
    this.context = await this.browser.newContext({
      userAgent: USER_AGENT,
      locale: 'zh-CN',
      viewport: { width: 1440, height: 900 },
    });
    return this.context;
  }

  /**
   * 上下文出问题后重置，下次调用重新拉起浏览器
   */
  async reset() {
    await this.close();
  }

  @Destroy()
  async close() {
    const context = this.context;
    const browser = this.browser;
    this.context = null;
    this.browser = null;
    if (context) {
      await context.close().catch(() => null);
    }
    if (browser) {
      await browser.close().catch(() => null);
    }
  }

  /**
   * 抓列表页，url 由 agent 从 prompt 里带过来
   */
  async listArticles(url: string, limit = 20): Promise<IArticleListItem[]> {
    const context = await this.getContext();
    const page = await context.newPage();
    try {
      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: this.timeout,
      });
      const raw = await page.evaluate(extractListItems);
      const seen = new Set<string>();
      return raw
        .filter(item => {
          if (seen.has(item.url)) {
            return false;
          }
          seen.add(item.url);
          return true;
        })
        .slice(0, limit);
    } finally {
      await page.close().catch(() => null);
    }
  }

  /**
   * 抓文章页：标题、正文、来源、时间、正文配图
   */
  async fetchArticle(url: string): Promise<IArticleDetail> {
    const context = await this.getContext();
    const page = await context.newPage();
    try {
      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: this.timeout,
      });
      const data = await page.evaluate(extractArticle);

      const title =
        data.pageTitle || data.h1 || cleanTitle(data.docTitle) || '';
      const publishTime =
        parsePublishTime(data.timeText, data.timeMeta) ||
        parsePublishTimeFromUrl(url);
      // 正文 HTML -> Markdown，图片位置替换成 [[IMG_n]] 占位符
      const rawMarkdown = htmlToMarkdown(data.contentHtml);
      const markdown = cleanMarkdown(rawMarkdown, title);
      const { content, images, imageAlts } = applyImagePlaceholders(
        markdown,
        url,
        publishTime
      );

      return {
        title,
        url,
        content,
        source:
          cleanSource(data.sourceText || data.sourceMeta) || siteNameOf(url),
        publishTime,
        publishTimeText: data.timeText || data.timeMeta,
        images,
        imageAlts,
      };
    } finally {
      await page.close().catch(() => null);
    }
  }

  /**
   * 下载图片二进制（走浏览器上下文，避免防盗链 403）
   */
  async fetchImage(url: string, referer?: string): Promise<IImagePayload> {
    const target = resolveImageUrl(url, referer);
    if (!target) {
      throw new Error(`图片地址无效：${JSON.stringify(url)}`);
    }
    const context = await this.getContext();
    const response = await context.request.get(target, {
      headers: referer ? { referer } : {},
      timeout: this.timeout,
    });
    if (!response.ok()) {
      throw new Error(`图片下载失败 ${response.status()} ${target}`);
    }
    const contentType = (response.headers()['content-type'] || '')
      .split(';')[0]
      .trim()
      .toLowerCase();
    return {
      buffer: Buffer.from(await response.body()),
      ext: guessExt(target, contentType),
      contentType,
    };
  }
}
