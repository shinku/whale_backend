import * as fs from 'fs';
import {
  DEFAULT_EXTRA_CONFIG,
  ExtraConfigService,
} from '../../src/service/ExtraConfigService';

describe('ExtraConfigService', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-31T00:00:00.000Z'));
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('uses defaults when the file does not exist and caches for five minutes', () => {
    const exists = jest.spyOn(fs, 'existsSync').mockReturnValue(false);
    const service = new ExtraConfigService();

    expect(service.getConfig()).toEqual(DEFAULT_EXTRA_CONFIG);
    jest.advanceTimersByTime(4 * 60 * 1000);
    expect(service.getConfig()).toEqual(DEFAULT_EXTRA_CONFIG);
    expect(exists).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(60 * 1000 + 1);
    expect(service.getConfig()).toEqual(DEFAULT_EXTRA_CONFIG);
    expect(exists).toHaveBeenCalledTimes(2);
  });

  it('reads and validates values from extra_config.json', () => {
    jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    jest.spyOn(fs, 'readFileSync').mockReturnValue(
      JSON.stringify({
        vipCheckEnabled: true,
        guestVipInitialization: false,
        guestValidityDays: 7,
      }) as any
    );
    const service = new ExtraConfigService();

    expect(service.getConfig()).toEqual({
      vipCheckEnabled: true,
      guestVipInitialization: false,
      guestValidityDays: 7,
    });
  });

  it('falls back invalid values to defaults', () => {
    jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    jest.spyOn(fs, 'readFileSync').mockReturnValue(
      JSON.stringify({
        vipCheckEnabled: 'yes',
        guestVipInitialization: null,
        guestValidityDays: 0,
      }) as any
    );
    const service = new ExtraConfigService();

    expect(service.getConfig()).toEqual(DEFAULT_EXTRA_CONFIG);
  });
});
