import { Config, Inject, Middleware } from '@midwayjs/core';
import { Context, IMiddleware } from 'egg';
import { FILE_ERROR_COLLECT_COUNT_LIMIT } from '../core/limits';
import { UserService } from '../service/UserService';
import { checkFileCountLimit } from './countLimit';

@Middleware()
export class ErrorCollectLimitMiddleware implements IMiddleware {
  @Config('limitCheck')
  limitCheck!: boolean;

  @Inject()
  userService!: UserService;

  resolve() {
    return async (ctx: Context<any>, next: () => Promise<any>) => {
      if (!this.limitCheck) {
        return next();
      }
      await checkFileCountLimit(
        ctx,
        this.userService,
        FILE_ERROR_COLLECT_COUNT_LIMIT
      );
      await next();
    };
  }
}
