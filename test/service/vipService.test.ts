import * as crypto from 'crypto';
import {
  calculateMembershipExtension,
  VIP_PLAN_DEFINITIONS,
} from '../../src/core/vip';
import { VipRefundModel } from '../../src/model/VipRefundModel';
import { AuthService } from '../../src/service/AuthService';
import { VipService } from '../../src/service/VipService';
import { WxPayService } from '../../src/service/WxPayService';

describe('vip service helpers', () => {
  const now = new Date('2026-10-25T00:00:00.000Z');

  it('uses the requested integer-cent prices', () => {
    expect(
      VIP_PLAN_DEFINITIONS.map(plan => [plan.plan_id, plan.price_cents])
    ).toEqual([
      ['month', 990],
      ['quarter', 2880],
      ['year', 6800],
    ]);
  });

  it('extends an active membership from its current expiry', () => {
    const result = calculateMembershipExtension(
      'monthly',
      new Date('2026-10-01T00:00:00.000Z'),
      new Date('2026-11-01T00:00:00.000Z'),
      30,
      now
    );
    expect(result.membershipStart.toISOString()).toBe(
      '2026-10-01T00:00:00.000Z'
    );
    expect(result.membershipEnd.toISOString()).toBe('2026-12-01T00:00:00.000Z');
  });

  it('starts from now after a membership has expired', () => {
    const result = calculateMembershipExtension(
      'yearly',
      new Date('2025-01-01T00:00:00.000Z'),
      new Date('2026-01-01T00:00:00.000Z'),
      30,
      now
    );
    expect(result.membershipStart.toISOString()).toBe(now.toISOString());
    expect(result.membershipEnd.toISOString()).toBe('2026-11-24T00:00:00.000Z');
  });

  it.each([30, 90, 365])(
    'starts from now when there is no active membership record (%i days)',
    durationDays => {
      const result = calculateMembershipExtension(
        'guest',
        null,
        null,
        durationDays,
        now
      );
      expect(result.membershipStart.getTime()).toBe(now.getTime());
      expect(result.membershipEnd.getTime()).toBe(
        now.getTime() + durationDays * 24 * 60 * 60 * 1000
      );
    }
  );

  it('treats an expiry equal to now as inactive', () => {
    const result = calculateMembershipExtension(
      'monthly',
      new Date('2026-09-25T00:00:00.000Z'),
      now,
      30,
      now
    );
    expect(result.membershipStart.getTime()).toBe(now.getTime());
    expect(result.membershipEnd.toISOString()).toBe('2026-11-24T00:00:00.000Z');
  });
});

describe('VipService refund guard', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('only allows refunding the latest paid effective order', async () => {
    jest.spyOn(VipRefundModel, 'findOne').mockResolvedValue(null);
    const service = new VipService();
    (service as any).findLatestPaidOrder = jest.fn().mockResolvedValue({
      order_no: 'VIP_LATEST',
      membership_end_at: new Date('2099-01-01T00:00:00.000Z'),
    });

    await expect(
      service.requestRefund('openid-1', 'VIP_OLDER', 'admin')
    ).rejects.toMatchObject({
      status: 409,
      message: '仅支持退款最新一笔有效购买记录',
    });
  });

  it('rejects the latest order when its membership has expired', async () => {
    jest.spyOn(VipRefundModel, 'findOne').mockResolvedValue(null);
    const service = new VipService();
    (service as any).findLatestPaidOrder = jest.fn().mockResolvedValue({
      order_no: 'VIP_LATEST',
      membership_end_at: new Date('2020-01-01T00:00:00.000Z'),
    });

    await expect(
      service.requestRefund('openid-1', 'VIP_LATEST', 'admin')
    ).rejects.toMatchObject({
      message: '最新一笔购买记录已过期，无法退款',
    });
  });
});

describe('auth token', () => {
  it('signs and verifies the openid without trusting a request header', () => {
    const service = new AuthService();
    service.config = {
      tokenSecret: 'test-secret-that-is-long-enough',
      tokenTtlSeconds: 7200,
    };
    const token = service.signAccessToken('openid-1');
    const payload = service.verifyAccessToken(token.accessToken);
    expect(payload.sub).toBe('openid-1');
    expect(token.tokenType).toBe('Bearer');
  });

  it('rejects a tampered token', () => {
    const service = new AuthService();
    service.config = {
      tokenSecret: 'test-secret-that-is-long-enough',
      tokenTtlSeconds: 7200,
    };
    const token = service.signAccessToken('openid-1').accessToken;
    const parts = token.split('.');
    const tampered = `${parts[0]}.${Buffer.from('invalid').toString('base64')}`;
    expect(() => service.verifyAccessToken(tampered)).toThrow();
  });
});

describe('wechat pay resource decryption', () => {
  it('decrypts an AES-256-GCM callback resource', () => {
    const service = new WxPayService();
    const apiV3Key = '0123456789abcdef0123456789abcdef';
    const nonce = '123456789012';
    const associatedData = 'transaction';
    service.config = { apiV3Key } as any;
    const plaintext = JSON.stringify({
      out_trade_no: 'VIP20261025000000123456',
    });
    const cipher = crypto.createCipheriv(
      'aes-256-gcm',
      Buffer.from(apiV3Key, 'utf8'),
      Buffer.from(nonce, 'utf8')
    );
    cipher.setAAD(Buffer.from(associatedData, 'utf8'));
    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
      cipher.getAuthTag(),
    ]).toString('base64');

    const result = (service as any).decryptResource({
      algorithm: 'AEAD_AES_256_GCM',
      ciphertext: encrypted,
      nonce,
      associated_data: associatedData,
    });
    expect(result.out_trade_no).toBe('VIP20261025000000123456');
  });
});
