import { Get, Inject, Post, Provide, Put } from '@midwayjs/core';
import { randomUUID } from 'crypto';
import { Context } from 'egg';

import { Op } from 'sequelize';
import { AppOperateModel } from '../../model/AppOperate';
import { ObjectNonNull } from '../../utils';
import { AdminApi } from '../api/Api';
const moment = require('moment');
/**
 * 运营接口用于管理运营事宜，主要为日常活动
 * 配置项为 {
 *  icon: // 活动入口的icon
 *  target: // webview/page/miniapp 默认为3种，webview/page/miniapp 。webview为通过webview打开一个url，page为打开当小程序的某个page, miniapp 为打开其他小程序
 * }
 */
/**
 * 运营
 */
@AdminApi('/operator')
@Provide()
export class Operator {
  @Inject()
  ctx: Context;

  @Get('/')
  /**
   * 获取运维数据列表
   */
  async getOperatorList() {
    const lane = this.ctx.request.query.lane || 'whale';
    const { offset = '0', limit = '10' } = this.ctx.request.query;
    const whereOption = {
      lane,
      available_start: {
        [Op.lte]: moment(Date.now()).format('YYYY-MM-DD HH:mm:ss'),
      },
      [Op.or]: [
        {
          available_end: {
            [Op.gte]: moment(Date.now()).format('YYYY-MM-DD HH:mm:ss'),
          },
        },
        {
          available_end: {
            [Op.is]: null,
          },
        },
      ],
    };
    console.log({ whereOption });
    const count = await AppOperateModel.count({
      where: whereOption,
    });
    const res = await AppOperateModel.findAll({
      attributes: ['icon', 'name', 'config'],
      where: {
        ...whereOption,
      },
      limit: Number(limit),
      offset: Number(offset),
      raw: true,
    });
    console.log({ res });
    return {
      data: {
        count,
        list: res,
      },
    };
  }
  @Post('/')
  /**
   * 新增运维数据
   */
  async addOperator() {
    const { icon, name, available_start, available_end, config } =
      this.ctx.request.body;
    if (![icon, name, available_start, config].every(val => !!val)) {
      throw new Error('lack_of_params_necessary');
    }
    const oId = randomUUID();
    await AppOperateModel.create({
      operator_id: oId,
      icon,
      name,
      available_start,
      config,
      available_end,
    });
    return oId;
  }

  @Put('/:oId')
  /**
   * 更新运维数据
   */
  async setOperator() {
    const { icon, name, available_start, available_end, config } =
      this.ctx.request.body;
    const { oId } = this.ctx.params;
    if (!oId) {
      throw new Error('oId_is_required');
    }
    const record = await AppOperateModel.findOne({
      where: {
        operator_id: oId,
      },
    });
    if (!record) {
      throw new Error('oId_not_existed');
    }
    // 更新AppOperateModel
    await AppOperateModel.update(
      {
        ...ObjectNonNull({
          icon,
          name,
          available_start,
          available_end,
          config,
        }),
      },
      {
        where: {
          operator_id: oId,
        },
      }
    );
    return 'done';
  }
}
