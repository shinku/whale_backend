import { Ai } from '../../src/controller/ai';
import { AiSubjectStoreModel } from '../../src/model/AiSubjectStoreModel';

const TINY_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z3u8AAAAASUVORK5CYII=';

describe('Ai subject translate', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('accepts one Base64 image and returns translation data', async () => {
    const controller = new Ai();
    controller.ctx = {
      request: {
        body: {
          imageBase64: `data:image/png;base64,${TINY_PNG}`,
          direction: 'zh_to_pinyin',
        },
      },
      get: jest.fn((name: string) =>
        name === 'x-user-id' ? 'openid-1' : undefined
      ),
    } as any;
    const imageTranslate = jest.fn().mockResolvedValue([
      {
        message: '这是一段翻译',
        rect: { x: 10, y: 10, w: 200, h: 20 },
        color: '#ff0000',
        background: '#ffffff',
        fontSize: 20,
      },
    ]);
    controller.qwenService = { imageTranslate } as any;
    const uploadStream = jest.fn().mockResolvedValue({ name: 'uploaded' });
    controller.ossService = { uploadStream } as any;
    const create = jest
      .spyOn(AiSubjectStoreModel, 'create')
      .mockResolvedValue({} as any);

    await expect(controller.translateSubject()).resolves.toEqual({
      data: {
        source: expect.stringMatching(
          /^pub\/openid-1\/translate_.+\.png$/
        ),
        result: [
          {
            message: '这是一段翻译',
            rect: { x: 10, y: 10, w: 200, h: 20 },
            color: '#ff0000',
            background: '#ffffff',
            fontSize: 20,
          },
        ],
        direction: 'zh_to_pinyin',
        imageWidth: 1,
        imageHeight: 1,
      },
      id: expect.any(String),
    });
    expect(imageTranslate).toHaveBeenCalledWith({
      image: `data:image/png;base64,${TINY_PNG}`,
      direction: 'zh_to_pinyin',
      imageWidth: 1,
      imageHeight: 1,
    });
    expect(uploadStream).toHaveBeenCalledWith(
      expect.objectContaining({
        fileName: expect.stringMatching(
          /^pub\/openid-1\/translate_.+\.png$/
        ),
        forbidOverride: 'true',
      })
    );
    expect(create).toHaveBeenCalledWith({
      requestid: expect.any(String),
      store_content: expect.stringMatching(
        /"source":"pub\/openid-1\//
      ),
    });
    expect(create.mock.calls[0][0].store_content).not.toContain(
      'data:image/png;base64'
    );
  });

  it('requires an image', async () => {
    const controller = new Ai();
    controller.ctx = {
      request: {
        body: {},
      },
    } as any;

    await expect(controller.translateSubject()).rejects.toMatchObject({
      status: 400,
      code: 'TRANSLATE_IMAGE_REQUIRED',
    });
  });

  it('rejects an invalid translation direction', async () => {
    const controller = new Ai();
    controller.ctx = {
      request: {
        body: {
          source: 'data:image/png;base64,AAAA',
          direction: 'invalid',
        },
      },
    } as any;

    await expect(controller.translateSubject()).rejects.toMatchObject({
      status: 400,
      code: 'INVALID_TRANSLATION_DIRECTION',
    });
  });

  it('returns a stored translation by id', async () => {
    const controller = new Ai();
    controller.qwenService = {} as any;
    jest.spyOn(AiSubjectStoreModel, 'findOne').mockResolvedValue({
      requestid: 'translation-id',
      createdAt: new Date(),
      store_content: JSON.stringify({
        source:
          'https://fms.whalepea.com/pub/openid-1/translate_existing.png',
        imageWidth: 1920,
        imageHeight: 1080,
        result: [
          {
            message: '这是一段翻译',
            rect: { x: 10, y: 10, w: 200, h: 20 },
            color: '#ff0000',
            background: '#ffffff',
            fontSize: 20,
          },
        ],
      }),
    } as any);

    await expect(
      controller.getTranslatedSubject('translation-id')
    ).resolves.toEqual({
      data: {
        source: 'pub/openid-1/translate_existing.png',
        result: [
          {
            message: '这是一段翻译',
            rect: { x: 10, y: 10, w: 200, h: 20 },
            color: '#ff0000',
            background: '#ffffff',
            fontSize: 20,
          },
        ],
        direction: 'en_to_zh',
        imageWidth: 1920,
        imageHeight: 1080,
      },
      id: 'translation-id',
    });
  });
});
