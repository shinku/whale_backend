import { Controller } from '@midwayjs/core';

export default (perfix = '', middleware: string[] = []) =>
  Controller('/api' + perfix, {
    middleware,
  });

/**
 *
 * @param perfix 后台管理api
 * @returns
 */
export const AdminApi = (perfix = '', middleware: string[] = []) =>
  Controller('/admin' + perfix, {
    middleware,
  });
