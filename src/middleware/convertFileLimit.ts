import { Config, Inject, Middleware } from '@midwayjs/core';
import { Context, IMiddleware } from 'egg';
import { FILE_UPLOAD_ACTION_COUNT_LIMIT } from '../core/limits';
import { UserService } from '../service/UserService';
import { checkFileCountLimit } from './countLimit';

@Middleware()
export class ConvertFileLimitMiddleware implements IMiddleware {
  @Config('limitCheck')
  limitCheck!: boolean;

  @Inject()
  userService!: UserService;
  resolve() {
    return async (ctx: Context<any>, next: () => Promise<any>) => {
      // 全局开关关闭时不做次数校验，直接放行
      if (!this.limitCheck) {
        return next();
      }
      await checkFileCountLimit(
        ctx,
        this.userService,
        FILE_UPLOAD_ACTION_COUNT_LIMIT.convert_file
      );
      await next();
    };
  }
}
