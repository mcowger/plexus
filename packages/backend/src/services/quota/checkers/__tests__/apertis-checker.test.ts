import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { QuotaCheckerConfig } from '../../../../types/quota';
import { ApertisQuotaChecker } from '../apertis-checker';
import { QuotaCheckerFactory } from '../../quota-checker-factory';

const makeConfig = (options: Record<string, unknown> = {}): QuotaCheckerConfig => ({
  id: 'apertis-test',
  provider: 'apertis',
  type: 'apertis',
  enabled: true,
  intervalMinutes: 30,
  options: {
    apiKey: 'apertis-api-key',
    ...options,
  },
});

const makePaygResponse = (
  overrides: Partial<{
    account_credits: number;
    token_used: number;
    token_total: string | number;
    token_remaining: string | number;
    token_is_unlimited: boolean;
  }> = {}
) => ({
  object: 'billing_credits' as const,
  is_subscriber: false,
  payg: {
    account_credits: overrides.account_credits ?? 24.980973,
    token_used: overrides.token_used ?? 0,
    token_total: overrides.token_total ?? 'unlimited',
    token_remaining: overrides.token_remaining ?? 'unlimited',
    token_is_unlimited: overrides.token_is_unlimited ?? true,
  },
});

describe('ApertisQuotaChecker', () => {
  const setFetchMock = (impl: (...args: any[]) => Promise<Response>): void => {
    global.fetch = vi.fn(impl) as unknown as typeof fetch;
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('is registered under apertis', () => {
    expect(QuotaCheckerFactory.isRegistered('apertis')).toBe(true);
  });

  it('queries the default endpoint with Bearer token auth', async () => {
    let capturedUrl: string | undefined;
    let capturedAuth: string | undefined;

    setFetchMock(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      const headers = new Headers(init?.headers);
      capturedAuth = headers.get('Authorization') ?? undefined;

      return new Response(JSON.stringify(makePaygResponse()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const checker = new ApertisQuotaChecker(makeConfig());
    await checker.checkQuota();

    expect(capturedUrl).toBe('https://api.apertis.ai/v1/dashboard/billing/credits');
    expect(capturedAuth).toBe('Bearer apertis-api-key');
  });

  it('uses a custom endpoint when provided', async () => {
    let capturedUrl: string | undefined;

    setFetchMock(async (input: RequestInfo | URL) => {
      capturedUrl = String(input);
      return new Response(JSON.stringify(makePaygResponse()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const checker = new ApertisQuotaChecker(
      makeConfig({ endpoint: 'https://custom.example.com/billing' })
    );
    await checker.checkQuota();

    expect(capturedUrl).toBe('https://custom.example.com/billing');
  });

  it('returns PAYG balance from account_credits', async () => {
    setFetchMock(async () => {
      return new Response(
        JSON.stringify(
          makePaygResponse({
            account_credits: 24.980973,
            token_used: 0,
            token_total: 'unlimited',
            token_remaining: 'unlimited',
            token_is_unlimited: true,
          })
        ),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });

    const checker = new ApertisQuotaChecker(makeConfig());
    const result = await checker.checkQuota();

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.windows).toHaveLength(1);

    const window = result.windows?.[0];
    expect(window?.windowType).toBe('subscription');
    expect(window?.unit).toBe('dollars');
    expect(window?.limit).toBeUndefined();
    expect(window?.used).toBeUndefined();
    expect(window?.remaining).toBe(24.980973);
    expect(window?.description).toBe('Apertis PAYG balance');
  });

  it('returns error for non-200 HTTP response', async () => {
    setFetchMock(
      async () => new Response('unauthorized', { status: 401, statusText: 'Unauthorized' })
    );

    const checker = new ApertisQuotaChecker(makeConfig());
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

    const checker = new ApertisQuotaChecker(makeConfig());
    const result = await checker.checkQuota();

    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid response: expected billing_credits object');
  });

  it('returns error when account_credits is not a valid number', async () => {
    setFetchMock(async () => {
      return new Response(
        JSON.stringify({
          object: 'billing_credits',
          is_subscriber: false,
          payg: {
            account_credits: NaN,
            token_used: 0,
            token_total: 'unlimited',
            token_remaining: 'unlimited',
            token_is_unlimited: true,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });

    const checker = new ApertisQuotaChecker(makeConfig());
    const result = await checker.checkQuota();

    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid PAYG balance: account_credits is not a valid number');
  });

  it('returns error when fetch throws a network error', async () => {
    setFetchMock(async () => {
      throw new Error('network failure');
    });

    const checker = new ApertisQuotaChecker(makeConfig());
    const result = await checker.checkQuota();

    expect(result.success).toBe(false);
    expect(result.error).toContain('network failure');
  });
});
