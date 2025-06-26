import { Config, Provide } from '@midwayjs/core';
import axios from 'axios';
import * as crypto from 'crypto';
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

  async decryptPhoneNumber(sessionKey, encryptedData, iv) {
    sessionKey = Buffer.from(sessionKey, 'base64');
    encryptedData = Buffer.from(encryptedData, 'base64');
    iv = Buffer.from(iv, 'base64');

    try {
      const decipher = crypto.createDecipheriv('aes-128-cbc', sessionKey, iv);
      decipher.setAutoPadding(true);
      let decoded = decipher.update(encryptedData, 'binary', 'utf8');
      decoded += decipher.final('utf8');

      const result = JSON.parse(decoded);
      return result.purePhoneNumber || result.phoneNumber;
    } catch (err) {
      throw new Error('解密失败');
    }
  }
}
