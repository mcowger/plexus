import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMeterContext, isCheckerRegistered } from '../../checker-registry';
import checkerDef from '../kimi-code-checker';

const makeCtx = (options: Record<string, unknown> = {}) =>
  createMeterContext('kimi-code-test', 'kimi', { apiKey: 'test-api-key', ...options });

const makeSuccessResponse = (
  overrides: {
    usage?: { limit: string; used: string; remaining: string; resetTime: string };
    limits?: Array<{
      window: { duration: number; timeUnit: string };
      detail: { limit: string; remaining: string; resetTime: string };
    }>;
  } = {}
) => ({
  usage: overrides.usage ?? {
    limit: '1000',
    used: '250',
    remaining: '750',
    resetTime: '2024-12-31T00:00:00Z',
  },
  limits: overrides.limits ?? [
    {
      window: { duration: 5, timeUnit: 'TIME_UNIT_HOUR' },
      detail: { limit: '100', remaining: '80', resetTime: '2024-12-31T00:00:00Z' },
    },
  ],
});

describe('kimi-code checker', () => {
  const setFetchMock = (impl: (...args: unknown[]) => Promise<Response>): void => {
    global.fetch = vi.fn(impl) as unknown as typeof fetch;
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('is registered under kimi-code', () => {
    expect(isCheckerRegistered('kimi-code')).toBe(true);
  });

  it('queries the default endpoint with Bearer token auth', async () => {
    let capturedUrl: string | undefined;
    let capturedAuth: string | undefined;

    setFetchMock(async (input: unknown, init: unknown) => {
      capturedUrl = String(input as string);
      capturedAuth =
        new Headers((init as RequestInit | undefined)?.headers).get('Authorization') ?? undefined;
      return new Response(JSON.stringify(makeSuccessResponse()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    await checkerDef.check(makeCtx({ apiKey: 'my-api-key' }));

    expect(capturedUrl).toBe('https://api.kimi.com/coding/v1/usages');
    expect(capturedAuth).toBe('Bearer my-api-key');
  });

  it('uses a custom endpoint when provided', async () => {
    let capturedUrl: string | undefined;

    setFetchMock(async (input: unknown) => {
      capturedUrl = String(input as string);
      return new Response(JSON.stringify(makeSuccessResponse()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    await checkerDef.check(makeCtx({ endpoint: 'https://custom.example.com/quota' }));

    expect(capturedUrl).toBe('https://custom.example.com/quota');
  });

  it('parses usage window correctly', async () => {
    setFetchMock(
      async () =>
        new Response(
          JSON.stringify(
            makeSuccessResponse({
              usage: {
                limit: '1000',
                used: '250',
                remaining: '750',
                resetTime: '2024-12-31T00:00:00Z',
              },
              limits: [],
            })
          ),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
    );

    const meters = await checkerDef.check(makeCtx());

    expect(meters).toHaveLength(1);
    const m = meters[0]!;
    expect(m.kind).toBe('allowance');
    expect(m.unit).toBe('requests');
    expect(m.limit).toBe(1000);
    expect(m.used).toBe(250);
    expect(m.remaining).toBe(750);
    expect(m.label).toBe('Usage limit');
  });

  it('parses limits array and creates meters for each entry', async () => {
    const resetTime = '2024-12-31T05:00:00Z';

    setFetchMock(
      async () =>
        new Response(
          JSON.stringify({
            limits: [
              {
                window: { duration: 5, timeUnit: 'TIME_UNIT_HOUR' },
                detail: { limit: '100', remaining: '80', resetTime },
              },
              {
                window: { duration: 1, timeUnit: 'TIME_UNIT_DAY' },
                detail: { limit: '500', remaining: '400', resetTime },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
    );

    const meters = await checkerDef.check(makeCtx());

    expect(meters).toHaveLength(2);
    expect(meters[0]?.limit).toBe(100);
    expect(meters[0]?.remaining).toBe(80);
    expect(meters[0]?.used).toBe(20);
    expect(meters[0]?.periodValue).toBe(5);
    expect(meters[0]?.periodUnit).toBe('hour');
    expect(meters[1]?.limit).toBe(500);
    expect(meters[1]?.remaining).toBe(400);
    expect(meters[1]?.used).toBe(100);
    expect(meters[1]?.periodValue).toBe(1);
    expect(meters[1]?.periodUnit).toBe('day');
  });

  it('returns both usage and limits meters when both are present', async () => {
    setFetchMock(
      async () =>
        new Response(JSON.stringify(makeSuccessResponse()), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
    );

    const meters = await checkerDef.check(makeCtx());

    expect(meters).toHaveLength(2);
    expect(meters[0]?.label).toBe('Usage limit');
    expect(meters[1]?.label).toBe('Rate limit');
  });

  it('returns empty meters when response has no usage and no limits', async () => {
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

  it('skips limit entries that have no detail field', async () => {
    setFetchMock(
      async () =>
        new Response(
          JSON.stringify({
            limits: [
              { window: { duration: 5, timeUnit: 'TIME_UNIT_HOUR' } },
              {
                window: { duration: 1, timeUnit: 'TIME_UNIT_DAY' },
                detail: { limit: '500', remaining: '400', resetTime: '2024-12-31T00:00:00Z' },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
    );

    const meters = await checkerDef.check(makeCtx());

    expect(meters).toHaveLength(1);
    expect(meters[0]?.periodUnit).toBe('day');
  });

  it('throws for non-200 HTTP response', async () => {
    setFetchMock(
      async () => new Response('Unauthorized', { status: 401, statusText: 'Unauthorized' })
    );

    await expect(checkerDef.check(makeCtx())).rejects.toThrow('HTTP 401: Unauthorized');
  });

  it('throws when fetch throws a network error', async () => {
    setFetchMock(async () => {
      throw new Error('network timeout');
    });

    await expect(checkerDef.check(makeCtx())).rejects.toThrow('network timeout');
  });

  it('throws when apiKey option is missing', async () => {
    const ctx = createMeterContext('no-key', 'kimi', {});
    await expect(checkerDef.check(ctx)).rejects.toThrow("Required option 'apiKey' not provided");
  });

  describe('period resolution from window duration', () => {
    const periodFor = async (
      duration: number,
      timeUnit: string
    ): Promise<{ periodValue?: number; periodUnit?: string; periodCycle?: string }> => {
      setFetchMock(
        async () =>
          new Response(
            JSON.stringify({
              limits: [
                {
                  window: { duration, timeUnit },
                  detail: { limit: '100', remaining: '50', resetTime: '2024-12-31T00:00:00Z' },
                },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
      );

      const meters = await checkerDef.check(makeCtx());
      const m = meters[0];
      return {
        periodValue: m?.periodValue,
        periodUnit: m?.periodUnit,
        periodCycle: m?.periodCycle,
      };
    };

    it('maps 5 TIME_UNIT_HOUR to 5h rolling', async () => {
      const p = await periodFor(5, 'TIME_UNIT_HOUR');
      expect(p.periodValue).toBe(5);
      expect(p.periodUnit).toBe('hour');
      expect(p.periodCycle).toBe('rolling');
    });

    it('maps 1 TIME_UNIT_HOUR to 1h fixed', async () => {
      const p = await periodFor(1, 'TIME_UNIT_HOUR');
      expect(p.periodValue).toBe(1);
      expect(p.periodUnit).toBe('hour');
    });

    it('maps 1 TIME_UNIT_DAY to 1 day fixed', async () => {
      const p = await periodFor(1, 'TIME_UNIT_DAY');
      expect(p.periodValue).toBe(1);
      expect(p.periodUnit).toBe('day');
    });

    it('maps 7 TIME_UNIT_DAY to 7d rolling', async () => {
      const p = await periodFor(7, 'TIME_UNIT_DAY');
      expect(p.periodValue).toBe(7);
      expect(p.periodUnit).toBe('day');
      expect(p.periodCycle).toBe('rolling');
    });

    it('maps large duration to monthly', async () => {
      const p = await periodFor(30, 'TIME_UNIT_DAY');
      expect(p.periodUnit).toBe('month');
    });
  });
});
