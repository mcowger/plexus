import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { QuotaCheckerConfig } from '../../../../types/quota';
import { ApertisCodingPlanQuotaChecker } from '../apertis-coding-plan-checker';
import { QuotaCheckerFactory } from '../../quota-checker-factory';

const makeConfig = (options: Record<string, unknown> = {}): QuotaCheckerConfig => ({
  id: 'apertis-coding-test',
  provider: 'apertis',
  type: 'apertis-coding-plan',
  enabled: true,
  intervalMinutes: 30,
  options: {
    apiKey: 'apertis-api-key',
    ...options,
  },
});

const makeSubscriptionResponse = (
  overrides: Partial<{
    plan_type: 'lite' | 'pro' | 'max';
    status: 'active' | 'suspended' | 'cancelled';
    cycle_quota_limit: number;
    cycle_quota_used: number;
    cycle_quota_remaining: number;
    cycle_end: string;
  }> = {}
) => ({
  object: 'billing_credits' as const,
  is_subscriber: true,
  payg: {
    remaining_usd: 0,
    used_usd: 0,
    total_usd: 0,
    is_unlimited: false,
  },
  subscription: {
    plan_type: overrides.plan_type ?? 'pro',
    status: overrides.status ?? 'active',
    cycle_quota_limit: overrides.cycle_quota_limit ?? 600,
    cycle_quota_used: overrides.cycle_quota_used ?? 3,
    cycle_quota_remaining: overrides.cycle_quota_remaining ?? 597,
    cycle_end: overrides.cycle_end ?? '2026-04-16T10:02:35Z',
  },
});

describe('ApertisCodingPlanQuotaChecker', () => {
  const setFetchMock = (impl: (...args: any[]) => Promise<Response>): void => {
    global.fetch = vi.fn(impl) as unknown as typeof fetch;
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('is registered under apertis-coding-plan', () => {
    expect(QuotaCheckerFactory.isRegistered('apertis-coding-plan')).toBe(true);
  });

  it('queries the default endpoint with Bearer token auth', async () => {
    let capturedUrl: string | undefined;
    let capturedAuth: string | undefined;

    setFetchMock(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      const headers = new Headers(init?.headers);
      capturedAuth = headers.get('Authorization') ?? undefined;

      return new Response(JSON.stringify(makeSubscriptionResponse()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const checker = new ApertisCodingPlanQuotaChecker(makeConfig());
    await checker.checkQuota();

    expect(capturedUrl).toBe('https://api.apertis.ai/v1/dashboard/billing/credits');
    expect(capturedAuth).toBe('Bearer apertis-api-key');
  });

  it('uses a custom endpoint when provided', async () => {
    let capturedUrl: string | undefined;

    setFetchMock(async (input: RequestInfo | URL) => {
      capturedUrl = String(input);
      return new Response(JSON.stringify(makeSubscriptionResponse()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const checker = new ApertisCodingPlanQuotaChecker(
      makeConfig({ endpoint: 'https://custom.example.com/billing' })
    );
    await checker.checkQuota();

    expect(capturedUrl).toBe('https://custom.example.com/billing');
  });

  it('returns subscription quota as monthly window', async () => {
    setFetchMock(async () => {
      return new Response(
        JSON.stringify(
          makeSubscriptionResponse({
            plan_type: 'pro',
            cycle_quota_limit: 600,
            cycle_quota_used: 3,
            cycle_quota_remaining: 597,
            cycle_end: '2026-04-16T10:02:35Z',
          })
        ),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });

    const checker = new ApertisCodingPlanQuotaChecker(makeConfig());
    const result = await checker.checkQuota();

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.windows).toHaveLength(1);

    const window = result.windows?.[0];
    expect(window?.windowType).toBe('monthly');
    expect(window?.unit).toBe('requests');
    expect(window?.limit).toBe(600);
    expect(window?.used).toBe(3);
    expect(window?.remaining).toBe(597);
    expect(window?.resetsAt).toEqual(new Date('2026-04-16T10:02:35Z'));
    expect(window?.description).toBe('Apertis pro plan');
  });

  it('handles different plan types', async () => {
    setFetchMock(async () => {
      return new Response(
        JSON.stringify(
          makeSubscriptionResponse({
            plan_type: 'lite',
            cycle_quota_limit: 100,
            cycle_quota_used: 50,
            cycle_quota_remaining: 50,
          })
        ),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });

    const checker = new ApertisCodingPlanQuotaChecker(makeConfig());
    const result = await checker.checkQuota();

    expect(result.success).toBe(true);
    expect(result.windows?.[0]?.description).toBe('Apertis lite plan');
    expect(result.windows?.[0]?.limit).toBe(100);
    expect(result.windows?.[0]?.used).toBe(50);
    expect(result.windows?.[0]?.remaining).toBe(50);
  });

  it('returns error when no subscription exists', async () => {
    setFetchMock(async () => {
      return new Response(
        JSON.stringify({
          object: 'billing_credits',
          is_subscriber: false,
          payg: {
            remaining_usd: 5.0,
            used_usd: 2.0,
            total_usd: 7.0,
            is_unlimited: false,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });

    const checker = new ApertisCodingPlanQuotaChecker(makeConfig());
    const result = await checker.checkQuota();

    expect(result.success).toBe(false);
    expect(result.error).toContain('No active subscription found');
  });

  it('returns error for non-200 HTTP response', async () => {
    setFetchMock(
      async () => new Response('unauthorized', { status: 401, statusText: 'Unauthorized' })
    );

    const checker = new ApertisCodingPlanQuotaChecker(makeConfig());
    const result = await checker.checkQuota();

    expect(result.success).toBe(false);
    expect(result.error).toContain('HTTP 401: Unauthorized');
  });

  it('returns error when response object is not billing_credits', async () => {
    setFetchMock(async () => {
      return new Response(JSON.stringify({ object: 'error', message: 'Invalid request' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const checker = new ApertisCodingPlanQuotaChecker(makeConfig());
    const result = await checker.checkQuota();

    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid response: expected billing_credits object');
  });

  it('returns error when subscription data is missing', async () => {
    setFetchMock(async () => {
      return new Response(
        JSON.stringify({
          object: 'billing_credits',
          is_subscriber: true,
          payg: {
            remaining_usd: 0,
            used_usd: 0,
            total_usd: 0,
            is_unlimited: false,
          },
          // subscription is missing
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });

    const checker = new ApertisCodingPlanQuotaChecker(makeConfig());
    const result = await checker.checkQuota();

    expect(result.success).toBe(false);
    expect(result.error).toContain('No active subscription found');
  });

  it('returns error when cycle data contains invalid numbers', async () => {
    setFetchMock(async () => {
      return new Response(
        JSON.stringify(
          makeSubscriptionResponse({
            cycle_quota_limit: NaN,
            cycle_quota_used: 3,
            cycle_quota_remaining: 597,
          })
        ),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });

    const checker = new ApertisCodingPlanQuotaChecker(makeConfig());
    const result = await checker.checkQuota();

    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid cycle data');
  });

  it('returns error when fetch throws a network error', async () => {
    setFetchMock(async () => {
      throw new Error('network failure');
    });

    const checker = new ApertisCodingPlanQuotaChecker(makeConfig());
    const result = await checker.checkQuota();

    expect(result.success).toBe(false);
    expect(result.error).toContain('network failure');
  });
});
