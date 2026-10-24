import { Middleware } from '@midwayjs/core';
import { Context, IMiddleware } from 'egg';
import { BusinessError } from '../core/errors';

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

@Middleware()
export class VipRateLimitMiddleware implements IMiddleware {
  private readonly buckets = new Map<string, RateLimitBucket>();

  resolve() {
    return async (ctx: Context<any>, next: () => Promise<any>) => {
      const openid = ctx.vipAuth?.openid;
      if (!openid) {
        throw new BusinessError('请先登录', 401, 'AUTH_REQUIRED');
      }

      const now = Date.now();
      const key = `${openid}:${ctx.method}`;
      const bucket = this.buckets.get(key);
      if (!bucket || bucket.resetAt <= now) {
        this.buckets.set(key, {
          count: 1,
          resetAt: now + 60 * 1000,
        });
      } else if (bucket.count >= 10) {
        ctx.set(
          'Retry-After',
          String(Math.ceil((bucket.resetAt - now) / 1000))
        );
        throw new BusinessError(
          '操作过于频繁，请稍后再试',
          429,
          'RATE_LIMITED'
        );
      } else {
        bucket.count += 1;
      }

      if (this.buckets.size > 10000) {
        for (const [bucketKey, item] of this.buckets) {
          if (item.resetAt <= now) {
            this.buckets.delete(bucketKey);
          }
        }
      }
      return next();
    };
  }
}
