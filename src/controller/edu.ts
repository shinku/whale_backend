import { Get, Inject, Provide } from '@midwayjs/core';
import { Context } from 'egg';
import { NewsService } from '../service/NewsService';
import Api from './api/Api';

@Provide()
@Api('/edu')
export class EduController {
  @Inject()
  ctx!: Context;

  @Inject()
  newsService!: NewsService;

  /**
   * 最新教育政策新闻（默认 10 条）
   */
  @Get('/news')
  async getNews() {
    const list = await this.newsService.getLatestNews(
      Number(this.ctx.query.limit) || 10
    );
    return {
      data: {
        count: list.length,
        list,
      },
    };
  }

  /**
   * 手动触发一次采集，wait=1 时同步等待结果
   */
  @Get('/news/refresh')
  async refreshNews() {
    const wait = ['1', 'true'].includes(String(this.ctx.query.wait || ''));
    if (!wait) {
      // 采集要跑几分钟，默认后台执行，避免请求超时
      this.newsService
        .runCollect('manual')
        .catch(e => console.error('[eduNews] 手动采集失败', e));
      return {
        data: {
          started: true,
          message: '采集任务已在后台启动，可稍后查询 /api/edu/news',
        },
      };
    }
    return {
      data: await this.newsService.runCollect('manual'),
    };
  }
}
