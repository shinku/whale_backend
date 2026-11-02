import { LearningAgentToolsService } from '../../src/service/LearningAgentToolsService';
import { UserRecordModel } from '../../src/model/UserRecord';

const profile = {
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
};

describe('LearningAgentToolsService', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('exposes learning and file tools to the deep agent', () => {
    const service = new LearningAgentToolsService();
    const tools = service.buildTools({ profile });

    expect(tools.map(item => item.name)).toEqual([
      'read_chat_history',
      'collect_wrong_questions',
      'clear_handwriting',
      'images_to_pdf',
      'markdown_to_word',
      'convert_pdf_to_word',
      'list_my_uploaded_files',
    ]);
  });

  it('reads prior chat history only when requested by the agent', async () => {
    const service = new LearningAgentToolsService();
    const tools = service.buildTools({
      profile,
      history: [
        { role: 'user', content: '我想提高二次函数' },
        { role: 'assistant', content: '先复习顶点式' },
        { role: 'user', content: '今天换个知识点' },
      ],
    });
    const historyTool = tools.find(item => item.name === 'read_chat_history')!;

    await expect(
      historyTool.invoke({ query: '二次函数', limit: 5 })
    ).resolves.toMatchObject({
      ok: true,
      total: 3,
      matched: 1,
      items: [{ role: 'user', content: '我想提高二次函数' }],
    });
  });

  it('wraps wrong-question collection with the user quota', async () => {
    const service = new LearningAgentToolsService();
    service.userService = {
      assertCountLimitAvailable: jest.fn().mockResolvedValue(1),
      consumeCountLimit: jest.fn().mockResolvedValue(0),
    } as any;
    service.errorCollectService = {
      collect: jest.fn().mockResolvedValue({
        code: 0,
        message: 'ok',
        data: {
          structure_result: [{ block_type: 'wrong_question', location: [1, 2] }],
        },
      }),
    } as any;
    const collect = service
      .buildTools({ profile })
      .find(item => item.name === 'collect_wrong_questions')!;

    await expect(
      collect.invoke({
        imageBase64: 'data:image/jpeg;base64,AAAA',
      })
    ).resolves.toMatchObject({
      ok: true,
      result: {
        code: 0,
        data: {
          structure_result: [{ block_type: 'wrong_question' }],
        },
      },
    });
    expect(service.userService.assertCountLimitAvailable).toHaveBeenCalledWith(
      'openid-1',
      'whale',
      'count_error_collect_limit'
    );
    expect(service.userService.consumeCountLimit).toHaveBeenCalledWith(
      'openid-1',
      'whale',
      'count_error_collect_limit'
    );
  });

  it('clears handwriting, uploads the result and records the file', async () => {
    jest.spyOn(UserRecordModel, 'create').mockResolvedValue({} as any);
    const service = new LearningAgentToolsService();
    service.userService = {
      assertCountLimitAvailable: jest.fn().mockResolvedValue(1),
      consumeCountLimit: jest.fn().mockResolvedValue(0),
    } as any;
    service.imageService = {
      eraserHandWriteImage: jest.fn().mockResolvedValue({
        data: {
          result: {
            image: 'AAAA',
          },
        },
      }),
    } as any;
    service.ossService = {
      uploadStream: jest.fn().mockResolvedValue({ name: 'uploaded' }),
    } as any;
    const clear = service
      .buildTools({ profile })
      .find(item => item.name === 'clear_handwriting')!;

    await expect(
      clear.invoke({
        imageBase64: 'data:image/jpeg;base64,AAAA',
      })
    ).resolves.toMatchObject({
      ok: true,
      file: expect.stringMatching(/^pub\/agent\/.+\.jpg$/),
      url: expect.stringContaining('https://fms.whalepea.com/pub/agent/'),
    });
    expect(UserRecordModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'openid-1',
        lane: 'whale',
        image_url_after: expect.stringMatching(/^pub\/agent\//),
      })
    );
  });
});
