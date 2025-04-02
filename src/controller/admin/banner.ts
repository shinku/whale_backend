import { Get, Inject, Post, Provide, Put } from '@midwayjs/core';
import { Context } from 'egg';
import { BannerModel } from '../../model/BannerModel';
import { AdminApi } from '../api/Api';

@AdminApi('/banner')
@Provide()
export class BannerController {
  @Inject()
  ctx: Context;

  /**
   * 获取banner数据
   * @returns
   */
  @Get('/')
  async getBanner() {
    const lane = this.ctx.query.lane || 'whale';
    const status = this.ctx.query.status || 'active';
    return await BannerModel.findAll({
      where: {
        status,
        lane,
      },
    });
  }

  /**
   * 更新banner
   * 状态变更 active/deactive
   * @returns
   */
  @Put('/')
  async updateBanner() {
    const { id, status, banner_image, action } = this.ctx.request.body;
    const updateOption = {
      status,
      banner_image,
      action,
    };
    if (!id) {
      throw new Error('id_is_required');
    }
    Object.keys(updateOption).forEach(key => {
      if (updateOption[key] === undefined) {
        delete updateOption[key];
      }
    });
    return await BannerModel.update(updateOption, {
      where: {
        id,
      },
    });
  }

  /**
   * 增加banner位置
   */
  @Post('/')
  async addBanner() {
    const { banner_image, action, lane } = this.ctx.request.body;
    if (!banner_image && !action) {
      throw new Error('banner_image_or_action_is_required');
    }
    await BannerModel.create({
      banner_image,
      action,
      lane: lane || 'whale',
    });
  }
}
