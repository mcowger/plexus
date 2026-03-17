import { beforeEach, describe, expect, it, mock } from 'bun:test';
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
    remaining_usd: number | null;
    used_usd: number;
    total_usd: number | null;
  }> = {}
) => ({
  object: 'billing_credits' as const,
  is_subscriber: false,
  payg: {
    remaining_usd: overrides.remaining_usd ?? 5.0,
    used_usd: overrides.used_usd ?? 2.0,
    total_usd: overrides.total_usd ?? 7.0,
  },
});

describe('ApertisQuotaChecker', () => {
  const setFetchMock = (impl: (...args: any[]) => Promise<Response>): void => {
    global.fetch = mock(impl) as unknown as typeof fetch;
  };

  beforeEach(() => {
    mock.restore();
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

  it('returns PAYG balance as subscription window', async () => {
    setFetchMock(async () => {
      return new Response(
        JSON.stringify(
          makePaygResponse({
            remaining_usd: 5.0,
            used_usd: 2.0,
            total_usd: 7.0,
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
    expect(window?.limit).toBe(7.0);
    expect(window?.used).toBe(2.0);
    expect(window?.remaining).toBe(5.0);
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

  it('returns error when PAYG remaining_usd is null', async () => {
    setFetchMock(async () => {
      return new Response(
        JSON.stringify({
          object: 'billing_credits',
          is_subscriber: false,
          payg: {
            remaining_usd: null,
            used_usd: 0,
            total_usd: null,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });

    const checker = new ApertisQuotaChecker(makeConfig());
    const result = await checker.checkQuota();

    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid PAYG balance: remaining_usd is null');
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
