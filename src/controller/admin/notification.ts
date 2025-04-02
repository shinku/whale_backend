import { Get, Provide, Put } from '@midwayjs/core';
import { AdminApi } from '../api/Api';

@AdminApi('/notification')
@Provide()
export class NotificationController {
  @Get('/')
  async getNotification() {}

  @Put('/update')
  async updateNotification() {}
}
