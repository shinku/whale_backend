import { Controller } from '@midwayjs/core';

export default (perfix = '') => Controller('/api' + perfix);

/**
 *
 * @param perfix 后台管理api
 * @returns
 */
export const AdminApi = (perfix = '') => Controller('/admin' + perfix);
