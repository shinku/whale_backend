import { App, Configuration, ILifeCycle } from '@midwayjs/core';
import * as sequelize from '@midwayjs/sequelize';
import * as upload from '@midwayjs/upload';
import * as egg from '@midwayjs/web';
import { join } from 'path';
@Configuration({
  imports: [egg, sequelize, upload],
  importConfigs: [join(__dirname, './config')],
})
export class MainConfiguration implements ILifeCycle {
  @App('egg')
  app: egg.Application;
  async onReady() {}
}
