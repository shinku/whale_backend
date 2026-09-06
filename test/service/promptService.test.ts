import { PromptService } from '../../src/service/PromptService';

describe('test/service/promptService.test.ts', () => {
  const promptService = new PromptService();

  it('should load the aiwriter prompt from the md file', async () => {
    const prompt = await promptService.getPrompt('aiwriter');

    expect(prompt).toBe(
      '你非常擅长写作文，你将基于我的作文要求，包括作文主题(topic)，作文要求(extra)，作文类型(type)，语言类型(language)，以及作文字数()写一篇作文，给我参考，你只要返回结果，不需要任何额外的内容。'
    );
  });

  it('should load the math prompt from the md file', async () => {
    const prompt = await promptService.getPrompt('math');

    expect(prompt).toBe(
      '你是一个小学的数学老师，你将基于我给的的提示给出几道基础的计算题目。并以回车区分每一道题目。你只要返回结果，不需要任何额外的内容。'
    );
  });

  it('should throw when the md file does not exist', async () => {
    await expect(promptService.getPrompt('unknown_activity')).rejects.toThrow(
      'prompt file not found: unknown_activity.md'
    );
  });

  it('should list all actIds from the prompts directory', async () => {
    const activities = await promptService.getPromptList();

    expect(activities).toContain('aiwriter');
    expect(activities).toContain('idiom_practice');
    expect(activities).toContain('math');
    expect(activities).toContain('vertical_calc');
  });
});
