import { Singleton } from '@midwayjs/core';
import * as fs from 'fs';
import { join } from 'path';

export interface ExtraConfig {
  vipCheckEnabled: boolean;
  guestVipInitialization: boolean;
  guestValidityDays: number;
}

export const DEFAULT_EXTRA_CONFIG: Readonly<ExtraConfig> = Object.freeze({
  vipCheckEnabled: false,
  guestVipInitialization: true,
  guestValidityDays: 3,
});

const EXTRA_CONFIG_PATH = join('/', 'config/extra_config.json');
const CACHE_TTL_MS = 5 * 60 * 1000;

@Singleton()
export class ExtraConfigService {
  private cachedConfig: ExtraConfig | null = null;
  private expiresAt = 0;

  getConfig(): ExtraConfig {
    const now = Date.now();
    if (this.cachedConfig && now < this.expiresAt) {
      return { ...this.cachedConfig };
    }

    const config = this.loadConfig();
    this.cachedConfig = config;
    this.expiresAt = now + CACHE_TTL_MS;
    return { ...config };
  }

  clearCache() {
    this.cachedConfig = null;
    this.expiresAt = 0;
  }

  private loadConfig(): ExtraConfig {
    if (!fs.existsSync(EXTRA_CONFIG_PATH)) {
      return { ...DEFAULT_EXTRA_CONFIG };
    }
    try {
      const content = fs.readFileSync(EXTRA_CONFIG_PATH, 'utf8');
      const parsed = JSON.parse(content);
      return {
        vipCheckEnabled: this.readBoolean(
          parsed?.vipCheckEnabled,
          DEFAULT_EXTRA_CONFIG.vipCheckEnabled
        ),
        guestVipInitialization: this.readBoolean(
          parsed?.guestVipInitialization,
          DEFAULT_EXTRA_CONFIG.guestVipInitialization
        ),
        guestValidityDays: this.readPositiveInteger(
          parsed?.guestValidityDays,
          DEFAULT_EXTRA_CONFIG.guestValidityDays
        ),
      };
    } catch (error) {
      console.warn(
        '[extraConfig] failed to load /config/extra_config.json, using defaults',
        error instanceof Error ? error.message : error
      );
      return { ...DEFAULT_EXTRA_CONFIG };
    }
  }

  private readBoolean(value: unknown, fallback: boolean) {
    return typeof value === 'boolean' ? value : fallback;
  }

  private readPositiveInteger(value: unknown, fallback: number) {
    return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
      ? value
      : fallback;
  }
}
