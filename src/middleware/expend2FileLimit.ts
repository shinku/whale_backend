import { Inject, Middleware } from '@midwayjs/core';
import { Context, IMiddleware } from 'egg';
import { FILE_EXPEND_2_FILE_COUNT_LIMIT } from '../core/limits';
import { UserService } from '../service/user';
import { checkFileCountLimit } from './countLimit';

@Middleware()
export class Expend2FileLimitMiddleware implements IMiddleware {
  @Inject()
  userService!: UserService;

  resolve() {
    return async (ctx: Context<any>, next: () => Promise<any>) => {
      await checkFileCountLimit(
        ctx,
        this.userService,
        FILE_EXPEND_2_FILE_COUNT_LIMIT
      );
      await next();
    };
  }
}
