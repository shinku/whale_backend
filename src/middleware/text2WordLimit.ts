import { Inject, Middleware } from '@midwayjs/core';
import { Context, IMiddleware } from 'egg';
import { FILE_TEXT_2_WORD_COUNT_LIMIT } from '../core/limits';
import { UserService } from '../service/UserService';
import { checkFileCountLimit } from './countLimit';

@Middleware()
export class Text2WordLimitMiddleware implements IMiddleware {
  @Inject()
  userService!: UserService;

  resolve() {
    return async (ctx: Context<any>, next: () => Promise<any>) => {
      await checkFileCountLimit(
        ctx,
        this.userService,
        FILE_TEXT_2_WORD_COUNT_LIMIT
      );
      await next();
    };
  }
}
