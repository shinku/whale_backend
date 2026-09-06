import { Middleware } from '@midwayjs/core';
import { Context, IMiddleware } from 'egg';

@Middleware()
export class CheckUserLoginMiddleware implements IMiddleware {
  resolve() {
    return async (ctx: Context, next: () => Promise<any>) => {
      await next();
    };
  }
}
