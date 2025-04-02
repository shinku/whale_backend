import { Middleware } from '@midwayjs/core';
import { IMiddleware } from 'egg';

@Middleware()
export class LaneMiddleware implements IMiddleware {
  resolve() {
    return async (ctx, next) => {
      console.log('lane_middleware');
      ctx.userId = ctx.get('x-user-id');
      await next();
    };
  }
}
