import { Middleware } from '@midwayjs/core';
import { Context, IMiddleware } from 'egg';
import { LANE } from '../core/enums';
import { UserRecordModel } from '../model/UserRecord';

/**
 * 从文件操作的执行结果中提取产物路径。
 * 兼容控制器原始字符串，以及全局响应包装后的 data / file 字段。
 */
export function getRecordFile(result: any): string | undefined {
  const value =
    typeof result === 'string' ? result : result?.data ?? result?.file;
  return typeof value === 'string' && value.trim() ? value : undefined;
}

@Middleware()
export class FileRecordMiddleware implements IMiddleware {
  resolve() {
    return async (ctx: Context<any>, next: () => Promise<any>) => {
      const result = await next();
      const userId = ctx.get('x-user-id');
      const file = getRecordFile(result);
      if (!userId || !file) {
        return result;
      }

      const lane =
        (ctx as any).fields?.lane ||
        ctx.request.body?.lane ||
        ctx.query?.lane ||
        LANE.WHALE;
      /**
       * 文件记录属于接口成功后的附属操作，不阻塞文件转换结果返回。
       * 这里使用 fire-and-forget 方式执行，并通过 catch 处理异步写入失败，
       * 避免数据库异常产生未处理的 Promise rejection 或影响接口响应。
       */
      void UserRecordModel.create({
        image_url_after: file,
        user_id: userId,
        image_url_before: '',
        lane,
      }).catch(error => {
        console.error('[FileRecordMiddleware] save user record failed', error);
      });
      return result;
    };
  }
}
