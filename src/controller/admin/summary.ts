import { Get, Inject, Provide } from '@midwayjs/core';
import { Context } from 'egg';
import { QueryTypes } from 'sequelize';
import { UserModel } from '../../model/UserModel';
import { AdminApi } from '../api/Api';

@AdminApi('/summary')
@Provide()
export class summary {
  @Inject()
  ctx: Context;

  @Get('/users_record')
  async userRecord() {
    const { limit = 10, offset = 0 } = this.ctx.query;
    const sql = `select count(openid) as record_count,openid,u_name,max(last_used) as last_used,min(last_used) as first_used  from 
    (select user.openid as openid,user.user_name as u_name,uc.updatedAt as last_used from user 
    inner join user_record_cleanpaper_image as uc
    on user.openid = uc.user_id) as r1
    group by r1.openid,r1.u_name order by last_used limit ${limit} offset ${offset}
    `;
    const list = await UserModel.sequelize.query(sql, {
      type: QueryTypes.SELECT,
      raw: true,
    });
    return {
      data: list,
    };
  }

  @Get('/users')
  async users() {
    const { limit = 10, offset = 0 } = this.ctx.query;
    const data = await UserModel.findAndCountAll({
      attributes: ['openid', 'user_name', 'createdAt'],
      order: [['createdAt', 'DESC']],
      limit: Number(limit),
      offset: Number(offset),
      raw: true,
    });
    return { data };
  }
}
