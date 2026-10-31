import { BusinessError } from '../../src/core/errors';
import { WechatMessagePushController } from '../../src/controller/wechatMessagePush';
import { AllMiddleware } from '../../src/middleware/all';

describe('WechatMessagePushController', () => {
  it('returns echostr and success as raw text', async () => {
    const controller = new WechatMessagePushController();
    controller.ctx = {
      query: { echostr: 'echo-value' },
      request: { body: { Encrypt: 'encrypted' } },
      type: '',
    } as any;
    controller.messagePushService = {
      verifyUrl: jest.fn().mockReturnValue('echo-value'),
      handleMessage: jest.fn().mockReturnValue({ Event: 'debug_demo' }),
    } as any;

    await expect(controller.verifyUrl()).resolves.toBe('echo-value');
    await expect(controller.receiveMessage()).resolves.toBe('success');
    expect(controller.ctx.type).toBe('text/plain');
  });
});

describe('AllMiddleware WeChat message push response', () => {
  it('does not wrap echostr or success in the business response envelope', async () => {
    const middleware = new AllMiddleware();
    const handler = middleware.resolve();
    const verifyContext = {
      path: '/api/wx_message',
      set: jest.fn(),
      body: undefined,
    } as any;
    const messageContext = {
      path: '/api/wx_message',
      set: jest.fn(),
      body: undefined,
    } as any;

    await handler(verifyContext, async () => 'echo-value');
    await handler(messageContext, async () => 'success');

    expect(verifyContext.body).toBe('echo-value');
    expect(messageContext.body).toBe('success');
  });

  it('returns a non-2xx raw response for invalid message push requests', async () => {
    const middleware = new AllMiddleware();
    const handler = middleware.resolve();
    const ctx = {
      path: '/api/wx_message',
      set: jest.fn(),
      body: undefined,
      status: 200,
    } as any;

    await handler(ctx, async () => {
      throw new BusinessError('验签失败', 401);
    });

    expect(ctx.status).toBe(401);
    expect(ctx.body).toBe('验签失败');
  });
});
