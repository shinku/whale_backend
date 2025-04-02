import { Get, Inject, Provide } from '@midwayjs/core';
import { Context } from 'egg';
import { LANE } from '../core/enums';
import { UserModel } from '../model/UserModel';
import Api from './api/Api';

@Api()
@Provide()
export class user {
  @Inject()
  ctx: Context;
  @Get('/user/:token')
  async getUserInfo() {
    const lane = this.ctx.lane || LANE.WHALE;
    const info = await UserModel.findOne({
      where: {
        user_id: 'shingu.gu',
        lane,
      },
    });
    console.log({
      info,
    });
    return 'hello shin' + this.ctx.params.token;
  }
}
