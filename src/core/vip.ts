export const VIP_MEMBER_TYPES = [
  'guest',
  'monthly',
  'quarterly',
  'yearly',
  'infinity',
] as const;

export type VipMemberType = (typeof VIP_MEMBER_TYPES)[number];

export const VIP_ORDER_STATUS = {
  CREATING: 'CREATING',
  PENDING: 'PENDING',
  PAID: 'PAID',
  CLOSED: 'CLOSED',
  FAILED: 'FAILED',
  REFUNDED: 'REFUNDED',
  GRANTED: 'GRANTED',
} as const;

export type VipOrderStatus =
  (typeof VIP_ORDER_STATUS)[keyof typeof VIP_ORDER_STATUS];

export const VIP_REFUND_STATUS = {
  CREATING: 'CREATING',
  PROCESSING: 'PROCESSING',
  SUCCESS: 'SUCCESS',
  ABNORMAL: 'ABNORMAL',
  CLOSED: 'CLOSED',
  FAILED: 'FAILED',
} as const;

export type VipRefundStatus =
  (typeof VIP_REFUND_STATUS)[keyof typeof VIP_REFUND_STATUS];

export const VIP_PLAN_DEFINITIONS = [
  {
    plan_id: 'month',
    name: '月卡会员',
    member_type: 'monthly',
    duration_days: 30,
    price_cents: 990,
    original_price_cents: 990,
    badge: '',
    description: '灵活体验，随时续费',
    recommended: false,
    sort: 10,
  },
  {
    plan_id: 'quarter',
    name: '季卡会员',
    member_type: 'quarterly',
    duration_days: 90,
    price_cents: 2880,
    original_price_cents: 2880,
    badge: '推荐',
    description: '适合阶段性学习提升',
    recommended: true,
    sort: 20,
  },
  {
    plan_id: 'year',
    name: '年卡会员',
    member_type: 'yearly',
    duration_days: 365,
    price_cents: 6800,
    original_price_cents: 6800,
    badge: '最划算',
    description: '全年学习工具不限次',
    recommended: false,
    sort: 30,
  },
] as const;

export const VIRTUAL_PAY_VIP_PRODUCTS = {
  vip_9_9: {
    productId: 'vip_9_9',
    name: '月卡会员',
    memberType: 'monthly',
    durationDays: 30,
    priceCents: 990,
  },
  vip_28_8: {
    productId: 'vip_28_8',
    name: '季卡会员',
    memberType: 'quarterly',
    durationDays: 90,
    priceCents: 2880,
  },
  vip_68: {
    productId: 'vip_68',
    name: '年卡会员',
    memberType: 'yearly',
    durationDays: 365,
    priceCents: 6780,
  },
} as const;

export type VipVirtualPayProductId = keyof typeof VIRTUAL_PAY_VIP_PRODUCTS;

export const DAY_MILLISECONDS = 24 * 60 * 60 * 1000;

export function isVipMemberType(value: string): value is VipMemberType {
  return VIP_MEMBER_TYPES.includes(value as VipMemberType);
}

/**
 * 会员是否有效只看到期时间。available_end 为空表示永不过期。
 */
export function isMembershipActive(
  availableEnd: Date | string | number | null | undefined,
  now = new Date()
) {
  const end = toDate(availableEnd);
  return end === null || end.getTime() > now.getTime();
}

export function isVipActive(
  type: string,
  availableEnd: Date | string | number | null | undefined,
  now = new Date()
) {
  return type === 'infinity' || isMembershipActive(availableEnd, now);
}

export function toDate(value: Date | string | number | null | undefined) {
  if (value === null || value === undefined) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function calculateMembershipExtension(
  type: string,
  availableStart: Date | string | number | null | undefined,
  availableEnd: Date | string | number | null | undefined,
  durationDays: number,
  now = new Date()
) {
  const end = toDate(availableEnd);
  const start = toDate(availableStart);
  if (type === 'infinity') {
    return {
      membershipStart: start || now,
      membershipEnd: null,
    };
  }
  const active = end !== null && end.getTime() > now.getTime();
  const baseTime = active ? end.getTime() : now.getTime();
  const membershipStart = active && start ? start : now;
  return {
    membershipStart,
    membershipEnd: new Date(baseTime + durationDays * DAY_MILLISECONDS),
  };
}
