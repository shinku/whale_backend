import { Inject, Post, Provide } from '@midwayjs/core';
import { Context } from 'egg';
import { Readable } from 'stream';
import { LANE } from '../core/enums';
import { BusinessError } from '../core/errors';
import {
  LearningAgentService,
  validateLearningAgentInput,
} from '../service/LearningAgentService';
import { UserService } from '../service/UserService';
import Api from './api/Api';

@Provide()
@Api('/ai/agent')
export class AiAgentController {
  @Inject()
  ctx!: Context;

  @Inject()
  learningAgentService!: LearningAgentService;

  @Inject()
  userService!: UserService;

  @Post('/chat')
  async chat() {
    const openid = this.ctx.get('x-user-id');
    if (!openid) {
      throw new BusinessError('请先登录', 401, 'AUTH_REQUIRED');
    }
    const input = validateLearningAgentInput(this.ctx.request.body || {});
    const lane =
      String(this.ctx.get('x-lane') || LANE.WHALE)
        .trim()
        .slice(0, 32) || LANE.WHALE;
    const profile = await this.userService.requireAgentProfile(openid, lane);
    const session = ((this.ctx as any).session ||= {});
    const existing =
      typeof session.user_orinted === 'string'
        ? session.user_orinted.slice(0, 500)
        : '';
    const userOrinted = await this.learningAgentService.prepareUserOrinted(
      input,
      existing
    );
    session.user_orinted = userOrinted;
    console.log({
      userOrinted: this.ctx.session
    })
    this.ctx.status = 200;
    this.ctx.type = 'text/event-stream; charset=utf-8';
    this.ctx.set('Cache-Control', 'no-cache, no-transform');
    this.ctx.set('Connection', 'keep-alive');
    this.ctx.set('X-Accel-Buffering', 'no');
    return Readable.from(
      this.learningAgentService.streamChat(input, profile, userOrinted)
    );
  }
}
