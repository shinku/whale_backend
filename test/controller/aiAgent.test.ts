import { Readable } from 'stream';
import { AiAgentController } from '../../src/controller/agent';

const TINY_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z3u8AAAAASUVORK5CYII=';

async function collectStream(stream: Readable) {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString('utf8');
}

describe('AiAgentController', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns typed agent events as text/event-stream', async () => {
    const controller = new AiAgentController();
    controller.ctx = {
      request: {
        body: {
          message: '帮我制定一周数学复习计划',
          imageBase64: TINY_PNG,
          history: [
            {
              role: 'user',
              content: '我下周考试',
            },
          ],
        },
      },
      get: jest.fn((name: string) =>
        name === 'x-user-id' ? 'openid-1' : undefined
      ),
      session: {
        user_orinted: 'The user is translating English content.',
      },
      set: jest.fn(),
    } as any;
    controller.userService = {
      requireAgentProfile: jest.fn().mockResolvedValue({
        openid: 'openid-1',
        lane: 'whale',
        registered: true,
        userName: '小明',
        mobile: null,
        vip: {
          type: 'monthly',
          active: true,
          availableEnd: null,
        },
      }),
    } as any;
    controller.learningAgentService = {
      prepareUserOrinted: jest
        .fn()
        .mockResolvedValue('The user is translating English content.'),
      streamChat: jest.fn().mockReturnValue(
        (async function* () {
          yield 'event: answer\ndata: {"type":"answer","content":"# 计划","format":"markdown"}\n\n';
          yield 'event: done\ndata: {"type":"done","requestId":"r1","durationMs":1}\n\n';
        })()
      ),
    } as any;
    const stream = await controller.chat();
    const output = await collectStream(stream);

    expect(controller.learningAgentService.streamChat).toHaveBeenCalledWith(
      expect.objectContaining({
        message: '帮我制定一周数学复习计划',
        imageBase64: `data:image/png;base64,${TINY_PNG}`,
        history: [
          {
            role: 'user',
            content: '我下周考试',
          },
        ],
      }),
      expect.objectContaining({
        openid: 'openid-1',
      }),
      'The user is translating English content.'
    );
    expect(
      controller.learningAgentService.prepareUserOrinted
    ).toHaveBeenCalledWith(
      expect.objectContaining({ message: '帮我制定一周数学复习计划' }),
      'The user is translating English content.'
    );
    expect(controller.ctx.session.user_orinted).toBe(
      'The user is translating English content.'
    );
    expect(controller.ctx.type).toBe('text/event-stream; charset=utf-8');
    expect(controller.ctx.set).toHaveBeenCalledWith('X-Accel-Buffering', 'no');
    expect(output).not.toContain('event: thinking');
    expect(output).toContain('event: answer');
    expect(output).toContain('event: done');
  });

  it('requires the openid header before opening a stream', async () => {
    const controller = new AiAgentController();
    controller.ctx = {
      request: {
        body: {
          message: '你好',
        },
      },
      get: jest.fn().mockReturnValue(undefined),
    } as any;

    await expect(controller.chat()).rejects.toMatchObject({
      status: 401,
      code: 'AUTH_REQUIRED',
    });
  });

  it('does not accept x-openid as a fallback', async () => {
    const controller = new AiAgentController();
    controller.ctx = {
      request: {
        body: {
          message: '你好',
        },
      },
      get: jest.fn((name: string) =>
        name === 'x-openid' ? 'openid-from-header' : undefined
      ),
    } as any;

    await expect(controller.chat()).rejects.toMatchObject({
      status: 401,
      code: 'AUTH_REQUIRED',
    });
  });
});
