import { Middleware } from '@midwayjs/core';
import { IMiddleware, Context } from 'egg';
import { Stream } from 'stream';

@Middleware()
export class AllMiddleware implements IMiddleware {
  resolve() {
    return async (ctx: Context<any>, next: () => Promise<any>) => {
      const isWechatPayNotify = ctx.path.startsWith('/api/pay/wechat/notify/');
      const isWechatMessagePush = ctx.path === '/api/wx_message';
      if (isWechatMessagePush) {
        ctx.type = 'text/plain';
      } else {
        ctx.set('Content-Type', 'application/json; charset=utf-8');
      }
      try {
        const result = await next();
        if (isWechatMessagePush) {
          return (ctx.body = result);
        }
        if (isWechatPayNotify) {
          return (ctx.body = result);
        }
        if (result instanceof Stream) {
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
        this.logError(ctx, e, status);
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
        if (isWechatMessagePush) {
          ctx.body = message;
          return;
        }
        ctx.body = {
          status,
          message,
        };
      }
    };
  }

  private logError(ctx: Context<any>, error: unknown, status: number) {
    const errorContent =
      error instanceof Error
        ? {
            name: error.name,
            message: error.message,
            status:
              Number((error as any).status || (error as any).statusCode) ||
              status,
            code: (error as any).code,
            stack: error.stack,
          }
        : error;
    const seen = new WeakSet<object>();
    try {
      console.error(
        JSON.stringify(
          {
            error: errorContent,
            request: ctx.request?.body ?? null,
            query: ctx.query ?? {},
          },
          (_key, value) => {
            if (typeof value === 'bigint') {
              return value.toString();
            }
            if (value && typeof value === 'object') {
              if (seen.has(value)) {
                return '[Circular]';
              }
              seen.add(value);
            }
            return value;
          }
        )
      );
    } catch {
      console.error(
        JSON.stringify({
          error: String(errorContent),
          request: String(ctx.request?.body),
          query: String(ctx.query),
        })
      );
    }
  }
}
