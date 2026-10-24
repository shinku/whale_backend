import { Middleware } from '@midwayjs/core';
import { IMiddleware } from 'egg';

@Middleware()
export class LogMiddleware implements IMiddleware {
  resolve() {
    return async (ctx: any, next: () => Promise<any>) => {
      const start = Date.now();
      await next();
      const ms = Date.now() - start;
      const { method, url, body } = ctx.request;
      const { status } = ctx.response;
      const sensitiveRoute =
        url.startsWith('/api/pay/wechat') ||
        url.startsWith('/api/vip/orders') ||
        url.startsWith('/api/auth/wechat-login');
      console.log(
        `${method} ${url} - ${status} - ${ms}ms - [request_body]:${
          sensitiveRoute ? '[redacted]' : JSON.stringify(body)
        } ${ctx.userId || ''} [body]: ${
          sensitiveRoute ? '[redacted]' : JSON.stringify(ctx.body)
        }`
      );
    };
  }
}
