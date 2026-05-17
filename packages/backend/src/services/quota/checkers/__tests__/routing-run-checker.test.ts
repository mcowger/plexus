import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerSpy } from '../../../../../test/test-utils';
import { createMeterContext, isCheckerRegistered } from '../../checker-registry';
import checkerDef from '../routing-run-checker';

const fixedNow = Date.UTC(2026, 4, 17, 10, 23, 45, 678);

const baseResponse = () => ({
  requests_used_today: 30,
  requests_limit_today: 100,
  requests_remaining: 70,
  requests_used_this_hour: 5,
  requests_limit_this_hour: 20,
  requests_remaining_this_hour: 15,
  requests_used_this_minute: 1,
  requests_limit_per_minute: 10,
  requests_remaining_this_minute: 9,
  plan_tier: 'premium',
});

const makeCtx = (options: Record<string, unknown> = {}) =>
  createMeterContext('routing-run-test', 'routing-run', { apiKey: 'test-key', ...options });

const makeCtxWithoutApiKey = () => createMeterContext('routing-run-test', 'routing-run', {});

describe('routing-run checker', () => {
  const setFetchMock = (impl: (...args: unknown[]) => Promise<Response>): void => {
    global.fetch = vi.fn(impl) as unknown as typeof fetch;
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    registerSpy(Date, 'now').mockReturnValue(fixedNow);
  });

  it('is registered under routing-run', () => {
    expect(isCheckerRegistered('routing-run')).toBe(true);
  });

  it('maps premium-like response to daily, hourly, and minute meters', async () => {
    setFetchMock(
      async () =>
        new Response(JSON.stringify(baseResponse()), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
    );

    const meters = await checkerDef.check(makeCtx());

    expect(meters).toHaveLength(3);
    expect(meters.map((m) => m.key)).toEqual(['daily', 'hourly', 'minute']);
    expect(meters[0]).toMatchObject({
      label: 'Daily request quota',
      kind: 'allowance',
      unit: 'requests',
      limit: 100,
      used: 30,
      remaining: 70,
      periodValue: 1,
      periodUnit: 'day',
      periodCycle: 'fixed',
      resetsAt: '2026-05-18T00:00:00.000Z',
    });
    expect(meters[1]).toMatchObject({
      label: 'Hourly request quota',
      unit: 'requests',
      limit: 20,
      used: 5,
      remaining: 15,
      periodUnit: 'hour',
      periodCycle: 'fixed',
      resetsAt: '2026-05-17T11:00:00.000Z',
    });
    expect(meters[2]).toMatchObject({
      label: 'Per-minute request limit',
      unit: 'requests',
      limit: 10,
      used: 1,
      remaining: 9,
      periodUnit: 'minute',
      periodCycle: 'rolling',
      resetsAt: '2026-05-17T10:24:45.678Z',
    });
  });

  it('omits hourly meter for lite response with zero hourly limit', async () => {
    setFetchMock(
      async () =>
        new Response(JSON.stringify({ ...baseResponse(), requests_limit_this_hour: 0 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
    );

    const meters = await checkerDef.check(makeCtx());

    expect(meters).toHaveLength(2);
    expect(meters.map((m) => m.key)).toEqual(['daily', 'minute']);
    expect(meters.find((m) => m.key === 'hourly')).toBeUndefined();
  });

  it('daily meter uses top-level requests_remaining', async () => {
    setFetchMock(
      async () =>
        new Response(JSON.stringify({ ...baseResponse(), requests_remaining_today: 999 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
    );

    const meters = await checkerDef.check(makeCtx());

    expect(meters.find((m) => m.key === 'daily')?.remaining).toBe(70);
  });

  it('minute meter uses requests_limit_per_minute', async () => {
    setFetchMock(
      async () =>
        new Response(JSON.stringify({ ...baseResponse(), requests_limit_this_minute: 999 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
    );

    const meters = await checkerDef.check(makeCtx());

    expect(meters.find((m) => m.key === 'minute')?.limit).toBe(10);
  });

  it('sets request units, periods, cycles, and finite ISO reset times on each meter', async () => {
    setFetchMock(
      async () =>
        new Response(JSON.stringify(baseResponse()), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
    );

    const meters = await checkerDef.check(makeCtx());

    expect(
      meters.map(({ key, unit, periodUnit, periodCycle }) => ({
        key,
        unit,
        periodUnit,
        periodCycle,
      }))
    ).toEqual([
      { key: 'daily', unit: 'requests', periodUnit: 'day', periodCycle: 'fixed' },
      { key: 'hourly', unit: 'requests', periodUnit: 'hour', periodCycle: 'fixed' },
      { key: 'minute', unit: 'requests', periodUnit: 'minute', periodCycle: 'rolling' },
    ]);
    for (const meter of meters) {
      expect(meter.resetsAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(Number.isFinite(Date.parse(meter.resetsAt!))).toBe(true);
    }
  });

  it('marks exhausted meters as exhausted with high numeric utilization', async () => {
    setFetchMock(
      async () =>
        new Response(
          JSON.stringify({
            requests_used_today: 100,
            requests_limit_today: 100,
            requests_remaining: 0,
            requests_used_this_hour: 20,
            requests_limit_this_hour: 20,
            requests_remaining_this_hour: 0,
            requests_used_this_minute: 10,
            requests_limit_per_minute: 10,
            requests_remaining_this_minute: 0,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
    );

    const meters = await checkerDef.check(makeCtx());

    for (const meter of meters) {
      expect(typeof meter.utilizationPercent).toBe('number');
      expect(meter.utilizationPercent).toBeGreaterThanOrEqual(99);
      expect(meter.status).toBe('exhausted');
    }
  });

  it('sends Authorization bearer header', async () => {
    let capturedHeaders: Headers | undefined;

    setFetchMock(async (_input: unknown, init: unknown) => {
      capturedHeaders = new Headers((init as RequestInit | undefined)?.headers);
      return new Response(JSON.stringify(baseResponse()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    await checkerDef.check(makeCtx());

    expect(capturedHeaders!.get('Authorization')).toBe('Bearer test-key');
    expect(capturedHeaders!.get('Accept')).toBe('application/json');
  });

  it('uses custom endpoint exactly', async () => {
    let capturedUrl: string | undefined;

    setFetchMock(async (input: unknown) => {
      capturedUrl = String(input as string);
      return new Response(JSON.stringify(baseResponse()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    await checkerDef.check(makeCtx({ endpoint: 'https://example.routing.run/custom/requests' }));

    expect(capturedUrl).toBe('https://example.routing.run/custom/requests');
  });

  it.each([
    [401, 'unauthorized'],
    [429, 'too many requests'],
    [500, 'server exploded'],
  ])('throws status and body text for HTTP %s', async (status, body) => {
    setFetchMock(async () => new Response(body, { status, statusText: 'ignored status text' }));

    await expect(checkerDef.check(makeCtx())).rejects.toThrow(`HTTP ${status}: ${body}`);
  });

  it.each([
    ['requests_limit_today', 'not-a-number'],
    ['requests_remaining_this_hour', undefined],
    ['requests_used_this_minute', -1],
  ])('throws for invalid %s value', async (field, value) => {
    const response = { ...baseResponse(), [field]: value };
    if (value === undefined) delete response[field as keyof ReturnType<typeof baseResponse>];

    setFetchMock(
      async () =>
        new Response(JSON.stringify(response), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
    );

    await expect(checkerDef.check(makeCtx())).rejects.toThrow(
      `Invalid ${field} received: ${String(value)}`
    );
  });

  it('throws when apiKey is missing', async () => {
    await expect(checkerDef.check(makeCtxWithoutApiKey())).rejects.toThrow(
      "Required option 'apiKey' not provided"
    );
  });
});
