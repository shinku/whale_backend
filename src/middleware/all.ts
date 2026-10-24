import { Middleware } from '@midwayjs/core';
import { IMiddleware, Context } from 'egg';

@Middleware()
export class AllMiddleware implements IMiddleware {
  resolve() {
    return async (ctx: Context<any>, next: () => Promise<any>) => {
      ctx.set('Content-Type', 'application/json; charset=utf-8');
      const isWechatPayNotify = ctx.path.startsWith('/api/pay/wechat/notify/');
      try {
        const result = await next();
        if (isWechatPayNotify) {
          return (ctx.body = result);
        }
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
        const status =
          Number(e?.status || e?.statusCode) ||
          (e?.name === 'BusinessError' ? 400 : 500);
        ctx.status = status;
        const message =
          status >= 500 ? '服务器内部错误' : e?.message || '请求失败';
        if (isWechatPayNotify) {
          ctx.status = status >= 500 ? status : 500;
          ctx.body = {
            code: 'FAIL',
            message,
          };
          return;
        }
        ctx.body = {
          status,
          message,
        };
      }
    };
  }
}
