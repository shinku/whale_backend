import { Inject, Middleware } from '@midwayjs/core';
import { Context, IMiddleware } from 'egg';
import { FILE_UPLOAD_ACTION_COUNT_LIMIT } from '../core/limits';
import { UserService } from '../service/UserService';
import { checkFileCountLimit } from './countLimit';

@Middleware()
export class ClearHandsWriteLimitMiddleware implements IMiddleware {
  @Inject()
  userService!: UserService;

  resolve() {
    return async (ctx: Context<any>, next: () => Promise<any>) => {
      await checkFileCountLimit(
        ctx,
        this.userService,
        FILE_UPLOAD_ACTION_COUNT_LIMIT.clear_hands_write
      );
      await next();
    };
  }
}
