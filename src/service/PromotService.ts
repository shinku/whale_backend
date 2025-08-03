import { Provide } from '@midwayjs/core';
import { PromptModel } from '../model/PromptModel';

@Provide()
export class PromptService {
  async getPrompt(actName: string) {
    return PromptModel.findOne({
      attributes: ['prompt', 'act_name'],
      where: {
        act_name: actName,
      },
    });
  }
}
