import { beforeEach, describe, expect, it, mock } from 'bun:test';
import type { QuotaCheckerConfig } from '../../../../types/quota';
import { KiloQuotaChecker } from '../kilo-checker';
import { QuotaCheckerFactory } from '../../quota-checker-factory';

const makeConfig = (
  options: Record<string, unknown> = {}
): QuotaCheckerConfig => ({
  id: 'kilo-test',
  provider: 'kilo',
  type: 'kilo',
  enabled: true,
  intervalMinutes: 30,
  options: {
    apiKey: 'kilo-api-key',
    ...options,
  },
});

describe('KiloQuotaChecker', () => {
  const setFetchMock = (impl: (...args: any[]) => Promise<Response>): void => {
    global.fetch = mock(impl) as unknown as typeof fetch;
  };

  beforeEach(() => {
    mock.restore();
  });

  it('is registered under kilo', () => {
    expect(QuotaCheckerFactory.isRegistered('kilo')).toBe(true);
  });

  it('queries balance endpoint and maps balance to subscription dollars window', async () => {
    let capturedUrl: string | undefined;
    let capturedAuth: string | undefined;

    setFetchMock(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      const headers = new Headers(init?.headers);
      capturedAuth = headers.get('Authorization') ?? undefined;

      return new Response(JSON.stringify({ balance: 42.5 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const checker = new KiloQuotaChecker(makeConfig());
    const result = await checker.checkQuota();

    expect(capturedUrl).toBe('https://api.kilo.ai/api/profile/balance');
    expect(capturedAuth).toBe('Bearer kilo-api-key');

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.windows).toHaveLength(1);
    expect(result.windows?.[0]?.windowType).toBe('subscription');
    expect(result.windows?.[0]?.unit).toBe('dollars');
    expect(result.windows?.[0]?.remaining).toBe(42.5);
    expect(result.windows?.[0]?.description).toBe('Kilo account balance');
  });

  it('sends x-kilocode-organizationid when organizationId option is set', async () => {
    let orgHeader: string | undefined;

    setFetchMock(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      orgHeader = headers.get('x-kilocode-organizationid') ?? undefined;

      return new Response(JSON.stringify({ balance: 12 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const checker = new KiloQuotaChecker(makeConfig({ organizationId: 'org-123' }));
    const result = await checker.checkQuota();

    expect(orgHeader).toBe('org-123');
    expect(result.success).toBe(true);
  });

  it('returns error for non-200 response', async () => {
    setFetchMock(async () => new Response('unauthorized', { status: 401, statusText: 'Unauthorized' }));

    const checker = new KiloQuotaChecker(makeConfig());
    const result = await checker.checkQuota();

    expect(result.success).toBe(false);
    expect(result.error).toContain('HTTP 401: Unauthorized');
  });

  it('returns error when balance is not numeric', async () => {
    setFetchMock(async () => {
      return new Response(JSON.stringify({ balance: 'not-a-number' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const checker = new KiloQuotaChecker(makeConfig());
    const result = await checker.checkQuota();

    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid balance received: not-a-number');
  });
});
