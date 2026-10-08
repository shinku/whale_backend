import { Config, Inject, Provide } from '@midwayjs/core';
import { spawn } from 'child_process';
import { Document, Packer } from 'docx';
import { existsSync, mkdirSync, readFileSync, unlink, writeFileSync } from 'fs';
import { transformHtmlToDocx } from 'html-docxjs-compiler';
import { join } from 'path';
import { ImageService } from './ImageService';
import { OssService } from './OssService';
import { PlaywrightService } from './PlaywrightService';

export const switchPythonEnv = async (cmd: string) => {
  return cmd;
};

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
   */
  async htmlToDoc(html: string): Promise<Buffer> {
    if (!html) {
      throw new Error('html is empty');
    }
    // 补全 doc 文档所需的 html 头（DOCTYPE / html / head / body）后再转换
    const htmlContent = wrapHtmlDocument(html)
    const children = await transformHtmlToDocx(htmlContent);
    writeFileSync(join(this.outputDir, 'tmp/test.html'), htmlContent);
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
        if(!option.file && !option.stream && !option.fileUrl) {
          throw new Error('file or stream or fileUrl is required');
        }
        let stream: Buffer | string = option.stream as Buffer | string;
        if (option.fileUrl) {
          stream = option.fileUrl;
        }
        if (!stream) {
          stream = readFileSync(join(option.file || ""));
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
        cli.stdout.on('end', (data:string) => {
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
