import { USER_TIME_DATE_LIMIT_TYPE } from '../../src/core/limits';
import { UserLimitModel } from '../../src/model/UserLimitModel';
import { UserModel } from '../../src/model/UserModel';
import { UserService } from '../../src/service/UserService';

describe('test/service/userService.test.ts', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const NOW = new Date('2026-01-01T00:00:00.000Z').getTime();
  const userService = new UserService();

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  const mockUserExisted = () => {
    return jest
      .spyOn(UserModel, 'findOne')
      .mockResolvedValue({ openid: 'mock_openid' } as any);
  };

  const mockTimeLimitRow = (limitDate: Date | null, created = false) => {
    const update = jest.fn().mockResolvedValue(undefined);
    const row = {
      limit_date: limitDate,
      update,
    };
    jest
      .spyOn(UserLimitModel, 'findOrCreate')
      .mockResolvedValue([row as any, created]);
    return update;
  };

  it('should set limit_date = now + days when there is no existing limit_date', async () => {
    mockUserExisted();
    const update = mockTimeLimitRow(null);

    const result = await userService.setLimitDate('mock_openid', 30, 'whale');

    const expected = new Date(NOW + 30 * DAY);
    expect(update).toHaveBeenCalledWith({
      limit_date: expected,
      limit_count: null,
    });
    expect(result.limit_date.getTime()).toBe(expected.getTime());
    expect(result.limit_type).toBe(USER_TIME_DATE_LIMIT_TYPE);
  });

  it('should extend from existing limit_date when it has not expired yet', async () => {
    mockUserExisted();
    const existing = new Date(NOW + 10 * DAY);
    mockTimeLimitRow(existing);

    const result = await userService.setLimitDate('mock_openid', 7, 'whale');

    const expected = new Date(existing.getTime() + 7 * DAY);
    expect(result.limit_date.getTime()).toBe(expected.getTime());
  });

  it('should reset limit_date from now when existing limit_date has expired', async () => {
    mockUserExisted();
    const expired = new Date(NOW - 5 * DAY);
    mockTimeLimitRow(expired);

    const result = await userService.setLimitDate('mock_openid', 7, 'whale');

    const expected = new Date(NOW + 7 * DAY);
    expect(result.limit_date.getTime()).toBe(expected.getTime());
  });

  it('should reject invalid days', async () => {
    mockUserExisted();

    await expect(
      userService.setLimitDate('mock_openid', 0, 'whale')
    ).rejects.toThrow('days_is_invalid');
  });
});
