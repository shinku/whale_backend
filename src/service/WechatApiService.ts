import { Config, Provide } from '@midwayjs/core';
import axios from 'axios';
import * as crypto from 'crypto';
import { BusinessError } from '../core/errors';
export const APIS = {
  Jscode2session: 'https://api.weixin.qq.com/sns/jscode2session',
};

@Provide()
export class WehchatApiService {
  @Config('weixinMiniProgram')
  config!: {
    appid: string;
    appsecret: string;
  };
  async getBaseUserInfo(token: string) {
    return this.exchangeLoginCode(token);
  }

  async exchangeLoginCode(code: string) {
    if (!code || typeof code !== 'string') {
      throw new BusinessError('微信登录 code 不能为空');
    }
    if (!this.config?.appid || !this.config?.appsecret) {
      throw new BusinessError('微信小程序登录未配置', 503);
    }
    let result;
    try {
      result = await axios.get(APIS.Jscode2session, {
        params: {
          js_code: code,
          appid: this.config.appid,
          secret: this.config.appsecret,
          grant_type: 'authorization_code',
        },
        timeout: 10000,
      });
    } catch {
      throw new BusinessError('微信登录服务暂时不可用', 503);
    }
    const data = result.data || {};
    if (data.errcode || !data.openid || !data.session_key) {
      console.warn('[wechatLogin] login failed', {
        errcode: data.errcode || 'INVALID_RESPONSE',
      });
      throw new BusinessError('微信登录失败，请重试', 401);
    }
    return data;
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
