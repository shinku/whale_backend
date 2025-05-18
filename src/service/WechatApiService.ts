import { Config, Provide } from '@midwayjs/core';
import axios from 'axios';

export const APIS = {
  Jscode2session: 'https://api.weixin.qq.com/sns/jscode2session',
};

@Provide()
export class WehchatApiService {
  @Config('weixinMiniProgram')
  config: {
    appid: string;
    appsecret: string;
  };
  async getBaseUserInfo(token: string) {
    const result = await axios.get(
      `${APIS.Jscode2session}?js_code=${token}&appid=${this.config.appid}&secret=${this.config.appsecret}&grant_type=authorization_code`
    );
    return result.data;
  }
}
