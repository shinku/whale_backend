import { user as UserController } from '../../src/controller/user';
import { UserModel } from '../../src/model/UserModel';

describe('GET /api/user/:token VIP fields', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('adds a vip array while preserving legacy VIP summary fields', async () => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(UserModel, 'findOrCreate').mockResolvedValue([
      {
        openid: 'openid-1',
        user_name: 'tester',
        lane: 'whale',
      } as any,
      true,
    ]);
    const vip = [
      {
        type: 'quarterly',
        name: '季卡会员',
        active: true,
        available_start: new Date('2026-10-01T00:00:00.000Z'),
        available_end: new Date('2026-12-30T00:00:00.000Z'),
      },
    ];
    const controller = new UserController();
    controller.ctx = {
      lane: 'whale',
      params: { token: 'wx-code' },
    } as any;
    controller.wechatService = {
      getBaseUserInfo: jest.fn().mockResolvedValue({
        openid: 'openid-1',
        session_key: 'session-key',
      }),
    } as any;
    controller.pointerService = {
      userInitialization: jest.fn().mockResolvedValue(10),
    } as any;
    controller.vipService = {
      userVipInitializatin: jest.fn().mockResolvedValue({
        type: 'quarterly',
        available_start: new Date('2026-10-01T00:00:00.000Z'),
        available_end: new Date('2026-12-30T00:00:00.000Z'),
      }),
      getVipInfo: jest.fn().mockResolvedValue(vip),
    } as any;
    controller.userService = {
      initializeUserCountLimits: jest.fn().mockResolvedValue({
        count_clear_hands_write_limit: 10,
      }),
    } as any;

    const result = await controller.getUserInfo();

    expect(result.data.vip).toEqual(vip);
    expect(result.data.type).toBe('quarterly');
    expect(result.data.available_end).toEqual(
      new Date('2026-12-30T00:00:00.000Z')
    );
    expect(controller.vipService.getVipInfo).toHaveBeenCalledWith('openid-1');
  });
});
