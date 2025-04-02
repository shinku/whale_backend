import { All, Controller, Provide } from '@midwayjs/core';

@Controller()
@Provide()
export class HomeController {
  @All('/')
  async index() {
    return { status: 'ok' };
  }
}
