import { Middleware } from '@midwayjs/core';
import { IMiddleware } from 'egg';

@Middleware()
export class AllMiddleware implements IMiddleware {
  resolve() {
    return async (ctx, next) => {
      try {
        await next();
      } catch (e) {
        if (ctx.status === 404) {
          ctx.status = 404;
          ctx.body = {
            status: 404,
            message: e.message,
          };
        }
      }
    };
  }
}
