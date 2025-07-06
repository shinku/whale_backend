import { Get, Inject, Post, Provide, Put } from '@midwayjs/core';
import { Context } from 'egg';
import { LANE } from '../core/enums';
import { UserFeedBack } from '../model/UserFeedBack';
import { UserModel } from '../model/UserModel';
import { PointService } from '../service/PointService';
import { VipService } from '../service/VipService';
import { WehchatApiService } from '../service/WechatApiService';
import Api from './api/Api';

@Api('', ['checkUserLoginMiddleware'])
@Provide()
export class user {
  @Inject()
  ctx: Context;

  @Inject()
  wechatService: WehchatApiService;

  @Inject()
  pointerService: PointService;

  @Inject()
  vipService: VipService;

  @Get('/user/:token')
  async getUserInfo() {
    const lane = this.ctx.lane || LANE.WHALE;
    const token = this.ctx.params.token;
    console.log('token', token);
    // 通过微信api获取基本信息
    const baseInfo = await this.wechatService.getBaseUserInfo(token);
    const { openid, session_key } = baseInfo;
    const test = await UserModel.sequelize.query('select * from user');
    console.log('test', test);
    const [record] = await UserModel.findOrCreate<UserModel>({
      attributes: [
        'openid',
        'user_avator',
        'user_mobile',
        'user_name',
        'lane',
        'agree_first_deal',
      ],
      where: {
        lane,
        openid,
      },
      raw: true,
      //  where: { token, lane, openid: '' },
    });
    const amount = await this.pointerService.userInitialization(openid);
    const vipInfo = await this.vipService.userVipInitializatin(openid);
    // 判断当前用户是否有积分记录，如果没有，则表示第一次注册，会根据一定规则赠送部分积分
    return {
      data: {
        ...record,
        ...vipInfo,
        amount,
        session_key,
      },
    };
  }

  @Put('/user/')
  async updateUserInfo() {
    const { userId } = this.ctx;
    const { avator_url, user_name, user_mobile } = this.ctx.request.body;
    const record = await UserModel.findOne({
      where: {
        openid: userId,
      },
    });
    if (!record) {
      throw new Error('user_not_existed');
    }
    if (avator_url) {
      record.user_avator = avator_url;
    }
    if (user_name) {
      record.user_name = user_name;
    }
    if (user_mobile) {
      record.user_mobile = user_mobile;
    }
    await record.save();
    return 'done';
  }

  @Put('/user/agree_first_deal/:deal')
  async setUserInfo() {
    const { userId } = this.ctx;
    const { deal } = this.ctx.params;
    const record = await UserModel.findOne({
      where: {
        openid: userId,
      },
    });
    if (!record) {
      throw new Error('no_record_found');
    }
    if (!['agree', 'reject'].includes(deal)) {
      throw new Error('deal_is_not_accepted');
    }
    const agreeFirstDeal = {
      agree: 1,
      reject: 0,
    };
    record.agree_first_deal = agreeFirstDeal[deal];
    await record.save();
    return 'done';
  }

  @Post('/user/feed_back')
  async addFeedBack() {
    const { message } = this.ctx.request.body;
    if (!message) {
      throw new Error('message_required');
    }
    const { userId } = this.ctx;
    const lane = this.ctx.lane || LANE.WHALE;
    await UserFeedBack.create({
      message,
      user_id: userId,
      lane,
    });
    return 'done';
  }

  /**
   *
   * @returns 修改积分
   */
  @Put('/user/point')
  async setPointForUser() {
    const { point, action = 'increase' } = this.ctx.request.body;
    const { userId } = this.ctx;
    if (!point) {
      throw new Error('need_point');
    }
    return await this.pointerService.modifyPoint(userId, point, action);
  }
}
