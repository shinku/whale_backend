import { Controller } from '@midwayjs/core';

export default (perfix = '', middleware = []) =>
  Controller('/api' + perfix, {
    middleware,
  });

/**
 *
 * @param perfix 后台管理api
 * @returns
 */
export const AdminApi = (perfix = '', middleware = []) =>
  Controller('/admin' + perfix, {
    middleware,
  });
