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
    const type = this.ctx.query.type;
    const { offset = '0', limit = '10' } = this.ctx.query;
    const option: any = {
      where: {
        status,
        lane,
      },
      limit: Number(limit),
      offset: Number(offset),
    };
    if (type) {
      option.where.type = type;
    }
    const count = await BannerModel.count(option);
    const result = await BannerModel.findAll(option);
    return {
      data: {
        count,
        list: result,
      },
    };
  }

  /**
   * 更新banner
   * 状态变更 active/deactive
   * @returns
   */
  @Put('/')
  async updateBanner() {
    const { id, status, banner_image, action, name, type } =
      this.ctx.request.body;
    const updateOption = {
      status,
      banner_image,
      action,
      name,
      type,
    };
    if (!id) {
      throw new Error('id_is_required');
    }
    Object.keys(updateOption).forEach(key => {
      if (updateOption[key] === undefined) {
        delete updateOption[key];
      }
    });
    await BannerModel.update(updateOption, {
      where: {
        id,
      },
    });
    return {
      data: 'done',
    };
  }

  /**
   * 增加banner位置
   */
  @Post('/')
  async addBanner() {
    const {
      banner_image,
      action,
      lane,
      name,
      type,
      status = 'active',
    } = this.ctx.request.body;
    if (!banner_image && !action) {
      throw new Error('banner_image_or_action_is_required');
    }
    await BannerModel.create({
      banner_image,
      action,
      lane: lane || 'whale',
      status,
      name,
      type,
    });
    return {
      data: 'done',
    };
  }
}
