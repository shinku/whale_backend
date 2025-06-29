import { Provide } from '@midwayjs/core';
import { UserPointModel } from '../model/UserPoint';

@Provide()
export class PointService {
  async userInitialization(uid: string) {
    const record = await UserPointModel.findOne({
      where: { user_id: uid },
      raw: true,
    });
    if (!record) {
      // 免费送1000积分
      const amount = 1000;
      await UserPointModel.create({
        user_id: uid,
        amount,
      });
      return {
        amount,
      };
    }
    return {
      amount: record.amount,
    };
  }
  async modifyPoint(
    uid: string,
    point: number,
    action: 'increase' | 'decrease'
  ) {
    const record = await UserPointModel.findOne({
      where: { user_id: uid },
      raw: true,
    });
    if (!record) {
      throw new Error('no_point_record_found');
    }
    let newPoint = Number(record.amount);
    switch (action) {
      case 'decrease':
        newPoint = Math.max(newPoint - point, 0);
        break;
      case 'increase':
        newPoint = newPoint + point;
        break;
    }
    await UserPointModel.update(
      {
        amount: newPoint,
      },
      {
        where: { user_id: uid },
      }
    );
    return {
      amount: newPoint,
    };
  }
}
