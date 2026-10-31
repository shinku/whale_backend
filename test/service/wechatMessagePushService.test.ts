import * as crypto from 'crypto';
import { WechatMessagePushService } from '../../src/service/WechatMessagePushService';

const TOKEN = 'message-push-token';
const ENCODING_AES_KEY = 'A'.repeat(43);
const APP_ID = 'wx-message-push-app';

function signature(values: string[]) {
  return crypto
    .createHash('sha1')
    .update([...values].sort().join(''))
    .digest('hex');
}

function encryptMessage(message: Record<string, unknown>, appId = APP_ID) {
  const aesKey = Buffer.from(`${ENCODING_AES_KEY}=`, 'base64');
  const messageBuffer = Buffer.from(JSON.stringify(message), 'utf8');
  const lengthBuffer = Buffer.alloc(4);
  lengthBuffer.writeUInt32BE(messageBuffer.length);
  const plain = Buffer.concat([
    crypto.randomBytes(16),
    lengthBuffer,
    messageBuffer,
    Buffer.from(appId, 'utf8'),
  ]);
  const paddingLength = 32 - (plain.length % 32);
  const padded = Buffer.concat([
    plain,
    Buffer.alloc(paddingLength, paddingLength),
  ]);
  const cipher = crypto.createCipheriv(
    'aes-256-cbc',
    aesKey,
    aesKey.subarray(0, 16)
  );
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(padded), cipher.final()]).toString(
    'base64'
  );
}

function createService() {
  const service = new WechatMessagePushService();
  service.config = {
    token: TOKEN,
    encodingAesKey: ENCODING_AES_KEY,
  };
  service.miniProgramConfig = {
    appid: APP_ID,
  };
  service.eventHandle = {
    handle: jest.fn().mockResolvedValue(undefined),
  } as any;
  return service;
}

describe('WechatMessagePushService URL verification', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-31T05:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('verifies the signature and returns echostr unchanged', () => {
    const service = createService();
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = 'nonce-1';

    const result = service.verifyUrl({
      signature: signature([TOKEN, timestamp, nonce]),
      timestamp,
      nonce,
      echostr: 'echo-value',
    });

    expect(result).toBe('echo-value');
  });

  it('rejects an invalid URL signature', () => {
    const service = createService();
    const timestamp = String(Math.floor(Date.now() / 1000));

    expect(() =>
      service.verifyUrl({
        signature: 'bad-signature',
        timestamp,
        nonce: 'nonce-1',
        echostr: 'echo-value',
      })
    ).toThrow('消息推送 URL 验签失败');
  });

  it('rejects a stale timestamp', () => {
    const service = createService();
    const timestamp = String(Math.floor(Date.now() / 1000) - 301);

    expect(() =>
      service.verifyUrl({
        signature: signature([TOKEN, timestamp, 'nonce-1']),
        timestamp,
        nonce: 'nonce-1',
        echostr: 'echo-value',
      })
    ).toThrow('消息推送 timestamp 已过期');
  });
});

describe('WechatMessagePushService secure messages', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-31T05:00:00.000Z'));
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('verifies, decrypts and dispatches a secure JSON message', async () => {
    const service = createService();
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = 'nonce-2';
    const event = {
      ToUserName: 'gh_test',
      FromUserName: 'openid-1',
      MsgType: 'event',
      Event: 'xpay_goods_deliver_notify',
      OutTradeNo: 'VP_ORDER_1',
    };
    const encrypt = encryptMessage(event);

    const result = await service.handleMessage(
      {
        timestamp,
        nonce,
        encrypt_type: 'aes',
        msg_signature: signature([TOKEN, timestamp, nonce, encrypt]),
      },
      { Encrypt: encrypt }
    );

    expect(result).toEqual(event);
    expect(service.eventHandle.handle).toHaveBeenCalledWith(event);
  });

  it('decrypts the secure message from the WeChat documentation', async () => {
    const service = createService();
    service.config.token = 'AAAAA';
    service.config.encodingAesKey = 'A'.repeat(43);
    service.miniProgramConfig.appid = 'wxba5fad812f8e6fb9';
    const timestamp = '1714112445';
    jest.setSystemTime(Number(timestamp) * 1000);
    const nonce = '415670741';
    const encrypt =
      '+qdx1OKCy+5JPCBFWw70tm0fJGb2Jmeia4FCB7kao+/Q5c/ohsOzQHi8khUOb05JCpj0JB4RvQMkUyus8TPxLKJGQqcvZqzDpVzazhZv6JsXUnnR8XGT740XgXZUXQ7vJVnAG+tE8NUd4yFyjPy7GgiaviNrlCTj+l5kdfMuFUPpRSrfMZuMcp3Fn2Pede2IuQrKEYwKSqFIZoNqJ4M8EajAsjLY2km32IIjdf8YL/P50F7mStwntrA2cPDrM1kb6mOcfBgRtWygb3VIYnSeOBrebufAlr7F9mFUPAJGj04=';

    const result = await service.handleMessage(
      {
        timestamp,
        nonce,
        encrypt_type: 'aes',
        msg_signature: signature(['AAAAA', timestamp, nonce, encrypt]),
      },
      { Encrypt: encrypt }
    );

    expect(result).toEqual(
      expect.objectContaining({
        MsgType: 'event',
        Event: 'debug_demo',
        debug_str: 'hello world',
      })
    );
  });

  it('rejects a secure message with an invalid msg_signature', async () => {
    const service = createService();
    const timestamp = String(Math.floor(Date.now() / 1000));
    const encrypt = encryptMessage({ Event: 'debug_demo' });

    await expect(
      service.handleMessage(
        {
          timestamp,
          nonce: 'nonce-2',
          encrypt_type: 'aes',
          msg_signature: 'bad-signature',
        },
        { Encrypt: encrypt }
      )
    ).rejects.toThrow('消息推送消息体验签失败');
  });

  it('rejects a decrypted message with the wrong AppID', async () => {
    const service = createService();
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = 'nonce-2';
    const encrypt = encryptMessage({ Event: 'debug_demo' }, 'wx-wrong-app');

    await expect(
      service.handleMessage(
        {
          timestamp,
          nonce,
          encrypt_type: 'aes',
          msg_signature: signature([TOKEN, timestamp, nonce, encrypt]),
        },
        { Encrypt: encrypt }
      )
    ).rejects.toThrow('消息推送 AppID 校验失败');
  });

  it('rejects secure messages when EncodingAESKey is missing', async () => {
    const service = createService();
    service.config.encodingAesKey = '';

    await expect(
      service.handleMessage(
        {
          timestamp: String(Math.floor(Date.now() / 1000)),
          nonce: 'nonce-2',
          encrypt_type: 'aes',
          msg_signature: 'signature',
        },
        { Encrypt: 'encrypted' }
      )
    ).rejects.toThrow('消息推送 EncodingAESKey 未配置');
  });

  it('supports plaintext mode after ordinary signature verification', async () => {
    const service = createService();
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = 'nonce-3';
    const body = {
      MsgType: 'event',
      Event: 'debug_demo',
    };

    const result = await service.handleMessage(
      {
        timestamp,
        nonce,
        signature: signature([TOKEN, timestamp, nonce]),
      },
      body
    );

    expect(result).toEqual(body);
  });

  it('rejects messages when Token is missing', async () => {
    const service = createService();
    service.config.token = '';

    await expect(
      service.handleMessage(
        {
          timestamp: String(Math.floor(Date.now() / 1000)),
          nonce: 'nonce',
        },
        {}
      )
    ).rejects.toThrow('消息推送 Token 未配置');
  });
});
