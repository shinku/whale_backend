import { Get, Inject, Provide, Put } from '@midwayjs/core';
import { Context } from 'egg';
import { LANE } from '../core/enums';
import { UserModel } from '../model/UserModel';
import { WehchatApiService } from '../service/WechatApiService';
import Api from './api/Api';

@Api('', ['checkUserLoginMiddleware'])
@Provide()
export class user {
  @Inject()
  ctx: Context;

  @Inject()
  wechatService: WehchatApiService;

  @Get('/user/:token')
  async getUserInfo() {
    const lane = this.ctx.lane || LANE.WHALE;
    const token = this.ctx.params.token;
    // 通过微信api获取基本信息
    const baseInfo = await this.wechatService.getBaseUserInfo(token);
    const { openid } = baseInfo;
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
      //  where: { token, lane, openid: '' },
    });
    return {
      data: record.dataValues,
    };
  }

  @Put('/user/agree_first_deal/:deal')
  async setUserInfo() {
    const { userId } = this.ctx;
    console.log(userId);
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
}
