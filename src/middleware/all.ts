import { Middleware } from '@midwayjs/core';
import { IMiddleware } from 'egg';

@Middleware()
export class AllMiddleware implements IMiddleware {
  resolve() {
    return async (ctx, next) => {
      ctx.set('Content-Type', 'application/json; charset=utf-8');
      try {
        const result = await next();
        if (typeof result === 'object') {
          return (ctx.body = {
            status: 200,
            ...result,
          });
        } else {
          return (ctx.body = {
            status: 200,
            data: result,
          });
        }
      } catch (e) {
        if (ctx.status === 404) {
          ctx.status = 500;
          ctx.body = {
            status: 404,
            message: e.message,
          };
        }
      }
    };
  }
}
