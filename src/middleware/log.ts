import { Middleware } from '@midwayjs/core';
import { IMiddleware } from 'egg';

@Middleware()
export class LogMiddleware implements IMiddleware {
  resolve() {
    return async (ctx, next) => {
      const start = Date.now();
      await next();
      const ms = Date.now() - start;
      const { method, url, body } = ctx.request;
      const { status } = ctx.response;
      console.log(
        `${method} ${url} - ${status} - ${ms}ms - [request_body]:${JSON.stringify(
          body
        )} ${ctx.userId} [body]: ${JSON.stringify(ctx.body)}`
      );
    };
  }
}
