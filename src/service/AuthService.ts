import { Config, Provide, Scope, ScopeEnum } from '@midwayjs/core';
import * as crypto from 'crypto';
import { LANE } from '../core/enums';
import { BusinessError } from '../core/errors';

export interface AuthTokenPayload {
  sub: string;
  lane: string;
  iat: number;
  exp: number;
}

interface AuthConfig {
  tokenSecret: string;
  tokenTtlSeconds: number;
}

function encodeBase64Url(value: string | Buffer) {
  return (Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8'))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function decodeBase64Url(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(normalized, 'base64');
}

@Provide()
@Scope(ScopeEnum.Request, { allowDowngrade: true })
export class AuthService {
  @Config('auth')
  config!: AuthConfig;

  signAccessToken(openid: string, lane = LANE.WHALE) {
    const secret = this.getSecret();
    const now = Math.floor(Date.now() / 1000);
    const ttl = Math.max(60, Number(this.config.tokenTtlSeconds || 7200));
    const payload: AuthTokenPayload = {
      sub: openid,
      lane,
      iat: now,
      exp: now + ttl,
    };
    const encodedPayload = encodeBase64Url(JSON.stringify(payload));
    const signature = crypto
      .createHmac('sha256', secret)
      .update(encodedPayload)
      .digest();
    return {
      accessToken: `${encodedPayload}.${encodeBase64Url(signature)}`,
      tokenType: 'Bearer',
      expiresIn: ttl,
    };
  }

  verifyAccessToken(token: string): AuthTokenPayload {
    const secret = this.getSecret();
    const parts = token.split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw new BusinessError('登录已失效，请重新登录', 401, 'INVALID_TOKEN');
    }

    const expected = crypto
      .createHmac('sha256', secret)
      .update(parts[0])
      .digest();
    const actual = decodeBase64Url(parts[1]);
    if (
      expected.length !== actual.length ||
      !crypto.timingSafeEqual(expected, actual)
    ) {
      throw new BusinessError('登录已失效，请重新登录', 401, 'INVALID_TOKEN');
    }

    let payload: AuthTokenPayload;
    try {
      payload = JSON.parse(decodeBase64Url(parts[0]).toString('utf8'));
    } catch {
      throw new BusinessError('登录已失效，请重新登录', 401, 'INVALID_TOKEN');
    }
    const now = Math.floor(Date.now() / 1000);
    if (
      !payload ||
      typeof payload.sub !== 'string' ||
      !payload.sub ||
      typeof payload.lane !== 'string' ||
      !Number.isFinite(payload.exp) ||
      payload.exp <= now
    ) {
      throw new BusinessError('登录已过期，请重新登录', 401, 'TOKEN_EXPIRED');
    }
    return payload;
  }

  private getSecret() {
    const secret = this.config?.tokenSecret;
    if (!secret || secret.length < 16) {
      throw new BusinessError('登录服务未配置', 503, 'AUTH_NOT_CONFIGURED');
    }
    return secret;
  }
}
