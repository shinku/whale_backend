import { All, Controller, Provide } from '@midwayjs/core';

@Controller()
@Provide()
export class HomeController {
  @All('/')
  async index() {
    return { status: 'ok', data: '正常工作' };
  }
  @All('/status')
  async status() {
    return { status: 'ok', data: 'status working' };
  }
}
