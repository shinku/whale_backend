import { Configuration, ILifeCycle } from '@midwayjs/core';
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
  async onConfigLoad(): Promise<any> {
    const config = {};
    // 生产上从 /config/config.json 中读取配置
    const configPath = join('/', 'config/config.json');
    if (existsSync(configPath)) {
      const config = readFileSync(configPath, 'utf-8');
      const configJson = JSON.parse(config);
      const sequelizeConfig = configJson.sequelize;
      Object.assign(config, {
        sequelize: {
          dataSource: {
            default: sequelizeConfig,
          },
        },
      });
    }
    return config;
  }
  async onReady() {}
}
