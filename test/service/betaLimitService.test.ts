import { Op } from 'sequelize';
import { BetaLimitedModel } from '../../src/model/BetaLimitedModel';
import {
  BetaLimitQuota,
  BetaLimitService,
} from '../../src/service/BetaLimitService';

function createQuota(overrides: Partial<BetaLimitQuota> = {}): BetaLimitQuota {
  return {
    openid: 'openid-1',
    feature: 'exam_help_check',
    usageDate: '2026-10-31',
    used: 2,
    limit: 5,
    remaining: 3,
    ...overrides,
  };
}

describe('BetaLimitService', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-30T16:30:00.000Z'));
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('returns the remaining quota for the Beijing calendar day', async () => {
    const findOne = jest
      .spyOn(BetaLimitedModel, 'findOne')
      .mockResolvedValue({ used_count: 2 } as any);
    const service = new BetaLimitService();

    await expect(
      service.check('openid-1', 'exam_help_check', 5)
    ).resolves.toEqual(createQuota());
    expect(findOne).toHaveBeenCalledWith({
      attributes: ['used_count'],
      where: {
        user_id: 'openid-1',
        feature: 'exam_help_check',
        usage_date: '2026-10-31',
      },
      raw: true,
    });
  });

  it('rejects requests after the daily quota is exhausted', async () => {
    jest
      .spyOn(BetaLimitedModel, 'findOne')
      .mockResolvedValue({ used_count: 5 } as any);
    const service = new BetaLimitService();

    await expect(
      service.check('openid-1', 'exam_help_check', 5)
    ).rejects.toMatchObject({
      status: 429,
      code: 'BETA_DAILY_LIMIT_EXCEEDED',
    });
  });

  it('atomically increments an existing daily record', async () => {
    const update = jest
      .spyOn(BetaLimitedModel, 'update')
      .mockResolvedValue([1] as any);
    const service = new BetaLimitService();

    await expect(service.consume(createQuota())).resolves.toBe(true);
    expect(update).toHaveBeenCalledWith(
      {
        used_count: expect.anything(),
      },
      {
        where: {
          user_id: 'openid-1',
          feature: 'exam_help_check',
          usage_date: '2026-10-31',
          used_count: {
            [Op.lt]: 5,
          },
        },
      }
    );
  });

  it('creates the first daily record after the stream finishes', async () => {
    jest.spyOn(BetaLimitedModel, 'update').mockResolvedValue([0] as any);
    jest.spyOn(BetaLimitedModel, 'findOne').mockResolvedValue(null);
    const create = jest
      .spyOn(BetaLimitedModel, 'create')
      .mockResolvedValue({} as any);
    const service = new BetaLimitService();

    await expect(service.consume(createQuota())).resolves.toBe(true);
    expect(create).toHaveBeenCalledWith({
      user_id: 'openid-1',
      feature: 'exam_help_check',
      usage_date: '2026-10-31',
      used_count: 1,
    });
  });
});
