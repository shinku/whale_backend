import { App, Config, IMidwayApplication, Provide } from '@midwayjs/core';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { dirname, isAbsolute, join } from 'path';
import { IEduNewsConfig } from './PlaywrightService';

/**
 * /api/edu/news/refresh 的单日调用凭证
 */
export interface IRefreshQuota {
  /** 本次是否放行 */
  allowed: boolean;
  /** 当前环境 */
  env: string;
  /** 今天已经调用过的次数（不含本次） */
  used: number;
  /** 每天允许的次数，0 表示不限制 */
  limit: number;
  /** 是否不限次数（local 环境） */
  unlimited: boolean;
  /** 今天还剩几次，-1 表示不限制 */
  remaining: number;
  reason?: string;
}

/** 非 local 环境默认每天允许的手动刷新次数 */
const DEFAULT_DAILY_LIMIT = 2;

/** 默认凭证文件，相对于项目根目录 */
const DEFAULT_RECORD_FILE = 'logs/edu-news-refresh.txt';

/**
 * 手动刷新凭证：每次调用往本地 txt 追一行记录，
 * 非 local 环境按“自然日（+08:00）”限制调用次数，local 不限制。
 *
 * 说明：文件按行记录，第一列是 `YYYY-MM-DD HH:mm:ss`，
 * 统计当天次数时只比对日期前缀，所以历史记录会一直保留下来。
 */
@Provide()
export class EduNewsRefreshGuardService {
  @App()
  app!: IMidwayApplication;

  @Config('eduNews')
  config!: IEduNewsConfig;

  /**
   * 当前环境，midway 的取值顺序是 MIDWAY_SERVER_ENV > NODE_ENV > prod
   */
  getEnv(): string {
    const app: any = this.app;
    if (app && typeof app.getEnv === 'function') {
      return app.getEnv();
    }
    return process.env.MIDWAY_SERVER_ENV || process.env.NODE_ENV || 'prod';
  }

  /**
   * 主流程：先查额度，放行时才写凭证
   */
  consume(note = 'manual'): IRefreshQuota {
    const quota = this.check();
    if (quota.allowed) {
      this.record(note);
    }
    return quota;
  }

  /**
   * 只查额度，不写凭证
   */
  check(): IRefreshQuota {
    const env = this.getEnv();
    const used = this.todayRecords().length;
    const limit = this.dailyLimit();

    // local 环境不限制次数
    if (env === 'local') {
      return {
        allowed: true,
        env,
        used,
        limit: 0,
        unlimited: true,
        remaining: -1,
      };
    }

    if (used >= limit) {
      return {
        allowed: false,
        env,
        used,
        limit,
        unlimited: false,
        remaining: 0,
        reason: `今天的手动刷新次数已用完（${used}/${limit}），请明天再试`,
      };
    }

    return {
      allowed: true,
      env,
      used,
      limit,
      unlimited: false,
      remaining: limit - used,
    };
  }

  /**
   * 追加一条调用凭证
   */
  record(note = 'manual') {
    const file = this.recordFile();
    try {
      mkdirSync(dirname(file), { recursive: true });
      const line = `${this.nowText()}\t${note}`;
      appendFileSync(file, `${line}\n`, 'utf-8');
    } catch (e) {
      // 凭证写失败不阻断采集，只提示
      console.warn(`[eduNews] 刷新凭证写入失败 ${file}：${e.message}`);
    }
  }

  /**
   * 凭证文件路径，支持配置绝对路径
   */
  recordFile(): string {
    const configured = this.config?.refreshRecordFile || DEFAULT_RECORD_FILE;
    if (isAbsolute(configured)) {
      return configured;
    }
    const app: any = this.app;
    const baseDir =
      (app && typeof app.getBaseDir === 'function' && app.getBaseDir()) ||
      process.cwd();
    return join(baseDir, configured);
  }

  private dailyLimit(): number {
    const limit = Number(this.config?.refreshDailyLimit);
    return Number.isFinite(limit) && limit > 0
      ? Math.floor(limit)
      : DEFAULT_DAILY_LIMIT;
  }

  private todayRecords(): string[] {
    const today = this.nowText().slice(0, 10);
    return this.readRecords().filter(line => line.startsWith(today));
  }

  private readRecords(): string[] {
    const file = this.recordFile();
    if (!existsSync(file)) {
      return [];
    }
    try {
      return readFileSync(file, 'utf-8')
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean);
    } catch (e) {
      console.warn(`[eduNews] 刷新凭证读取失败 ${file}：${e.message}`);
      return [];
    }
  }

  /**
   * 按 +08:00 输出 `YYYY-MM-DD HH:mm:ss`，保证“一天”是北京时间自然日
   */
  private nowText(): string {
    return new Date(Date.now() + 8 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 19)
      .replace('T', ' ');
  }
}
