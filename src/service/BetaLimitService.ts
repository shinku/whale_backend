import { Singleton } from '@midwayjs/core';
import { Op, Sequelize, UniqueConstraintError } from 'sequelize';
import { BusinessError } from '../core/errors';
import { BetaLimitedModel } from '../model/BetaLimitedModel';

export interface BetaLimitQuota {
  openid: string;
  feature: string;
  usageDate: string;
  used: number;
  limit: number;
  remaining: number;
}

@Singleton()
export class BetaLimitService {
  async check(
    openid: string,
    feature: string,
    limit: number
  ): Promise<BetaLimitQuota> {
    const normalizedLimit = this.normalizeLimit(limit);
    const usageDate = this.currentUsageDate();
    const record = await BetaLimitedModel.findOne({
      attributes: ['used_count'],
      where: {
        user_id: openid,
        feature,
        usage_date: usageDate,
      },
      raw: true,
    });
    const used = Math.max(0, Number(record?.used_count) || 0);
    if (used >= normalizedLimit) {
      throw new BusinessError(
        `今日调用次数已用完（${used}/${normalizedLimit}），请明天再试`,
        429,
        'BETA_DAILY_LIMIT_EXCEEDED'
      );
    }

    return {
      openid,
      feature,
      usageDate,
      used,
      limit: normalizedLimit,
      remaining: normalizedLimit - used,
    };
  }

  async consume(quota: BetaLimitQuota): Promise<boolean> {
    const [updated] = await BetaLimitedModel.update(
      {
        used_count: Sequelize.literal('used_count + 1'),
      },
      {
        where: {
          user_id: quota.openid,
          feature: quota.feature,
          usage_date: quota.usageDate,
          used_count: {
            [Op.lt]: quota.limit,
          },
        },
      }
    );
    if (updated > 0) {
      return true;
    }

    const existing = await BetaLimitedModel.findOne({
      attributes: ['id'],
      where: {
        user_id: quota.openid,
        feature: quota.feature,
        usage_date: quota.usageDate,
      },
      raw: true,
    });
    if (existing) {
      return false;
    }

    try {
      await BetaLimitedModel.create({
        user_id: quota.openid,
        feature: quota.feature,
        usage_date: quota.usageDate,
        used_count: 1,
      });
      return true;
    } catch (error) {
      if (!(error instanceof UniqueConstraintError)) {
        throw error;
      }
      // Another in-flight request may have created the row first.
      const [retried] = await BetaLimitedModel.update(
        {
          used_count: Sequelize.literal('used_count + 1'),
        },
        {
          where: {
            user_id: quota.openid,
            feature: quota.feature,
            usage_date: quota.usageDate,
            used_count: {
              [Op.lt]: quota.limit,
            },
          },
        }
      );
      if (retried === 0) {
        return false;
      }
      return true;
    }
  }

  currentUsageDate(now = Date.now()): string {
    return new Date(now + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }

  private normalizeLimit(limit: number) {
    const value = Number(limit);
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 1;
  }
}
