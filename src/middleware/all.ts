import { Middleware } from '@midwayjs/core';
import { IMiddleware,Context } from 'egg';

@Middleware()
export class AllMiddleware implements IMiddleware {
  resolve() {
    return async (ctx: Context<any>, next: () => Promise<any>) => {
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
      } catch (e: any) {
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
