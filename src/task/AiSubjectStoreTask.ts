import { Job, IJob } from '@midwayjs/cron';
import { Op } from 'sequelize';
import { AI_SUBJECT_STORE_TTL } from '../core/limits';
import { AiSubjectStoreModel } from '../model/AiSubjectStoreModel';

/**
 * 每小时清理一次 ai_subject_store 中超过 24 小时的过期出题结果
 */
@Job({
  cronTime: '0 0 * * * *',
  start: true,
  timeZone: 'Asia/Shanghai',
})
export class AiSubjectStoreTask implements IJob {
  async onTick() {
    // pm2 cluster 下每个 worker 都会触发 cron，只让 0 号实例真正执行
    const instance = process.env.NODE_APP_INSTANCE;
    if (instance !== undefined && instance !== '0') {
      return;
    }

    const expireBefore = new Date(Date.now() - AI_SUBJECT_STORE_TTL);
    const removed = await AiSubjectStoreModel.destroy({
      where: {
        createdAt: {
          [Op.lt]: expireBefore,
        },
      },
    });
    console.log('[aiSubjectStore] 清理过期出题结果条数', removed);
  }
}
