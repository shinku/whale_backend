import { Config, Inject, Provide } from '@midwayjs/core';
import { spawn } from 'child_process';
import { existsSync, mkdirSync, readFileSync, unlink, writeFileSync } from 'fs';
import { join } from 'path';
import { ImageService } from './ImageService';
import { OssService } from './OssService';
import { PlaywrightService } from './PlaywrightService';
import {
  HtmlToDocStrategy,
  htmlToDocx,
  pdfBufferToDocx,
  wrapHtmlDocument,
} from './utils/file';

export const switchPythonEnv = async (cmd: string) => {
  return cmd;
};

// 兼容历史用法：wrapHtmlDocument 已迁移到 utils/file.ts，这里继续对外透出
export { wrapHtmlDocument };

/**
 * try liber office ?
 */
@Provide()
export class FileService {
  @Config('outputDir')
  outputDir!: string;

  @Config('appDir')
  appDir!: string;

  @Inject()
  imageService!: ImageService;

  @Inject()
  ossService!: OssService;

  @Inject()
  playwrightService!: PlaywrightService;

  /**
   * HTML -> PDF（无头 chromium 渲染）
   */
  async htmlToPdf(
    html: string,
    options?: {
      format?: 'A4' | 'A3' | 'Letter';
      landscape?: boolean;
      printBackground?: boolean;
    }
  ): Promise<Buffer> {
    if (!html) {
      throw new Error('html is empty');
    }
    return this.playwrightService.renderHtmlToPdf(html, options);
  }

  /**
   * HTML -> Word（真 .docx，基于 html-docxjs-compiler 把 HTML 转成 docx 元素）
   * toStrategy: regural 常规，目前的。transformHtmlToDocx方法
   * pdfkit-convert pdfkit-convert，pdfkit-convert方法
   * 目前两种方法都可以，regural 方法更稳定，pdfkit-convert 方法有时会报错。
   * pdfkit-convert 方法的优点是可以直接把 HTML 转成 PDF，再通过pdfkit框架得到每页的图片后再通过docx框架再转成 Word，保留了 PDF 的样式。
   */
  async htmlToDoc(
    html: string,
    toStrategy: HtmlToDocStrategy = 'regural',
    options: {
      /** pdfkit-convert：PDF 页面光栅化倍率 */
      scale?: number;
      /** pdfkit-convert：HTML -> PDF 的纸张尺寸 */
      format?: 'A4' | 'A3' | 'Letter';
      /** pdfkit-convert：HTML -> PDF 是否横向 */
      landscape?: boolean;
      /** pdfkit-convert：HTML -> PDF 是否打印背景色/图 */
      printBackground?: boolean;
      /** pdfkit-convert 失败时是否回退到 regural，默认 true */
      fallbackToRegular?: boolean;
    } = {}
  ): Promise<Buffer> {
    if (!html) {
      throw new Error('html is empty');
    }
    if (toStrategy === 'pdfkit-convert') {
      try {
        // 先用无头 chromium 把 HTML 渲染成 PDF（保真样式），再把 PDF 每页转成图片塞进 docx
        const pdf = await this.htmlToPdf(wrapHtmlDocument(html), {
          format: options.format,
          landscape: options.landscape,
          printBackground: options.printBackground,
        });
        return await pdfBufferToDocx(pdf, { scale: options.scale });
      } catch (err) {
        if (options.fallbackToRegular === false) {
          throw err;
        }
        // pdfkit-convert 偶发报错，默认回退到更稳定的 regural 策略
        console.warn(
          `[htmlToDoc] pdfkit-convert 失败，回退到 regural 策略: ${
            (err as Error)?.message
          }`
        );
      }
    }
    return htmlToDocx(html);
  }

  async convert(option: {
    type: 'pdf2doc' | 'pdf2doc_textin' | string;
    file?: string;
    stream?: Buffer;
    userId: string;
    // 文件的远程路径
    fileUrl?: string;
  }) {
    switch (option.type) {
      case 'pdf2doc_textin': {
        if (!option.file && !option.stream && !option.fileUrl) {
          throw new Error('file or stream or fileUrl is required');
        }
        let stream: Buffer | string = option.stream as Buffer | string;
        if (option.fileUrl) {
          stream = option.fileUrl;
        }
        if (!stream) {
          stream = readFileSync(join(option.file || ''));
        }

        const uploadedDoc = await this.imageService.tiPdfToDocx(stream);
        const docFileName = `${option.userId}_${Date.now()}.docx`;
        if (!existsSync(join(this.outputDir, 'tmp'))) {
          mkdirSync(join(this.outputDir, 'tmp'));
        }
        const docxPath = join(this.outputDir, 'tmp/', docFileName);
        writeFileSync(docxPath, uploadedDoc);
        await this.ossService.uploadFile({
          filePath: docxPath,
          fileName: docFileName,
          forbidOverride: 'true',
          folderName: 'pub/',
        });
        unlink(docxPath, (...params) => {
          console.log('unlink pdf', params);
        });
        return 'pub/' + docFileName;
      }
    }
  }

  @Config('python')
  pythonConfig!: {
    bin: string;
  };
  /**
   * pdf 到 word的转换
   * @param pdfPath
   * @param docxPath
   * @returns
   */
  async doPdfToWord(pdfPath: string, docxPath: string) {
    return new Promise((resolve, reject) => {
      // libreoffice --headless --convert-to docx ./test.pdf --outdir ./test.doc
      const pythonBin = this.pythonConfig?.bin || 'python';
      const cmd = `${pythonBin} ${this.appDir}/call_task/py/office.py --pdf ${pdfPath} --docx ${docxPath}`;
      //const cmd = 'python3 --version';
      switchPythonEnv(cmd).then((cmd: string) => {
        console.log(cmd);
        const cli = spawn(cmd, {
          shell: true,
        });
        cli.stdout.on('data', data => {
          const log = Buffer.from(data).toString();
          console.log(log + '\n');
        });
        cli.stdout.on('end', (data: string) => {
          resolve(data);
        });
        cli.stderr.on('data', data => {
          const log = Buffer.from(data).toString();
          console.log(log + '\n');
          // reject(log);
        });
        cli.stderr.on('error', data => {
          console.log(data);
          reject(data);
        });
      });
    });
  }
}
