import { Context } from 'egg';
import { LANE } from '../core/enums';
import { TUserCountLimitField } from '../core/limits';
import { UserService } from '../service/user';

/**
 * countlimit 预检查的公共逻辑，由各个 POST 的独立中间件调用
 */
export const checkFileCountLimit = async (
  ctx: Context,
  userService: UserService,
  limitField: TUserCountLimitField
) => {
  if (ctx.method.toUpperCase() !== 'POST') {
    return;
  }
  const userId = ctx.get('x-user-id');
  if (!userId) {
    throw new Error('userId is required');
  }
  const lane =
    (ctx as any).fields?.lane ||
    ctx.request.body?.lane ||
    ctx.query.lane ||
    LANE.WHALE;
  await userService.assertCountLimitAvailable(userId, lane, limitField);
};
