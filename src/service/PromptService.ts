import { Provide } from '@midwayjs/core';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';

@Provide()
export class PromptService {
  private getPromptDirs() {
    return [
      // running from src (ts-node / jest)
      join(__dirname, '..', 'prompts'),
      // running the compiled dist output from the project root
      join(process.cwd(), 'src', 'prompts'),
    ];
  }

  async getPrompt(actName: string) {
    if (actName === 'README') {
      throw new Error(`prompt file not found: ${actName}.md`);
    }
    const promptFile = this.getPromptDirs()
      .map(dir => join(dir, `${actName}.md`))
      .find(filePath => existsSync(filePath));

    if (!promptFile) {
      throw new Error(`prompt file not found: ${actName}.md`);
    }
    return readFileSync(promptFile, 'utf-8').trim();
  }

  async getPromptList() {
    const actIds = new Set<string>();
    for (const dir of this.getPromptDirs()) {
      if (!existsSync(dir)) {
        continue;
      }
      for (const file of readdirSync(dir)) {
        if (file.endsWith('.md') && file !== 'README.md') {
          actIds.add(file.slice(0, -3));
        }
      }
    }
    return Array.from(actIds).sort();
  }
}
