import { Readable } from 'stream';
import { ExamController } from '../../src/controller/exam';

async function collectStream(stream: Readable) {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function createChunk(content: string, finishReason: string | null = null) {
  return {
    choices: [
      {
        index: 0,
        delta: {
          content,
        },
        finish_reason: finishReason,
      },
    ],
  };
}

describe('ExamController helpCheck', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns exam-check deltas and the parsed result as SSE', async () => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const controller = new ExamController();
    controller.ctx = {
      request: {
        body: {
          image: 'https://example.com/exam.png',
        },
      },
      betaLimit: {
        openid: 'openid-1',
        feature: 'exam_help_check',
        usageDate: '2026-10-31',
        used: 2,
        limit: 5,
        remaining: 3,
      },
      set: jest.fn(),
    } as any;
    const examCheckStream = jest.fn().mockResolvedValue([
      createChunk('{"subject":"英语",'),
      createChunk('"questions":[]}', 'stop'),
    ]);
    const parseExamCheckResult = jest.fn().mockReturnValue({
      subject: '英语',
      questions: [],
    });
    controller.qwenService = {
      examCheckStream,
      parseExamCheckResult,
    } as any;
    const consume = jest.fn().mockResolvedValue(true);
    controller.betaLimitService = {
      consume,
    } as any;

    const stream = await controller.helpCheck(undefined);
    const output = await collectStream(stream);

    expect(examCheckStream).toHaveBeenCalledWith({
      image: 'https://example.com/exam.png',
    });
    expect(controller.ctx.type).toBe('text/event-stream; charset=utf-8');
    expect(controller.ctx.set).toHaveBeenCalledWith(
      'X-Accel-Buffering',
      'no'
    );
    expect(parseExamCheckResult).toHaveBeenCalledWith(
      '{"subject":"英语","questions":[]}'
    );
    expect(consume).toHaveBeenCalledTimes(1);
    expect(consume).toHaveBeenCalledWith(controller.ctx.betaLimit);
    expect(output).toContain(
      'event: delta\ndata: {"content":"{\\"subject\\":\\"英语\\","}\n\n'
    );
    expect(output).toContain(
      'event: done\ndata: {"data":{"subject":"英语","questions":[]}}\n\n'
    );
  });

  it('returns an SSE error event when the model stream fails', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const controller = new ExamController();
    controller.ctx = {
      request: {
        body: {
          image: 'https://example.com/exam.png',
        },
      },
      set: jest.fn(),
    } as any;
    controller.qwenService = {
      examCheckStream: jest.fn().mockRejectedValue(
        Object.assign(new Error('Qwen 模型调用失败'), {
          status: 502,
          code: 'QWEN_REQUEST_FAILED',
        })
      ),
    } as any;

    const stream = await controller.helpCheck(undefined);
    const output = await collectStream(stream);

    expect(output).toContain(
      'event: error\ndata: {"status":502,"message":"Qwen 模型调用失败","code":"QWEN_REQUEST_FAILED"}\n\n'
    );
  });

  it('requires an image', async () => {
    const controller = new ExamController();
    controller.ctx = {
      request: {
        body: {},
      },
    } as any;

    await expect(controller.helpCheck(undefined)).rejects.toMatchObject({
      status: 400,
      code: 'EXAM_IMAGE_REQUIRED',
    });
  });
});
