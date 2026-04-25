import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMeterContext, isCheckerRegistered } from '../../checker-registry';
import checkerDef from '../synthetic-checker';

const makeCtx = (options: Record<string, unknown> = {}) =>
  createMeterContext('synthetic-test', 'synthetic', { apiKey: 'synthetic-api-key', ...options });

describe('synthetic checker', () => {
  const setFetchMock = (impl: (...args: unknown[]) => Promise<Response>): void => {
    global.fetch = vi.fn(impl) as unknown as typeof fetch;
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('is registered under synthetic', () => {
    expect(isCheckerRegistered('synthetic')).toBe(true);
  });

  it('maps rollingFiveHourLimit to a 5h rolling allowance meter', async () => {
    setFetchMock(
      async () =>
        new Response(
          JSON.stringify({
            rollingFiveHourLimit: { remaining: 30, max: 100, nextTickAt: '2026-04-10T12:00:00Z' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
    );

    const meters = await checkerDef.check(makeCtx());

    expect(meters).toHaveLength(1);
    const m = meters[0]!;
    expect(m.key).toBe('rolling_5h');
    expect(m.kind).toBe('allowance');
    expect(m.unit).toBe('requests');
    expect(m.remaining).toBe(30);
    expect(m.limit).toBe(100);
    expect(m.used).toBe(70);
    expect(m.periodValue).toBe(5);
    expect(m.periodUnit).toBe('hour');
    expect(m.periodCycle).toBe('rolling');
  });

  it('maps weeklyTokenLimit dollar strings to 7d rolling allowance meter with usd unit', async () => {
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

    const meters = await checkerDef.check(makeCtx());

    expect(meters).toHaveLength(1);
    const m = meters[0]!;
    expect(m.key).toBe('weekly_credits');
    expect(m.unit).toBe('usd');
    expect(m.limit).toBeCloseTo(50);
    expect(m.remaining).toBeCloseTo(20);
    expect(m.used).toBeCloseTo(30);
    expect(m.periodValue).toBe(7);
    expect(m.periodUnit).toBe('day');
    expect(m.periodCycle).toBe('rolling');
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

    const meters = await checkerDef.check(makeCtx());

    const m = meters.find((x) => x.key === 'weekly_credits')!;
    expect(m.limit).toBeCloseTo(100);
    expect(m.remaining).toBeCloseTo(40);
    expect(m.used).toBeCloseTo(60);
  });

  it('omits weekly_credits meter when credit strings are unparseable', async () => {
    setFetchMock(
      async () =>
        new Response(
          JSON.stringify({ weeklyTokenLimit: { maxCredits: 'N/A', remainingCredits: 'N/A' } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
    );

    const meters = await checkerDef.check(makeCtx());

    const m = meters.find((x) => x.key === 'weekly_credits');
    expect(m?.limit).toBeUndefined();
    expect(m?.used).toBeUndefined();
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

    const meters = await checkerDef.check(makeCtx());

    expect(meters).toHaveLength(1);
    const m = meters[0]!;
    expect(m.key).toBe('search_hourly');
    expect(m.unit).toBe('requests');
    expect(m.limit).toBe(50);
    expect(m.remaining).toBe(40);
  });

  it('returns empty meters when response has no known fields', async () => {
    setFetchMock(
      async () =>
        new Response(JSON.stringify({}), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
    );

    const meters = await checkerDef.check(makeCtx());
    expect(meters).toHaveLength(0);
  });

  it('throws for non-200 response', async () => {
    setFetchMock(
      async () => new Response('unauthorized', { status: 401, statusText: 'Unauthorized' })
    );

    await expect(checkerDef.check(makeCtx())).rejects.toThrow('HTTP 401: Unauthorized');
  });

  it('sends Authorization header with api key', async () => {
    let capturedAuth: string | undefined;

    setFetchMock(async (_input: unknown, init: unknown) => {
      capturedAuth =
        new Headers((init as RequestInit | undefined)?.headers).get('Authorization') ?? undefined;
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    await checkerDef.check(makeCtx());
    expect(capturedAuth).toBe('Bearer synthetic-api-key');
  });
});
