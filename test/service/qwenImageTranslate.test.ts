import { QwenService } from '../../src/service/QwenService';

function createService() {
  const service = new QwenService();
  service.config = { appkey: 'qwen-test-key' };
  return service;
}

describe('QwenService imageTranslate', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('translates image text and normalizes rectangles and colors', async () => {
    const service = createService();
    const chat = jest.spyOn(service, 'chat').mockResolvedValue([
      {
        choices: [
          {
            delta: {
              content:
                '{"translations":[{"message":"这是一段翻译","rect":{"x":"10.4","y":10.2,"w":"200","h":"20"},"color":"#FF00AA","background":"#FFFFFF","fontSize":"18"}]}',
            },
          },
        ],
      },
    ] as any);

    await expect(
      service.imageTranslate({
        image: 'data:image/png;base64,AAAA',
        imageWidth: 1920,
        imageHeight: 1080,
      })
    ).resolves.toEqual([
      {
        message: '这是一段翻译',
        rect: { x: 10, y: 10, w: 200, h: 20 },
        color: '#ff00aa',
        background: '#ffffff',
        fontSize: 18,
      },
    ]);
    expect(chat).toHaveBeenCalledWith(
      [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: expect.stringContaining('翻译成自然、准确的简体中文'),
            },
            {
              type: 'image_url',
              image_url: {
                url: 'data:image/png;base64,AAAA',
              },
            },
          ],
        },
      ],
      expect.objectContaining({
        enableThinking: false,
        responseFormat: 'json_object',
      })
    );
    const prompt = chat.mock.calls[0][0][0].content as any[];
    expect(prompt[0].text).toContain('中文源内容不参与翻译、不返回');
    expect(prompt[0].text).toContain('width=1920, height=1080');
  });

  it('rejects a malformed translation response', async () => {
    const service = createService();
    jest.spyOn(service, 'chat').mockResolvedValue([
      {
        choices: [{ delta: { content: '不是 JSON' } }],
      },
    ] as any);

    await expect(
      service.imageTranslate({
        image: 'https://example.com/translate.png',
      })
    ).rejects.toMatchObject({
      status: 502,
      code: 'QWEN_INVALID_TRANSLATION_RESPONSE',
    });
  });

  it('splits messages containing line breaks into separate canvas rows', () => {
    const service = createService();

    expect(
      service.parseImageTranslationResult(
        JSON.stringify({
          translations: [
            {
              message: '第一行\n第二行',
              rect: { x: 10, y: 20, w: 100, h: 40 },
              color: '#112233',
              background: '#F0F0F0',
              fontSize: 16,
            },
          ],
        })
      )
    ).toEqual([
      {
        message: '第一行',
        rect: { x: 10, y: 20, w: 100, h: 20 },
        color: '#112233',
        background: '#f0f0f0',
        fontSize: 16,
      },
      {
        message: '第二行',
        rect: { x: 10, y: 40, w: 100, h: 20 },
        color: '#112233',
        background: '#f0f0f0',
        fontSize: 16,
      },
    ]);
  });

  it('uses the Chinese-to-Pinyin prompt when requested', async () => {
    const service = createService();
    const chat = jest.spyOn(service, 'chat').mockResolvedValue([
      {
        choices: [
          {
            delta: {
              content:
                '{"translations":[{"message":"nǐ hǎo","rect":{"x":10,"y":10,"w":80,"h":20},"color":"#000000","background":"#FFFFFF","fontSize":16}]}',
            },
          },
        ],
      },
    ] as any);

    await expect(
      service.imageTranslate({
        image: 'data:image/png;base64,AAAA',
        direction: 'zh_to_pinyin',
      })
    ).resolves.toEqual([
      {
        message: 'nǐ hǎo',
        rect: { x: 10, y: 10, w: 80, h: 20 },
        color: '#000000',
        background: '#ffffff',
        fontSize: 16,
      },
    ]);
    const prompt = chat.mock.calls[0][0][0].content as any[];
    expect(prompt[0].text).toContain('转写为带声调符号的标准汉语拼音');
    expect(prompt[0].text).toContain('不翻译成英文');
    expect(prompt[0].text).toContain('只处理中文源内容');
  });

  it('rejects an unsupported translation direction', async () => {
    const service = createService();

    await expect(
      service.imageTranslate({
        image: 'data:image/png;base64,AAAA',
        direction: 'unknown' as any,
      })
    ).rejects.toMatchObject({
      status: 400,
      code: 'INVALID_TRANSLATION_DIRECTION',
    });
  });
});
