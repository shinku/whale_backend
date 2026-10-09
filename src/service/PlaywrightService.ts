import { Config, Destroy, Provide } from '@midwayjs/core';
import { Browser, BrowserContext, Page, chromium } from 'playwright';
import TurndownService = require('turndown');
import gfm = require('turndown-plugin-gfm');
import axios from 'axios';

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
  /** 非 local 环境每天允许手动刷新的次数 */
  refreshDailyLimit: number;
  /** 手动刷新凭证文件，相对路径按项目根目录解析 */
  refreshRecordFile: string;
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
 * 把页面改造成「自包含」的：外链样式表内联成 <style>，CSS 与标签属性里的相对地址补成绝对地址，
 * 最后把整份 DOM 序列化出来一起返回。
 *
 * 背景：page.content() 只是把 DOM 序列化出来，<link rel="stylesheet"> 这类外链样式表、
 * 以及 /xxx 这种根相对地址都不会被带上，html 一旦离开原站点（保存成本地文件、丢给
 * html_to_pdf/html_to_doc 用 setContent 渲染）就会掉样式。
 *
 * 之所以放在浏览器里做而不是服务端后处理：只有浏览器能读到 document.styleSheets 的
 * cssRules（包含 JS 动态注入的样式、以及已经摊平的 @import）。
 *
 * 之所以连序列化也放在这里，而不是内联完再 page.content()：React 会把被摘掉的样式表
 * <link> 重新挂回 <head>（实抓目标页面时踩到过，<head> 里又冒出一个根相对的 <link>）；
 * 清理和序列化在同一个 evaluate（同一个 JS task）里完成，中间不给框架插入的机会。
 * 顺带一提 documentElement.outerHTML 不含 doctype，缺了会让浏览器退化成怪异模式，所以补上。
 *
 * 注意：这个函数会被 page.evaluate 序列化后丢进页面执行，不能引用模块作用域里的任何变量。
 * 返回值里的 pending 是「跨域样式表」的 id + 地址——跨域样式表读 cssRules 会抛 SecurityError，
 * 只能由服务端再抓一次兜底（调用方抓回来之后再调一次本函数）。
 */
function inlinePageAssets(): { html: string; pending: string[] } {
  const base = document.baseURI;
  const absolutize = (value: string): string => {
    const url = (value || '').trim();
    // 空值 / 已有协议（http:、data:、mailto:…）/ 纯锚点，都不动
    if (!url || /^[a-z][a-z0-9+.-]*:/i.test(url) || url.charAt(0) === '#') {
      return value;
    }
    try {
      return new URL(url, base).href;
    } catch (error) {
      return value;
    }
  };
  const fixCssUrls = (css: string): string =>
    css.replace(
      /url\((\s*['"]?)([^'")]+)\1\s*\)/gi,
      (matched: string, quote: string, raw: string) => {
        const fixed = absolutize(raw);
        return fixed === raw ? matched : `url(${quote}${fixed}${quote})`;
      }
    );
  /**
   * 递归收集样式表内容；type === 3 是 CSSRule.IMPORT_RULE，
   * 它的规则挂在 styleSheet 上，直接收 styleSheet 就等于把 @import 展开了。
   */
  const readSheet = (sheet: CSSStyleSheet | null): string => {
    if (!sheet) {
      return '';
    }
    return Array.from(sheet.cssRules).reduce((css: string, rule: CSSRule) => {
      const imported = (rule as CSSImportRule).styleSheet;
      if (rule.type === 3 && imported) {
        return css + readSheet(imported as CSSStyleSheet);
      }
      return css + rule.cssText + '\n';
    }, '');
  };

  const pending: string[] = [];
  Array.from(
    document.querySelectorAll<HTMLLinkElement>('link[rel~="stylesheet"]')
  ).forEach((link, index) => {
    const href = link.href;
    let css = '';
    try {
      css = readSheet(link.sheet);
    } catch (error) {
      css = '';
    }
    if (!css) {
      const id = `pending-${index}`;
      link.setAttribute('data-inline-pending', id);
      pending.push(`${id}\t${href}`);
      return;
    }
    const style = document.createElement('style');
    style.setAttribute('data-inlined-from', href);
    style.textContent = fixCssUrls(css);
    link.replaceWith(style);
  });

  // 页面自己注入的 <style>（antd 的 cssinjs、@font-face 等）里的相对地址同样要补
  Array.from(document.querySelectorAll('style')).forEach(style => {
    const css = style.textContent;
    if (css) {
      style.textContent = fixCssUrls(css);
    }
  });

  // 标签属性上的相对地址：图片、脚本、图标、srcset 候选列表等
  Array.from(
    document.querySelectorAll(
      '[href],[src],[poster],[data-src],[srcset],[data-srcset]'
    )
  ).forEach(node => {
    ['href', 'src', 'poster', 'data-src'].forEach(attr => {
      const value = node.getAttribute(attr);
      if (value) {
        node.setAttribute(attr, absolutize(value));
      }
    });
    ['srcset', 'data-srcset'].forEach(attr => {
      const value = node.getAttribute(attr);
      if (!value) {
        return;
      }
      node.setAttribute(
        attr,
        value
          .split(',')
          .map(candidate => {
            // srcset 是「地址 + 宽度/倍率描述符」的列表，只动地址那一段
            const parts = candidate.trim().split(/\s+/);
            return [absolutize(parts[0]), ...parts.slice(1)].join(' ');
          })
          .join(', ')
      );
    });
  });

  /**
   * 返回的是静态快照，不再需要任何脚本：全删。
   * 留着只会带来副作用——框架水合会再改 DOM（把刚内联掉的样式表以根相对 <link> 挂回来）、
   * Next.js 调试浮层被重新插回来，和我们的改动互相打架。
   * 和序列化放在同一个 task 里删，中间不给框架插回去的机会。
   */
  document
    .querySelectorAll('script, nextjs-portal')
    .forEach(node => node.remove());

  let doctype = '';
  if (document.doctype) {
    try {
      doctype = new XMLSerializer().serializeToString(document.doctype);
    } catch (error) {
      doctype = '<!DOCTYPE html>';
    }
  }

  return { html: doctype + document.documentElement.outerHTML, pending };
}

/**
 * CSS 里的相对 url()（@font-face 字体、背景图等）补成绝对地址，基准是这份 CSS 自己的地址。
 */
export const absolutizeCssUrls = (css: string, base: string): string => {
  return (css || '').replace(
    /url\((\s*['"]?)([^'")]+)\1\s*\)/gi,
    (matched: string, quote: string, raw: string) => {
      const url = (raw || '').trim();
      if (!url || /^[a-z][a-z0-9+.-]*:/i.test(url) || url.charAt(0) === '#') {
        return matched;
      }
      try {
        return `url(${quote}${new URL(url, base).href}${quote})`;
      } catch (error) {
        return matched;
      }
    }
  );
};

/**
 * 等页面「安静」下来再抓：连续 quietMs 没有 DOM 变更（head 里插 <style>、文本渲染都算）
 * 就认为定型，最多等 maxMs。
 *
 * 为什么需要：这类 SPA 的样式/内容常在 load 之后才补齐 —— antd 的 cssinjs 是在客户端
 * 把组件样式 prepend 进 <head> 的，load 一到就序列化会时有时无地漏掉这整块样式
 * （实抓目标页面时 7 次里有约一半的 html 没有这部分 <style>），离线打开就少一块。
 */
async function waitForDomSettle(page: Page, quietMs = 300, maxMs = 2000) {
  await page.evaluate(
    ({ quiet, hard }) =>
      new Promise<void>(resolve => {
        let timer = setTimeout(finish, quiet);
        const cap = setTimeout(finish, hard);
        const observer = new MutationObserver(() => {
          clearTimeout(timer);
          timer = setTimeout(finish, quiet);
        });
        function finish() {
          clearTimeout(timer);
          clearTimeout(cap);
          observer.disconnect();
          resolve();
        }
        observer.observe(document.documentElement, {
          childList: true,
          subtree: true,
          characterData: true,
        });
      }),
    { quiet: quietMs, hard: maxMs }
  );
}

/**
 * 服务端兜底：抓跨域样式表（浏览器读不到 cssRules 的那种），顺带展开它的 @import。
 * 抓不到就让调用方保留原来的 <link>，至少不破坏页面。
 */
async function fetchCssSheet(href: string, depth = 0): Promise<string> {
  if (depth >= 3) {
    return '';
  }
  const res = await axios.get(href, {
    responseType: 'text',
    timeout: 15000,
    // 有些 CDN 的 content-type 不是 text/css，别让 axios 把它当 JSON 解析
    transformResponse: [data => data],
  });
  const css = typeof res.data === 'string' ? res.data : String(res.data);

  const pattern =
    /@import\s+(?:url\(\s*(['"]?)([^'")]+)\1\s*\)|(['"])([^'"]+)\3)\s*([^;]*);/gi;
  let out = '';
  let cursor = 0;
  let match: RegExpExecArray | null = pattern.exec(css);
  while (match) {
    out += css.slice(cursor, match.index);
    cursor = match.index + match[0].length;
    // 带 media 的 @import 有额外语义，原样保留
    if ((match[5] || '').trim()) {
      out += match[0];
    } else {
      try {
        const importedUrl = new URL(match[2] || match[4], href).href;
        out += await fetchCssSheet(importedUrl, depth + 1);
      } catch (error) {
        out += match[0];
      }
    }
    match = pattern.exec(css);
  }
  return absolutizeCssUrls(out + css.slice(cursor), href);
}

/** 单张图片内联上限：5MB（指图片原始字节，base64 后约放大 1/3） */
const DEFAULT_MAX_IMAGE_BYTES = 5 * 1024 * 1024;
/** 整页图片内联总上限：20MB，超出后剩下的图片保留绝对地址 */
const DEFAULT_MAX_TOTAL_IMAGE_BYTES = 20 * 1024 * 1024;

/**
 * 从 srcset 里挑一个候选地址：优先「最大宽度 / 最大倍率」，都没有描述符就取最后一个。
 * 静态快照只需要一个确定的分辨率，多份 base64 只是浪费体积。
 */
export const pickSrcsetCandidate = (srcset: string): string => {
  const candidates = (srcset || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
  const pick = (pattern: RegExp, weight: (value: string) => number) => {
    let best = '';
    let bestScore = -1;
    candidates.forEach(item => {
      const parts = item.split(/\s+/);
      const matched = pattern.exec((parts[1] || '').toLowerCase());
      if (!matched) {
        return;
      }
      const score = weight(matched[1]);
      if (score >= bestScore) {
        bestScore = score;
        best = parts[0];
      }
    });
    return best;
  };
  // 宽度描述符（384w）优先，其次倍率（2x），都没有描述符就取最后一个候选
  const last = candidates.length
    ? candidates[candidates.length - 1].split(/\s+/)[0]
    : '';
  return pick(/^(\d+)w$/, Number) || pick(/^([\d.]+)x$/, Number) || last;
};

/** 响应头不可信时按魔数嗅探图片类型 */
export const sniffImageMime = (body: Buffer): string => {
  if (!body || body.length < 4) {
    return '';
  }
  if (body[0] === 0xff && body[1] === 0xd8) {
    return 'image/jpeg';
  }
  if (body.slice(0, 8).toString('hex') === '89504e470d0a1a0a') {
    return 'image/png';
  }
  if (body.slice(0, 4).toString('ascii') === 'GIF8') {
    return 'image/gif';
  }
  if (
    body.slice(0, 4).toString('ascii') === 'RIFF' &&
    body.slice(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  if (
    /^(avif|avis|heic|heif|mif1|msf1)$/.test(
      body.slice(8, 12).toString('ascii')
    )
  ) {
    return 'image/avif';
  }
  if (body.slice(0, 4).toString('hex') === '00000100') {
    return 'image/x-icon';
  }
  if (body.slice(0, 2).toString('ascii') === 'BM') {
    return 'image/bmp';
  }
  const head = body.slice(0, 300).toString('utf8').trim().toLowerCase();
  if (
    head.startsWith('<svg') ||
    (head.startsWith('<?xml') && head.indexOf('<svg') > -1)
  ) {
    return 'image/svg+xml';
  }
  return '';
};

/** 字体之类的地址不用白跑一趟 */
const looksLikeNonImage = (url: string) =>
  /\.(woff2?|ttf|otf|eot|css|js|mjs|json)([?#]|$)/i.test(url);

/**
 * 把 html 里的图片抓成 data URI（base64），覆盖 `<img>/<source>` 的 src、srcset 与
 * `<style>` 里的 url()（字体除外）。
 *
 * 失败 / 超限 / 判定不是图片 → 保留原地址，接口整体不失败。
 * 注意：内联后 `<img>` 会去掉 srcset（同一个 data URI 没必要多份）和 loading="lazy"。
 */
async function inlineImagesInHtml(
  html: string,
  fetchImage: (url: string) => Promise<{ mime: string; body: Buffer } | null>,
  options: { maxImageBytes: number; maxTotalImageBytes: number }
): Promise<{ html: string; inlined: number; skipped: number }> {
  const candidates = new Set<string>();
  const addCandidate = (url: string) => {
    const value = (url || '').trim();
    if (value && !value.startsWith('data:') && !looksLikeNonImage(value)) {
      candidates.add(value);
    }
  };

  const imageTags: string[] = html.match(/<(?:img|source)\b[^>]*>/gi) || [];
  imageTags.forEach(tag => {
    const src = (tag.match(/\ssrc="([^"]*)"/i) || [])[1];
    if (src) {
      addCandidate(src);
    }
    const srcset = (tag.match(/\ssrcset="([^"]*)"/i) || [])[1];
    if (srcset) {
      srcset
        .split(',')
        .forEach(item => addCandidate(item.trim().split(/\s+/)[0]));
    }
  });

  const styleBlocks: string[] =
    html.match(/<style\b[^>]*>[\s\S]*?<\/style>/gi) || [];
  styleBlocks.forEach(block => {
    const pattern = /url\((\s*['"]?)([^'")]+)\1\s*\)/gi;
    let match = pattern.exec(block);
    while (match) {
      addCandidate(match[2]);
      match = pattern.exec(block);
    }
  });

  const dataUris = new Map<string, string>();
  let totalBytes = 0;
  const list = Array.from(candidates);
  // 限并发 4：图片多的时候别把目标站点打爆
  for (let i = 0; i < list.length; i += 4) {
    const chunk = list.slice(i, i + 4);
    const results = await Promise.all(
      chunk.map(async url => {
        try {
          const image = await fetchImage(url);
          if (!image || image.body.length > options.maxImageBytes) {
            return { url, dataUri: '' };
          }
          return {
            url,
            dataUri: `data:${image.mime};base64,${image.body.toString(
              'base64'
            )}`,
            size: image.body.length,
          };
        } catch (error) {
          return { url, dataUri: '', size: 0 };
        }
      })
    );
    results.forEach(result => {
      if (!result.dataUri) {
        return;
      }
      // 总量超限就停止内联，剩下的保留原地址
      if (totalBytes + (result.size || 0) > options.maxTotalImageBytes) {
        return;
      }
      totalBytes += result.size || 0;
      dataUris.set(result.url, result.dataUri);
    });
  }

  let inlined = 0;
  const replaceTag = (tag: string) => {
    const isSource = /^<source\b/i.test(tag);
    const srcset = (tag.match(/\ssrcset="([^"]*)"/i) || [])[1];
    const candidateFromSrcset = srcset ? pickSrcsetCandidate(srcset) : '';
    const src = (tag.match(/\ssrc="([^"]*)"/i) || [])[1];
    // srcset 才是浏览器实际用的那份（Next.js Image 的 src 常常只是小图），优先它
    const preferred = dataUris.has(candidateFromSrcset)
      ? candidateFromSrcset
      : dataUris.has(src)
      ? src
      : '';
    if (!preferred) {
      return tag;
    }
    const dataUri = dataUris.get(preferred) as string;
    inlined++;
    let next = tag;
    if (isSource) {
      return next.replace(/\ssrcset="[^"]*"/i, ` srcset="${dataUri}"`);
    }
    next = next.replace(/\ssrc="[^"]*"/i, ` src="${dataUri}"`);
    if (srcset) {
      next = next.replace(/\ssrcset="[^"]*"/i, '');
    }
    return next.replace(/\sloading="[^"]*"/i, '');
  };
  html = html.replace(/<(?:img|source)\b[^>]*>/gi, replaceTag);

  if (dataUris.size) {
    html = html.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, block =>
      block.replace(
        /url\((\s*['"]?)([^'")]+)\1\s*\)/gi,
        (matched: string, quote: string, raw: string) => {
          const dataUri = dataUris.get(raw.trim());
          return dataUri ? `url(${quote}${dataUri}${quote})` : matched;
        }
      )
    );
  }

  return { html, inlined, skipped: candidates.size - dataUris.size };
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
    } catch (e:any) {
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

  /**
   * 用无头 chromium 渲染 HTML 并导出 PDF（保真还原 HTML 样式）
   * @param html 完整 HTML 文档或片段
   */
  async renderHtmlToPdf(
    html: string,
    options: {
      format?: 'A4' | 'A3' | 'Letter';
      landscape?: boolean;
      printBackground?: boolean;
      margin?: {
        top?: string;
        bottom?: string;
        left?: string;
        right?: string;
      };
    } = {}
  ): Promise<Buffer> {
    const context = await this.getContext();
    const page = await context.newPage();
    try {
      await page.setContent(html, {
        waitUntil: 'networkidle',
        timeout: this.timeout,
      });
      const pdf = await page.pdf({
        format: options.format || 'A4',
        landscape: options.landscape || false,
        // 默认打印背景色/图，否则 CSS 背景、色块会丢失
        printBackground: options.printBackground !== false,
        margin: {
          top: options.margin?.top || '12mm',
          bottom: options.margin?.bottom || '12mm',
          left: options.margin?.left || '10mm',
          right: options.margin?.right || '10mm',
        },
      });
      return Buffer.from(pdf);
    } finally {
      await page.close().catch(() => null);
    }
  }

  /**
   * 打开一个 URL，等页面 onload 之后，返回完整 HTML 与整页截图的 base64
   * @param url 目标地址，仅支持 http/https
   * @param options.fullPage 是否整页截图（true 时截取整个滚动区域），默认 true
   * @param options.width 视口宽度，默认沿用共享上下文的 1440
   * @param options.height 视口高度，默认沿用共享上下文的 900
   * @param options.waitUntil 等待时机，默认 load（即 onload）
   */
  async capturePage(
    url: string,
    options: {
      fullPage?: boolean;
      width?: number;
      height?: number;
      waitUntil?: 'load' | 'domcontentloaded' | 'networkidle';
      /** 是否把图片内联成 base64，默认 true */
      inlineImage?: boolean;
      /** 单张图片上限（原始字节），默认 5MB */
      maxImageBytes?: number;
      /** 图片内联总量上限（原始字节），默认 20MB */
      maxTotalImageBytes?: number;
    } = {}
  ): Promise<{ url: string; html: string; screenshot: string }> {
    const target = (url || '').trim();
    if (!/^https?:\/\//i.test(target)) {
      throw new Error('url is invalid');
    }
    const context = await this.getContext();
    const page = await context.newPage();
    try {
      if (options.width || options.height) {
        await page.setViewportSize({
          width: options.width || 1440,
          height: options.height || 900,
        });
      }
      await page.goto(target, {
        waitUntil: options.waitUntil || 'load',
        timeout: this.timeout,
      });
      // load 之后 SPA 还在继续渲染（样式、数据），等 DOM 安静下来再抓，避免拿到半成品
      await waitForDomSettle(page);
      /**
       * 摘掉「不属于页面内容」的节点：
       * - [class~="print:hidden"]：Tailwind 的打印隐藏约定（页脚、按钮条等），这些是
       *   只在屏幕上出现的 chrome，不属于要交付的页面内容；
       * - script[data-nextjs-dev-overlay] / nextjs-portal：Next.js 开发模式的调试浮层，
       *   只有 dev server 会注入，抓下来就是一段多余标记（还会在截图里画出调试徽标）。
       * 目标是 SPA 时，load 之后框架还会继续渲染、把这些节点重新插回来，
       * 所以先删一遍再挂 MutationObserver 持续清理，保证 content() / screenshot() 拿到的是干净页面。
       */
      await page.evaluate(() => {
        const selector =
          '[class~="print:hidden"], script[data-nextjs-dev-overlay], nextjs-portal';
        const strip = () => {
          document.querySelectorAll(selector).forEach(node => node.remove());
        };
        strip();
        new MutationObserver(strip).observe(document.documentElement, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['class'],
        });
      });
      /**
       * 把样式内联、相对地址绝对化，并直接拿到序列化后的 html，让返回的 html 脱离原站点也能正常渲染。
       * 跨域样式表浏览器读不到 cssRules，退回服务端抓一次，抓回来再跑一遍（这一遍的结果才是最终 html）。
       */
      let prepared = await page.evaluate(inlinePageAssets);
      if (prepared.pending.length) {
        const inlined: Array<[string, string]> = [];
        for (const item of prepared.pending) {
          const [id, href] = item.split('\t');
          try {
            inlined.push([id, await fetchCssSheet(href)]);
          } catch (error) {
            // 抓不到就留着原 <link>，不做进一步处理
          }
        }
        if (inlined.length) {
          await page.evaluate((sheets: Array<[string, string]>) => {
            sheets.forEach(([id, css]) => {
              const link = document.querySelector(
                `[data-inline-pending="${id}"]`
              );
              if (!link) {
                return;
              }
              const style = document.createElement('style');
              style.setAttribute(
                'data-inlined-from',
                link.getAttribute('href') || ''
              );
              style.textContent = css;
              link.replaceWith(style);
            });
          }, inlined);
          prepared = await page.evaluate(inlinePageAssets);
        }
      }
      /**
       * 图片内联成 base64：走共享 context 的 request，自带 cookie / referer，
       * 抓不到的、超限的一律保留绝对地址。
       */
      let html = prepared.html;
      if (options.inlineImage !== false) {
        const result = await inlineImagesInHtml(
          html,
          async imageUrl => {
            const response = await context.request.get(imageUrl, {
              timeout: this.timeout,
            });
            if (!response.ok()) {
              return null;
            }
            const body = await response.body();
            const headerMime = String(response.headers()['content-type'] || '')
              .split(';')[0]
              .trim()
              .toLowerCase();
            const mime = /^image\//.test(headerMime)
              ? headerMime
              : sniffImageMime(body);
            if (!/^image\//.test(mime)) {
              return null;
            }
            return { mime, body };
          },
          {
            maxImageBytes: options.maxImageBytes || DEFAULT_MAX_IMAGE_BYTES,
            maxTotalImageBytes:
              options.maxTotalImageBytes || DEFAULT_MAX_TOTAL_IMAGE_BYTES,
          }
        );
        html = result.html;
      }
      const shot = await page.screenshot({
        fullPage: options.fullPage !== false,
        type: 'png',
      });
      return {
        url: target,
        html,
        screenshot: Buffer.from(shot).toString('base64'),
      };
    } finally {
      await page.close().catch(() => null);
    }
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
