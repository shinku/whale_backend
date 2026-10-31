import { Config, Inject, Provide } from '@midwayjs/core';
import * as crypto from 'crypto';
import { BusinessError } from '../core/errors';
import { WechatEventHandle } from './eventHandler/WechatEventHandle';

interface MessagePushConfig {
  token: string;
  encodingAesKey: string;
}

interface MiniProgramConfig {
  appid: string;
}

export interface MessagePushQuery {
  signature?: string;
  timestamp?: string;
  nonce?: string;
  echostr?: string;
  encrypt_type?: string;
  msg_signature?: string;
}

const MAX_TIMESTAMP_DRIFT_SECONDS = 5 * 60;

@Provide()
export class WechatMessagePushService {
  @Config('wechatMessagePush')
  config!: MessagePushConfig;

  @Config('weixinMiniProgram')
  miniProgramConfig!: MiniProgramConfig;

  @Inject()
  eventHandle!: WechatEventHandle;

  verifyUrl(query: MessagePushQuery) {
    this.assertConfigured(false);
    const timestamp = this.assertTimestamp(query.timestamp);
    const nonce = this.requireString(query.nonce, 'nonce');
    const echostr = this.requireString(query.echostr, 'echostr');
    const signature = this.requireString(query.signature, 'signature');
    this.assertSignature(
      [this.config.token, timestamp.raw, nonce],
      signature,
      '消息推送 URL 验签失败'
    );
    return echostr;
  }

  async handleMessage(query: MessagePushQuery, body: Record<string, any>) {
    this.assertConfigured(false);
    const timestamp = this.assertTimestamp(query.timestamp);
    const nonce = this.requireString(query.nonce, 'nonce');
    let message: Record<string, any>;
    if (query.encrypt_type === 'aes' || body?.Encrypt) {
      message = this.decryptSecureMessage(query, body, timestamp.raw, nonce);
    } else {
      const signature = this.requireString(query.signature, 'signature');
      this.assertSignature(
        [this.config.token, timestamp.raw, nonce],
        signature,
        '消息推送验签失败'
      );
      message = body;
    }
    await this.eventHandle.handle(message);
    return message;
  }

  private decryptSecureMessage(
    query: MessagePushQuery,
    body: Record<string, any>,
    timestamp: string,
    nonce: string
  ) {
    this.assertConfigured(true);
    const encrypt = this.requireString(body.Encrypt, 'Encrypt');
    const msgSignature = this.requireString(
      query.msg_signature,
      'msg_signature'
    );
    this.assertSignature(
      [this.config.token, timestamp, nonce, encrypt],
      msgSignature,
      '消息推送消息体验签失败'
    );

    const aesKey = Buffer.from(`${this.config.encodingAesKey}=`, 'base64');
    if (aesKey.length !== 32) {
      throw new BusinessError('消息推送 EncodingAESKey 配置错误', 503);
    }
    let decrypted: Buffer;
    try {
      const decipher = crypto.createDecipheriv(
        'aes-256-cbc',
        aesKey,
        aesKey.subarray(0, 16)
      );
      // WeChat pads to a 32-byte block, while Node's automatic padding uses
      // the AES block size of 16 bytes. Remove WeChat's padding ourselves.
      decipher.setAutoPadding(false);
      decrypted = Buffer.concat([
        decipher.update(Buffer.from(encrypt, 'base64')),
        decipher.final(),
      ]);
      const paddingLength = decrypted[decrypted.length - 1];
      if (
        !paddingLength ||
        paddingLength > 32 ||
        paddingLength > decrypted.length ||
        !decrypted
          .subarray(decrypted.length - paddingLength)
          .every(value => value === paddingLength)
      ) {
        throw new Error('Invalid WeChat PKCS#7 padding');
      }
      decrypted = decrypted.subarray(0, decrypted.length - paddingLength);
    } catch {
      throw new BusinessError('消息推送消息体解密失败', 400);
    }
    if (decrypted.length < 20) {
      throw new BusinessError('消息推送消息体格式错误', 400);
    }

    const messageLength = decrypted.readUInt32BE(16);
    if (messageLength > decrypted.length - 20) {
      throw new BusinessError('消息推送消息体长度错误', 400);
    }
    const message = decrypted.subarray(20, 20 + messageLength).toString('utf8');
    const appId = decrypted.subarray(20 + messageLength).toString('utf8');
    if (
      !this.miniProgramConfig.appid ||
      appId !== this.miniProgramConfig.appid
    ) {
      throw new BusinessError('消息推送 AppID 校验失败', 401);
    }
    try {
      return JSON.parse(message);
    } catch {
      throw new BusinessError('消息推送 JSON 格式错误', 400);
    }
  }

  private assertSignature(values: string[], expected: string, message: string) {
    const actual = crypto
      .createHash('sha1')
      .update([...values].sort().join(''))
      .digest('hex');
    const actualBuffer = Buffer.from(actual, 'utf8');
    const expectedBuffer = Buffer.from(expected, 'utf8');
    if (
      actualBuffer.length !== expectedBuffer.length ||
      !crypto.timingSafeEqual(actualBuffer, expectedBuffer)
    ) {
      throw new BusinessError(message, 401);
    }
  }

  private assertTimestamp(value: string | undefined) {
    const raw = this.requireString(value, 'timestamp');
    if (!/^\d+$/.test(raw)) {
      throw new BusinessError('消息推送 timestamp 无效', 400);
    }
    const timestamp = Number(raw);
    if (
      !Number.isSafeInteger(timestamp) ||
      Math.abs(Math.floor(Date.now() / 1000) - timestamp) >
        MAX_TIMESTAMP_DRIFT_SECONDS
    ) {
      throw new BusinessError('消息推送 timestamp 已过期', 401);
    }
    return { raw, value: timestamp };
  }

  private requireString(value: unknown, field: string) {
    if (typeof value !== 'string' || value.length === 0) {
      throw new BusinessError(`消息推送缺少 ${field}`, 400);
    }
    return value;
  }

  private assertConfigured(requireAesKey: boolean) {
    if (!this.config?.token) {
      throw new BusinessError('消息推送 Token 未配置', 503);
    }
    if (
      requireAesKey &&
      (!this.config.encodingAesKey || this.config.encodingAesKey.length !== 43)
    ) {
      throw new BusinessError('消息推送 EncodingAESKey 未配置', 503);
    }
  }
}
