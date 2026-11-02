import { BusinessError } from '../../src/core/errors';
import { AllMiddleware } from '../../src/middleware/all';
import { Readable } from 'stream';

describe('AllMiddleware error output', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('logs the error, request body and query as a JSON string', async () => {
    const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});
    const middleware = new AllMiddleware();
    const handler = middleware.resolve();
    const ctx = {
      path: '/api/example',
      method: 'POST',
      request: {
        body: {
          productId: 'vip_1',
        },
      },
      query: {
        lane: 'whale',
      },
      set: jest.fn(),
      body: undefined,
      status: 200,
    } as any;

    await handler(ctx, async () => {
      throw new BusinessError('请求参数错误', 400, 'INVALID_REQUEST');
    });

    expect(errorLog).toHaveBeenCalledTimes(1);
    const output = errorLog.mock.calls[0][0];
    expect(typeof output).toBe('string');
    expect(JSON.parse(output)).toEqual({
      error: {
        name: 'BusinessError',
        message: '请求参数错误',
        status: 400,
        code: 'INVALID_REQUEST',
        stack: expect.any(String),
      },
      request: {
        productId: 'vip_1',
      },
      query: {
        lane: 'whale',
      },
    });
    expect(ctx.status).toBe(400);
    expect(ctx.body).toEqual({
      status: 400,
      message: '请求参数错误',
    });
  });

  it('passes through streaming responses without JSON wrapping', async () => {
    const middleware = new AllMiddleware();
    const handler = middleware.resolve();
    const stream = Readable.from(['event: delta\ndata: {}\n\n']);
    const ctx = {
      path: '/api/exam/help_check',
      method: 'POST',
      request: { body: {} },
      query: {},
      set: jest.fn(),
      body: undefined,
      status: 200,
    } as any;

    await handler(ctx, async () => stream);

    expect(ctx.body).toBe(stream);
  });
});
