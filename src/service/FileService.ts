import { Config, Provide } from '@midwayjs/core';
import { spawn } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';

export const switchPythonEnv = async (cmd: string) => {
  return cmd;
};

/**
 * try liber office ?
 */
@Provide()
export class FileService {
  @Config('outputDir')
  outputDir: string;

  @Config('appDir')
  appDir: string;
  async convert(option: {
    type: 'pdf2doc' | string;
    file: string;
    userId: string;
  }) {
    switch (option.type) {
      case 'pdf2doc': {
        const filename = `${option.userId}_${Date.now()}.docx`;
        if (!existsSync(join(this.outputDir, '/tmp'))) {
          mkdirSync(join(this.outputDir, '/tmp'));
        }
        const targetFile = join(this.outputDir, '/tmp', filename);
        await this.doPdfToWord(option.file, targetFile);
        return filename;
      }
    }
  }

  @Config('python')
  pythonConfig: {
    bin: string;
  };
  /**
   * pdf 到 word的转换
   * @param pdfPath
   * @param docxPath
   * @returns
   */
  async doPdfToWord(pdfPath, docxPath) {
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
        cli.stdout.on('end', data => {
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
