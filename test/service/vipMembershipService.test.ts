import { VipOrderModel } from '../../src/model/VipOrderModel';
import { VipMembershipService } from '../../src/service/VipMembershipService';

describe('VipMembershipService', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('derives the current membership from vip_order', async () => {
    jest.spyOn(VipOrderModel, 'findOne').mockResolvedValueOnce(null);
    jest.spyOn(VipOrderModel, 'findOne').mockResolvedValueOnce({
      user_id: 'openid-1',
      plan_id: 'month',
      plan_snapshot: {
        name: '月卡会员',
        memberType: 'monthly',
      },
      membership_start_at: new Date('2026-11-01T00:00:00.000Z'),
      membership_end_at: new Date('2099-01-01T00:00:00.000Z'),
    } as any);
    const service = new VipMembershipService();

    await expect(
      service.getCurrentMembership('openid-1')
    ).resolves.toMatchObject({
      type: 'monthly',
      name: '月卡会员',
      active: true,
    });
  });

  it('prefers an infinity order over older paid orders', async () => {
    jest.spyOn(VipOrderModel, 'findOne').mockResolvedValueOnce({
      user_id: 'openid-1',
      plan_id: 'infinity',
      plan_snapshot: {
        name: '永久会员',
        memberType: 'infinity',
      },
      membership_start_at: new Date('2026-01-01T00:00:00.000Z'),
      membership_end_at: null,
    } as any);
    const service = new VipMembershipService();

    await expect(
      service.getCurrentMembership('openid-1')
    ).resolves.toMatchObject({
      type: 'infinity',
      active: true,
    });
    expect(VipOrderModel.findOne).toHaveBeenCalledTimes(1);
  });
});
