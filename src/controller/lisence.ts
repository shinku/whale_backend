import { Config, Get, Inject, Provide } from '@midwayjs/core';
import Api from './api/Api';
import {
  ImageService,
  TEXTIN_PACKAGE_API_PATHS,
  TIPackageSummary,
} from '../service/ImageService';

@Api('/lisence')
@Provide()
export class LisenceController {
  @Config('textin')
  textinConfig!: {
    'x-ti-app-id': string;
    'x-ti-secret-code': string;
  };

  @Inject()
  imageService!: ImageService;

  /**
   * 获取合合接口的剩余费用
   * GET https://api.textin.com/user/finance/balance
   * GET https://api.textin.com/user/finance/package?api_path=xxx
   * @returns
   */
  @Get('/hehe')
  async getHeheLisence() {
    const [balance, packages] = await Promise.all([
      this.imageService.getAccountBalance(),
      this.getPackageQuotas(),
    ]);
    return {
      code: 0,
      data: {
        // 账户总余额
        balance: balance.balance,
        // 可用 T 币余额
        available_balance: balance.available_balance,
        // 各功能的套餐余量
        packages,
        // 兼容旧字段：启动时注入的环境变量
        lisence: process.env.LISENCE,
      },
    };
  }

  /**
   * 逐个查询各功能的套餐余量，单个功能查询失败不影响其它功能
   */
  private async getPackageQuotas() {
    const result: Record<string, TIPackageSummary | { error: string }> = {};
    await Promise.all(
      Object.keys(TEXTIN_PACKAGE_API_PATHS).map(async name => {
        try {
          result[name] = await this.imageService.getPackageSummary(
            TEXTIN_PACKAGE_API_PATHS[name as keyof typeof TEXTIN_PACKAGE_API_PATHS]
          );
        } catch (err) {
          result[name] = { error: (err as Error).message };
        }
      })
    );
    return result;
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
