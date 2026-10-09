import {
  Document,
  ImageRun,
  ISectionOptions,
  Packer,
  Paragraph,
  PageOrientation,
} from 'docx';
import { transformHtmlToDocx } from 'html-docxjs-compiler';
import { dirname, join } from 'path';

/** HTML -> Word 的转换策略 */
// regural：基于 html-docxjs-compiler 把 HTML 解析成 docx 元素，稳定但不保证 100% 还原样式
// pdfkit-convert：先 HTML -> PDF 保真渲染，再把 PDF 每页转成图片塞进 docx，样式还原度高但偶发报错
export type HtmlToDocStrategy = 'regural' | 'pdfkit-convert';

/** 1 pt = 20 twips（Word 页面尺寸单位） */
const PT_TO_TWIP = 20;
/** 1 pt = 96/72 px（docx 图片尺寸单位，按 96dpi 换算） */
const PT_TO_PX = 96 / 72;
/** pdfkit-convert 默认光栅化倍率，越大越清晰、产物体积越大 */
const DEFAULT_PDF_SCALE = 2;

/**
 * 给 HTML 片段补齐 doc 文档所需的头部结构（DOCTYPE / html / head / body）。
 * 已经是完整文档（含 doctype 或 <html>）时原样返回，避免重复嵌套。
 */
export const wrapHtmlDocument = (html = '') => {
  const src = String(html ?? '');
  if (!src.trim()) {
    return src;
  }
  if (/<!doctype/i.test(src) || /<html[\s>]/i.test(src)) {
    return src;
  }
  // 片段里若自带 head / body，取出内容复用，避免丢失 meta / style
  const headMatch = /<head[^>]*>([\s\S]*?)<\/head>/i.exec(src);
  const bodyMatch = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(src);
  const head = headMatch ? headMatch[1].trim() : '';
  const body = bodyMatch ? bodyMatch[1].trim() : src;
  return `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
<title>document</title>
${head}
</head>
<body>
${body}
</body>
</html>`;
};

/**
 * regural 策略：基于 html-docxjs-compiler 把 HTML 转成 docx 元素后打包成 .docx。
 * @param html HTML 片段或完整文档
 */
export async function htmlToDocx(html: string): Promise<Buffer> {
  if (!html) {
    throw new Error('html is empty');
  }
  // 补全 doc 文档所需的 html 头（DOCTYPE / html / head / body）后再转换
  const children = await transformHtmlToDocx(wrapHtmlDocument(html));
  const doc = new Document({
    sections: [
      {
        properties: {},
        children: children as any,
      },
    ],
  });
  return Packer.toBuffer(doc);
}

/** PDF 单页光栅化后的产物（含页面尺寸信息，便于原样还原到 docx 页面） */
export interface PdfPageImage {
  /** PNG 图片数据 */
  buffer: Buffer;
  /** PDF 页面原始宽度（pt） */
  widthPt: number;
  /** PDF 页面原始高度（pt） */
  heightPt: number;
}

export interface PdfRasterizeOptions {
  /** 渲染倍率，默认 2 */
  scale?: number;
}

/* eslint-disable @typescript-eslint/no-var-requires */
let canvasModule: any;
let pdfjsModule: any;
let canvasFactory: any;

/**
 * 用 @napi-rs/canvas 实现 pdfjs 的 CanvasFactory 接口。
 * pdfjs 渲染透明组 / 图像蒙版时会自行创建画布，默认走 NodeCanvasFactory -> require('canvas')；
 * 本仓库不装需要编译的原生 canvas，统一交给 @napi-rs/canvas。
 */
function createCanvasFactory(module: any) {
  return {
    create(width: number, height: number) {
      const canvasEl = module.createCanvas(width, height);
      return { canvas: canvasEl, context: canvasEl.getContext('2d') };
    },
    reset(canvasAndContext: any, width: number, height: number) {
      canvasAndContext.canvas.width = width;
      canvasAndContext.canvas.height = height;
    },
    destroy(canvasAndContext: any) {
      canvasAndContext.canvas.width = 0;
      canvasAndContext.canvas.height = 0;
      canvasAndContext.canvas = null;
      canvasAndContext.context = null;
    },
  };
}

/**
 * 懒加载 PDF 光栅化依赖：
 * - @napi-rs/canvas 提供 Node 下的 canvas 实现（含 pdfjs 需要的 DOMMatrix / Path2D / ImageData）
 * - pdfjs-dist 负责把 PDF 页面渲染到 canvas
 * 放在函数里按需加载，避免常规策略也无谓地引入原生模块和告警。
 */
function loadPdfRasterizer() {
  if (!canvasModule) {
    canvasModule = require('@napi-rs/canvas');
    // pdfjs 渲染依赖浏览器全局对象，Node 下用 canvas 的实现补齐（已存在则不覆盖）
    const g = globalThis as any;
    if (!g.DOMMatrix) g.DOMMatrix = canvasModule.DOMMatrix;
    if (!g.Path2D) g.Path2D = canvasModule.Path2D;
    if (!g.ImageData) g.ImageData = canvasModule.ImageData;
    canvasFactory = createCanvasFactory(canvasModule);
  }
  if (!pdfjsModule) {
    pdfjsModule = require('pdfjs-dist/legacy/build/pdf.js');
  }
  return { canvas: canvasModule, pdfjs: pdfjsModule, canvasFactory };
}
/* eslint-enable @typescript-eslint/no-var-requires */

/**
 * 把 PDF 的每一页光栅化成 PNG 图片（保留 PDF 的排版样式）。
 * @param pdf PDF 文件内容
 * @param options 光栅化参数
 */
export async function pdfBufferToPageImages(
  pdf: Buffer,
  options: PdfRasterizeOptions = {}
): Promise<PdfPageImage[]> {
  if (!pdf || !pdf.length) {
    throw new Error('pdf is empty');
  }
  const scale =
    options.scale && options.scale > 0 ? options.scale : DEFAULT_PDF_SCALE;
  const { canvas, pdfjs, canvasFactory } = loadPdfRasterizer();
  // 非嵌入字体（如 Helvetica）需要标准字体数据，否则渲染时字符会被跳过
  const pdfjsEntry = require.resolve('pdfjs-dist/legacy/build/pdf.js');
  const standardFontDataUrl =
    join(dirname(pdfjsEntry), '..', '..', 'standard_fonts') + '/';

  const doc = await pdfjs.getDocument({
    data: new Uint8Array(pdf),
    // 必须关掉：pdfjs 在 Node 下用 canvas 画字形轮廓，标准字体（Helvetica 等非嵌入字体）
    // 的字形数据只能来自 standardFontDataUrl 指向的字体文件；
    // 一旦 useSystemFonts 为 true，fetchStandardFontData 会直接返回 null（Symbol/ZapfDingbats 除外），
    // 字形永远解析不出来，渲染时整段文字被静默跳过（产物是白页）。
    useSystemFonts: false,
    standardFontDataUrl,
    // pdfjs 内部需要建画布时（透明组 / 图像蒙版等）用它，避免走 NodeCanvasFactory 去 require('canvas')
    canvasFactory,
  }).promise;

  const pages: PdfPageImage[] = [];
  try {
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
      const page = await doc.getPage(pageNumber);
      // 未缩放的视口用于还原 docx 的页面尺寸，缩放后的视口用于渲染清晰度
      const baseViewport = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale });
      const width = Math.ceil(viewport.width);
      const height = Math.ceil(viewport.height);
      const canvasEl = canvas.createCanvas(width, height);
      const ctx = canvasEl.getContext('2d');
      // PDF 页面本身没有底色，先铺白，避免透明背景在 Word 里发黑
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      await page.render({ canvasContext: ctx, viewport }).promise;
      pages.push({
        buffer: canvasEl.toBuffer('image/png'),
        widthPt: baseViewport.width,
        heightPt: baseViewport.height,
      });
      if (typeof page.cleanup === 'function') {
        page.cleanup();
      }
    }
  } finally {
    if (doc && typeof doc.destroy === 'function') {
      await doc.destroy();
    }
  }
  return pages;
}

/**
 * 把「一页一张图片」的页面拼成 docx：每个 PDF 页对应一个 docx 分节，
 * 分节尺寸与该 PDF 页一致且页边距为 0，图片铺满整页，从而保留 PDF 的样式与分页。
 */
export async function pageImagesToDocx(pages: PdfPageImage[]): Promise<Buffer> {
  if (!pages.length) {
    throw new Error('pages is empty');
  }
  const sections: ISectionOptions[] = pages.map(page => {
    const widthPx = Math.round(page.widthPt * PT_TO_PX);
    const heightPx = Math.round(page.heightPt * PT_TO_PX);
    // docx 在 orientation 为 landscape 时会自行交换 w:w / w:h，
    // 因此这里始终按「短边 = width、长边 = height」传入，交给 orientation 决定最终朝向。
    const isLandscape = page.widthPt > page.heightPt;
    const shortPt = Math.min(page.widthPt, page.heightPt);
    const longPt = Math.max(page.widthPt, page.heightPt);
    return {
      properties: {
        page: {
          size: {
            width: Math.round(shortPt * PT_TO_TWIP),
            height: Math.round(longPt * PT_TO_TWIP),
            orientation: isLandscape
              ? PageOrientation.LANDSCAPE
              : PageOrientation.PORTRAIT,
          },
          margin: { top: 0, right: 0, bottom: 0, left: 0 },
        },
      },
      children: [
        new Paragraph({
          spacing: { before: 0, after: 0 },
          children: [
            new ImageRun({
              type: 'png',
              data: page.buffer,
              transformation: { width: widthPx, height: heightPx },
            }),
          ],
        }),
      ],
    };
  });
  return Packer.toBuffer(new Document({ sections }));
}

/**
 * pdfkit-convert 策略：PDF -> 每页 PNG -> 每页一张图片的 .docx。
 * @param pdf PDF 文件内容
 * @param options 光栅化参数
 */
export async function pdfBufferToDocx(
  pdf: Buffer,
  options: PdfRasterizeOptions = {}
): Promise<Buffer> {
  const pages = await pdfBufferToPageImages(pdf, options);
  return pageImagesToDocx(pages);
}
