import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMeterContext, isCheckerRegistered } from '../../checker-registry';
import checkerDef from '../neuralwatt-checker';

const makeCtx = (options: Record<string, unknown> = {}) =>
  createMeterContext('neuralwatt-test', 'neuralwatt', { apiKey: 'nw-api-key', ...options });

const futureEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
const pastEnd = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

const makeResponse = (
  overrides: {
    credits_remaining_usd?: number;
    total_credits_usd?: number;
    credits_used_usd?: number;
    subscription?: Record<string, unknown> | null | undefined;
  } = {}
) => {
  const { subscription = 'default', ...balanceOverrides } = overrides as {
    subscription?: unknown;
  } & Record<string, unknown>;
  return {
    snapshot_at: new Date().toISOString(),
    balance: {
      credits_remaining_usd: 32.6774,
      total_credits_usd: 52.34,
      credits_used_usd: 19.6626,
      accounting_method: 'energy',
      ...balanceOverrides,
    },
    usage: {},
    limits: { overage_limit_usd: null, rate_limit_tier: 'standard' },
    subscription:
      subscription === 'default'
        ? {
            plan: 'basic',
            status: 'active',
            billing_interval: 'month',
            current_period_start: new Date().toISOString(),
            current_period_end: futureEnd,
            auto_renew: true,
            kwh_included: 20.0,
            kwh_used: 17.647,
            kwh_remaining: 2.353,
            in_overage: false,
          }
        : (subscription as Record<string, unknown> | null | undefined),
    key: { name: 'test-key', allowance: null },
  };
};

describe('neuralwatt checker', () => {
  const setFetchMock = (impl: (...args: unknown[]) => Promise<Response>): void => {
    global.fetch = vi.fn(impl) as unknown as typeof fetch;
  };

  const mockQuota = (payload: unknown) => {
    setFetchMock(
      async () =>
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
    );
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('is registered under neuralwatt', () => {
    expect(isCheckerRegistered('neuralwatt')).toBe(true);
  });

  it('issue #898: $0 credit with remaining subscription quota does not exhaust', async () => {
    mockQuota(makeResponse({ credits_remaining_usd: 0 }));

    const meters = await checkerDef.check(makeCtx());

    expect(meters).toHaveLength(2);
    const credit = meters.find((m) => m.key === 'credit_balance')!;
    const quota = meters.find((m) => m.key === 'energy_quota')!;
    expect(credit.remaining).toBe(0);
    expect(quota.remaining).toBe(2.353);
    // Neither meter may signal exhaustion, otherwise the scheduler injects a
    // provider-wide indefinite cooldown ("until positive balance").
    expect(meters.some((m) => m.status === 'exhausted')).toBe(false);
    expect(credit.status).toBe('ok');
    expect(quota.status).not.toBe('exhausted');
  });

  it('exhausted quota with positive credit does not exhaust', async () => {
    mockQuota(
      makeResponse({
        credits_remaining_usd: 10,
        subscription: {
          plan: 'basic',
          status: 'active',
          billing_interval: 'month',
          current_period_start: new Date().toISOString(),
          current_period_end: futureEnd,
          auto_renew: true,
          kwh_included: 20.0,
          kwh_used: 20.0,
          kwh_remaining: 0,
          in_overage: true,
        },
      })
    );

    const meters = await checkerDef.check(makeCtx());

    expect(meters).toHaveLength(2);
    expect(meters.some((m) => m.status === 'exhausted')).toBe(false);
  });

  it('both sources exhausted still blocks the provider', async () => {
    mockQuota(
      makeResponse({
        credits_remaining_usd: 0,
        subscription: {
          plan: 'basic',
          status: 'active',
          billing_interval: 'month',
          current_period_start: new Date().toISOString(),
          current_period_end: futureEnd,
          auto_renew: true,
          kwh_included: 20.0,
          kwh_used: 20.0,
          kwh_remaining: 0,
          in_overage: true,
        },
      })
    );

    const meters = await checkerDef.check(makeCtx());

    expect(meters).toHaveLength(2);
    expect(meters.some((m) => m.status === 'exhausted')).toBe(true);
  });

  it('past_due subscription with $0 credit still blocks', async () => {
    mockQuota(
      makeResponse({
        credits_remaining_usd: 0,
        subscription: {
          plan: 'basic',
          status: 'past_due',
          billing_interval: 'month',
          current_period_start: new Date().toISOString(),
          current_period_end: futureEnd,
          auto_renew: true,
          kwh_included: 20.0,
          kwh_used: 17.647,
          kwh_remaining: 2.353,
          in_overage: false,
        },
      })
    );

    const meters = await checkerDef.check(makeCtx());

    expect(meters.some((m) => m.status === 'exhausted')).toBe(true);
  });

  it('expired subscription period with $0 credit still blocks', async () => {
    mockQuota(
      makeResponse({
        credits_remaining_usd: 0,
        subscription: {
          plan: 'basic',
          status: 'active',
          billing_interval: 'month',
          current_period_start: new Date().toISOString(),
          current_period_end: pastEnd,
          auto_renew: true,
          kwh_included: 20.0,
          kwh_used: 17.647,
          kwh_remaining: 2.353,
          in_overage: false,
        },
      })
    );

    const meters = await checkerDef.check(makeCtx());

    expect(meters.some((m) => m.status === 'exhausted')).toBe(true);
  });

  it('PAYG-only account with $0 credit still blocks', async () => {
    mockQuota(makeResponse({ credits_remaining_usd: 0, subscription: null }));

    const meters = await checkerDef.check(makeCtx());

    expect(meters).toHaveLength(1);
    expect(meters[0]?.key).toBe('credit_balance');
    expect(meters[0]?.status).toBe('exhausted');
  });

  it('PAYG-only account with positive credit stays healthy', async () => {
    mockQuota(makeResponse({ credits_remaining_usd: 5.5, subscription: null }));

    const meters = await checkerDef.check(makeCtx());

    expect(meters).toHaveLength(1);
    expect(meters[0]?.status).not.toBe('exhausted');
  });

  it('malformed subscription date with $0 credit still blocks without throwing', async () => {
    mockQuota(
      makeResponse({
        credits_remaining_usd: 0,
        subscription: {
          plan: 'basic',
          status: 'active',
          billing_interval: 'month',
          current_period_start: new Date().toISOString(),
          current_period_end: 'not-a-date',
          auto_renew: true,
          kwh_included: 20.0,
          kwh_used: 17.647,
          kwh_remaining: 2.353,
          in_overage: false,
        },
      })
    );

    const meters = await checkerDef.check(makeCtx());

    expect(meters).toHaveLength(2);
    expect(meters.some((m) => m.status === 'exhausted')).toBe(true);
  });

  it('unusable (paused) subscription with remaining quota and no credits still blocks', async () => {
    mockQuota({
      snapshot_at: new Date().toISOString(),
      limits: { overage_limit_usd: null, rate_limit_tier: 'standard' },
      subscription: {
        plan: 'basic',
        status: 'paused',
        billing_interval: 'month',
        current_period_start: new Date().toISOString(),
        current_period_end: futureEnd,
        auto_renew: true,
        kwh_included: 20.0,
        kwh_used: 17.647,
        kwh_remaining: 2.353,
        in_overage: false,
      },
      key: { name: 'test-key', allowance: null },
    });

    const meters = await checkerDef.check(makeCtx());

    expect(meters).toHaveLength(1);
    expect(meters[0]?.key).toBe('energy_quota');
    expect(meters[0]?.status).toBe('exhausted');
  });

  it('unusable (paused) subscription with remaining quota but positive credit stays healthy', async () => {
    mockQuota(
      makeResponse({
        credits_remaining_usd: 5,
        subscription: {
          plan: 'basic',
          status: 'paused',
          billing_interval: 'month',
          current_period_start: new Date().toISOString(),
          current_period_end: futureEnd,
          auto_renew: true,
          kwh_included: 20.0,
          kwh_used: 17.647,
          kwh_remaining: 2.353,
          in_overage: false,
        },
      })
    );

    const meters = await checkerDef.check(makeCtx());

    expect(meters).toHaveLength(2);
    expect(meters.some((m) => m.status === 'exhausted')).toBe(false);
  });

  it('malformed subscription date with positive credit stays healthy without resetsAt', async () => {
    mockQuota(
      makeResponse({
        credits_remaining_usd: 5,
        subscription: {
          plan: 'basic',
          status: 'active',
          billing_interval: 'month',
          current_period_start: new Date().toISOString(),
          current_period_end: 'not-a-date',
          auto_renew: true,
          kwh_included: 20.0,
          kwh_used: 20.0,
          kwh_remaining: 0,
          in_overage: true,
        },
      })
    );

    const meters = await checkerDef.check(makeCtx());

    expect(meters).toHaveLength(2);
    expect(meters.some((m) => m.status === 'exhausted')).toBe(false);
    expect(meters.find((m) => m.key === 'energy_quota')?.resetsAt).toBeUndefined();
  });
});
