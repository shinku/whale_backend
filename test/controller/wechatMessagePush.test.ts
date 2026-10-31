import { createApp, close, createHttpRequest } from '@midwayjs/mock';
import { Framework } from '@midwayjs/web';
import { Application } from 'egg';
import * as crypto from 'crypto';

describe('GET /api/wx_message', () => {
  let app: Application;

  beforeAll(async () => {
    app = await createApp<Framework>();
  });

  afterAll(async () => {
    await close(app);
  });

  it('returns echostr as plain text after URL verification', async () => {
    const token = 'whalepea_wx_message';
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = 'verify-nonce';
    const echostr = 'wx-verify-ok';
    const signature = crypto
      .createHash('sha1')
      .update([token, timestamp, nonce].sort().join(''))
      .digest('hex');

    const result = await createHttpRequest(app)
      .get('/api/wx_message')
      .query({ signature, timestamp, nonce, echostr });

    expect(result.status).toBe(200);
    expect(result.headers['content-type']).toContain('text/plain');
    expect(result.text).toBe(echostr);
  });
});
