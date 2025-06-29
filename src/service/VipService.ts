import { Provide } from '@midwayjs/core';
import { UserVipModel } from '../model/UserVipModel';

@Provide()
export class VipService {
  async userVipInitializatin(uid: string) {
    const record = await UserVipModel.findOne({
      where: {
        user_id: uid,
      },
    });
    if (!record) {
      await UserVipModel.create({
        user_id: uid,
        type: 'guest',
        available_start: Date.now(),
        // 7天有效期
        available_end: Date.now() + 7 * 3600 * 1000 * 24,
      });
      return {
        type: 'guest',
        available_start: Date.now(),
        // 7天有效期
        available_end: Date.now() + 7 * 3600 * 1000 * 24,
      };
    }
    return {
      type: record.type,
      available_start: record.available_start,
      available_end: record.available_end,
    };
  }
  /**
   * 修改会员信息
   * @param uid
   * @param type
   * @param start_time
   * @param end_time
   * @returns
   */
  async modifyVip(
    uid: string,
    type: 'guest' | 'vip' | 'svip' = 'guest',
    start_time: number,
    end_time: number
  ) {
    const record = await UserVipModel.findOne({
      where: {
        user_id: uid,
      },
    });
    if (!record) {
      throw new Error('no_record_found');
    }
    record.type = type;
    record.available_start = start_time;
    record.available_end = end_time;
    await record.save();
    return;
  }
}
