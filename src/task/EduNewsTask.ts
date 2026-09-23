import { Job, IJob } from '@midwayjs/cron';
import { Config, Inject } from '@midwayjs/core';
import { IEduNewsConfig } from '../service/PlaywrightService';
import { NewsService } from '../service/NewsService';

/**
 * 每天早上 6:00、下午 18:00 采集一次教育政策新闻
 */
@Job({
  cronTime: '0 0 6,18 * * *',
  start: true,
  timeZone: 'Asia/Shanghai',
})
export class EduNewsTask implements IJob {
  @Config('eduNews')
  config!: IEduNewsConfig;

  @Inject()
  newsService!: NewsService;

  async onTick() {
    if (this.config && this.config.enabled === false) {
      console.log('[eduNews] eduNews.enabled = false，本轮定时采集跳过');
      return;
    }

    // pm2 cluster 下每个 worker 都会触发 cron，只让 0 号实例真正执行
    const instance = process.env.NODE_APP_INSTANCE;
    if (instance !== undefined && instance !== '0') {
      return;
    }

    const result = await this.newsService.runCollect('cron');
    console.log('[eduNews] 定时采集结果', JSON.stringify(result));
  }
}
