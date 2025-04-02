import { Config, Get, Provide } from '@midwayjs/core';
import Api from './api/Api';

@Api('/lisence')
@Provide()
export class LisenceController {
  @Config('textin')
  textinConfig: {
    'x-ti-app-id': string;
    'x-ti-secret-code': string;
  };

  /**
   * 获取合合接口的剩余权限
   * @returns
   */
  @Get('/hehe')
  async getHeheLisence() {
    return {
      code: 0,
      data: {
        lisence: process.env.LISENCE,
      },
    };
  }

  /**
   *
   * @returns
   */
  @Get('/deepseek')
  async getDeepSeekLisence() {
    return {
      code: 0,
      data: {
        lisence: process.env.DEEPLICENSE,
      },
    };
  }
}
