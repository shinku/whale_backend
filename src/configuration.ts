import { App, Configuration, ILifeCycle } from '@midwayjs/core';
import * as sequelize from '@midwayjs/sequelize';
import * as upload from '@midwayjs/upload';
import * as egg from '@midwayjs/web';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

@Configuration({
  imports: [egg, sequelize, upload],
  importConfigs: [join(__dirname, './config')],
})
export class MainConfiguration implements ILifeCycle {
  @App('egg')
  app: egg.Application;
  async onConfigLoad() {
    // 生产上从 /config/config.json 中读取配置
    const configPath = join('/', 'config/config.json');
    console.log('dataSource', this.app.config.sequelize.dataSource.default);
    if (existsSync(configPath)) {
      const configData = readFileSync(configPath, 'utf-8');
      const configJson = JSON.parse(configData);
      const sequelizeConfig = configJson.sequelize || {};
      Object.assign(this.app.config, configJson);
      this.app.config.sequelize.dataSource.default = {
        ...(this.app.config.sequelize.dataSource.default || {}),
        ...sequelizeConfig,
      };
    }
    console.log('Config', this.app.config);
  }
  async onReady() {}
}
