import { beforeEach, describe, expect, it, mock } from 'bun:test';
import type { QuotaCheckerConfig } from '../../../../types/quota';
import { PoeQuotaChecker } from '../poe-checker';
import { QuotaCheckerFactory } from '../../quota-checker-factory';

const makeConfig = (options: Record<string, unknown> = {}): QuotaCheckerConfig => ({
  id: 'poe-test',
  provider: 'poe',
  type: 'poe',
  enabled: true,
  intervalMinutes: 30,
  options: {
    apiKey: 'poe-api-key',
    ...options,
  },
});

describe('PoeQuotaChecker', () => {
  const setFetchMock = (impl: (...args: any[]) => Promise<Response>): void => {
    global.fetch = mock(impl) as unknown as typeof fetch;
  };

  beforeEach(() => {
    mock.restore();
  });

  it('is registered under poe', () => {
    expect(QuotaCheckerFactory.isRegistered('poe')).toBe(true);
  });

  it('queries balance endpoint and maps current_point_balance to subscription points window', async () => {
    let capturedUrl: string | undefined;
    let capturedAuth: string | undefined;

    setFetchMock(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      const headers = new Headers(init?.headers);
      capturedAuth = headers.get('Authorization') ?? undefined;

      return new Response(JSON.stringify({ current_point_balance: 4948499 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const checker = new PoeQuotaChecker(makeConfig());
    const result = await checker.checkQuota();

    expect(capturedUrl).toBe('https://api.poe.com/usage/current_balance');
    expect(capturedAuth).toBe('Bearer poe-api-key');

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.windows).toHaveLength(1);
    expect(result.windows?.[0]?.windowType).toBe('subscription');
    expect(result.windows?.[0]?.unit).toBe('points');
    expect(result.windows?.[0]?.remaining).toBe(4948499);
    expect(result.windows?.[0]?.description).toBe('POE point balance');
  });

  it('uses custom endpoint when provided', async () => {
    let capturedUrl: string | undefined;

    setFetchMock(async (input: RequestInfo | URL) => {
      capturedUrl = String(input);
      return new Response(JSON.stringify({ current_point_balance: 1000 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const checker = new PoeQuotaChecker(makeConfig({ endpoint: 'https://custom.poe.com/balance' }));
    await checker.checkQuota();

    expect(capturedUrl).toBe('https://custom.poe.com/balance');
  });

  it('returns error for non-200 response', async () => {
    setFetchMock(
      async () => new Response('unauthorized', { status: 401, statusText: 'Unauthorized' })
    );

    const checker = new PoeQuotaChecker(makeConfig());
    const result = await checker.checkQuota();

    expect(result.success).toBe(false);
    expect(result.error).toContain('HTTP 401: Unauthorized');
  });

  it('returns error when balance is not numeric', async () => {
    setFetchMock(async () => {
      return new Response(JSON.stringify({ current_point_balance: 'not-a-number' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const checker = new PoeQuotaChecker(makeConfig());
    const result = await checker.checkQuota();

    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid balance received: not-a-number');
  });
});
