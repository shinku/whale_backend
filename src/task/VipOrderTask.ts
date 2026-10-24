import { Job, IJob } from '@midwayjs/cron';
import { Inject } from '@midwayjs/core';
import { VipService } from '../service/VipService';

@Job({
  cronTime: '0 */10 * * * *',
  start: true,
  timeZone: 'Asia/Shanghai',
})
export class VipOrderTask implements IJob {
  @Inject()
  vipService!: VipService;

  async onTick() {
    const instance = process.env.NODE_APP_INSTANCE;
    if (instance !== undefined && instance !== '0') {
      return;
    }
    const checked = await this.vipService.closeExpiredOrders();
    const checkedRefunds = await this.vipService.syncPendingRefunds();
    if (checked > 0 || checkedRefunds > 0) {
      console.log('[vipOrder] expired order/refund check finished', {
        checked,
        checkedRefunds,
      });
    }
  }
}
