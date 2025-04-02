import { Get, Inject, Provide } from '@midwayjs/core';
import { Context } from 'egg';
import { UserModel } from '../../model/UserModel';
import { AdminApi } from '../api/Api';

@AdminApi('/user')
@Provide()
export class UserController {
  @Inject()
  ctx: Context;

  @Get('/')
  async getUsers() {
    const { limit = '20', offset = '0' } = this.ctx.query;
    const option = {};
    const count = await UserModel.count({
      where: option,
    });
    const users = await UserModel.findAll({
      attributes: [
        'user_name',
        'user_mobile',
        'user_avator',
        'user_id',
        'lane',
      ],
      where: option,
      limit: Number(limit),
      offset: Number(offset),
      raw: true,
    });
    return {
      count,
      list: users,
    };
  }

  @Get('/:userid')
  async delUser() {
    const { userid } = this.ctx.params;
    const userInfos = await UserModel.findAll({
      attributes: ['user_id', 'lane'],
      where: {
        user_id: userid,
      },
    });
    return {
      list: userInfos,
    };
  }
}
