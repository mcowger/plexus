import { beforeEach, describe, expect, it, mock } from 'bun:test';
import type { QuotaCheckerConfig } from '../../../../types/quota';
import { SyntheticQuotaChecker } from '../synthetic-checker';
import { QuotaCheckerFactory } from '../../quota-checker-factory';

const makeConfig = (options: Record<string, unknown> = {}): QuotaCheckerConfig => ({
  id: 'synthetic-test',
  provider: 'synthetic',
  type: 'synthetic',
  enabled: true,
  intervalMinutes: 30,
  options: {
    apiKey: 'synthetic-api-key',
    ...options,
  },
});

describe('SyntheticQuotaChecker', () => {
  const setFetchMock = (impl: (...args: any[]) => Promise<Response>): void => {
    global.fetch = mock(impl) as unknown as typeof fetch;
  };

  beforeEach(() => {
    mock.restore();
  });

  it('is registered under synthetic', () => {
    expect(QuotaCheckerFactory.isRegistered('synthetic')).toBe(true);
  });

  it('maps rollingFiveHourLimit to rolling_five_hour window', async () => {
    setFetchMock(
      async () =>
        new Response(
          JSON.stringify({
            rollingFiveHourLimit: { remaining: 30, max: 100, nextTickAt: '2026-04-10T12:00:00Z' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
    );

    const result = await new SyntheticQuotaChecker(makeConfig()).checkQuota();

    expect(result.success).toBe(true);
    const w = result.windows?.find((w) => w.windowType === 'rolling_five_hour');
    expect(w).toBeDefined();
    expect(w?.remaining).toBe(30);
    expect(w?.limit).toBe(100);
    expect(w?.used).toBe(70);
    expect(w?.unit).toBe('requests');
    expect(w?.description).toBe('Rolling 5-hour limit');
  });

  it('maps weeklyTokenLimit dollar strings to rolling_weekly window', async () => {
    setFetchMock(
      async () =>
        new Response(
          JSON.stringify({
            weeklyTokenLimit: {
              maxCredits: '$50.00',
              remainingCredits: '$20.00',
              nextRegenAt: '2026-04-17T00:00:00Z',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
    );

    const result = await new SyntheticQuotaChecker(makeConfig()).checkQuota();

    expect(result.success).toBe(true);
    const w = result.windows?.find((w) => w.windowType === 'rolling_weekly');
    expect(w).toBeDefined();
    expect(w?.limit).toBeCloseTo(50);
    expect(w?.remaining).toBeCloseTo(20);
    expect(w?.used).toBeCloseTo(30);
    expect(w?.unit).toBe('dollars');
    expect(w?.description).toBe('Weekly token credits');
  });

  it('handles weeklyTokenLimit with dollar-sign-less credit strings', async () => {
    setFetchMock(
      async () =>
        new Response(
          JSON.stringify({
            weeklyTokenLimit: { maxCredits: '100', remainingCredits: '40' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
    );

    const result = await new SyntheticQuotaChecker(makeConfig()).checkQuota();
    const w = result.windows?.find((w) => w.windowType === 'rolling_weekly');
    expect(w?.limit).toBeCloseTo(100);
    expect(w?.remaining).toBeCloseTo(40);
    expect(w?.used).toBeCloseTo(60);
  });

  it('omits rolling_weekly window when credit strings are unparseable', async () => {
    setFetchMock(
      async () =>
        new Response(
          JSON.stringify({
            weeklyTokenLimit: { maxCredits: 'N/A', remainingCredits: 'N/A' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
    );

    const result = await new SyntheticQuotaChecker(makeConfig()).checkQuota();
    // Window is created but limit/used are undefined — treated as no useful data
    const w = result.windows?.find((w) => w.windowType === 'rolling_weekly');
    expect(w?.limit).toBeUndefined();
    expect(w?.used).toBeUndefined();
  });

  it('maps search hourly window when present', async () => {
    setFetchMock(
      async () =>
        new Response(
          JSON.stringify({
            search: {
              hourly: { limit: 50, requests: 10, remaining: 40, renewsAt: '2026-04-10T13:00:00Z' },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
    );

    const result = await new SyntheticQuotaChecker(makeConfig()).checkQuota();
    const w = result.windows?.find((w) => w.windowType === 'search');
    expect(w).toBeDefined();
    expect(w?.limit).toBe(50);
    expect(w?.remaining).toBe(40);
    expect(w?.unit).toBe('requests');
  });

  it('returns success with empty windows when response has no known fields', async () => {
    setFetchMock(
      async () =>
        new Response(JSON.stringify({}), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
    );

    const result = await new SyntheticQuotaChecker(makeConfig()).checkQuota();
    expect(result.success).toBe(true);
    expect(result.windows).toHaveLength(0);
  });

  it('returns error for non-200 response', async () => {
    setFetchMock(
      async () => new Response('unauthorized', { status: 401, statusText: 'Unauthorized' })
    );

    const result = await new SyntheticQuotaChecker(makeConfig()).checkQuota();
    expect(result.success).toBe(false);
    expect(result.error).toContain('HTTP 401: Unauthorized');
  });

  it('sends Authorization header with api key', async () => {
    let capturedAuth: string | undefined;

    setFetchMock(async (_input, init) => {
      capturedAuth = new Headers(init?.headers).get('Authorization') ?? undefined;
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    await new SyntheticQuotaChecker(makeConfig()).checkQuota();
    expect(capturedAuth).toBe('Bearer synthetic-api-key');
  });
});
