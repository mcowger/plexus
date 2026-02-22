import { beforeEach, describe, expect, it, mock } from 'bun:test';
import type { QuotaCheckerConfig } from '../../../../types/quota';
import { KimiCodeQuotaChecker } from '../kimi-code-checker';
import { QuotaCheckerFactory } from '../../quota-checker-factory';

const makeConfig = (
  options: Record<string, unknown> = {}
): QuotaCheckerConfig => ({
  id: 'kimi-code-test',
  provider: 'kimi',
  type: 'kimi-code',
  enabled: true,
  intervalMinutes: 30,
  options: {
    apiKey: 'test-api-key',
    ...options,
  },
});

const makeSuccessResponse = (overrides: Partial<{
  usage: {
    limit: string;
    used: string;
    remaining: string;
    resetTime: string;
  };
  limits: Array<{
    window: { duration: number; timeUnit: string };
    detail: { limit: string; remaining: string; resetTime: string };
  }>;
}> = {}) => ({
  usage: overrides.usage ?? {
    limit: '1000',
    used: '250',
    remaining: '750',
    resetTime: '2024-12-31T00:00:00Z',
  },
  limits: overrides.limits ?? [
    {
      window: { duration: 5, timeUnit: 'TIME_UNIT_HOUR' },
      detail: {
        limit: '100',
        remaining: '80',
        resetTime: '2024-12-31T00:00:00Z',
      },
    },
  ],
});

describe('KimiCodeQuotaChecker', () => {
  const setFetchMock = (impl: (...args: any[]) => Promise<Response>): void => {
    global.fetch = mock(impl) as unknown as typeof fetch;
  };

  beforeEach(() => {
    mock.restore();
  });

  it('is registered under kimi-code', () => {
    expect(QuotaCheckerFactory.isRegistered('kimi-code')).toBe(true);
  });

  it('queries the default endpoint with Bearer token auth', async () => {
    let capturedUrl: string | undefined;
    let capturedAuth: string | undefined;

    setFetchMock(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      const headers = new Headers(init?.headers);
      capturedAuth = headers.get('Authorization') ?? undefined;

    return new Response(JSON.stringify(makeSuccessResponse()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const checker = new KimiCodeQuotaChecker(makeConfig({ apiKey: 'my-api-key' }));
    await checker.checkQuota();

    expect(capturedUrl).toBe('https://api.kimi.com/coding/v1/usages');
    expect(capturedAuth).toBe('Bearer my-api-key');
  });

  it('uses a custom endpoint when provided', async () => {
    let capturedUrl: string | undefined;

    setFetchMock(async (input: RequestInfo | URL) => {
      capturedUrl = String(input);
      return new Response(JSON.stringify(makeSuccessResponse()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const checker = new KimiCodeQuotaChecker(
      makeConfig({ endpoint: 'https://custom.example.com/quota' })
    );
    await checker.checkQuota();

  expect(capturedUrl).toBe('https://custom.example.com/quota');
  });

  it('parses usage window correctly (string-encoded numbers)', async () => {
    setFetchMock(async () =>
      new Response(
        JSON.stringify(makeSuccessResponse({
          usage: {
          limit: '1000',
            used: '250',
            remaining: '750',
            resetTime: '2024-12-31T00:00:00Z',
          },
          limits: [],
        })),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const checker = new KimiCodeQuotaChecker(makeConfig());
    const result = await checker.checkQuota();

    expect(result.success).toBe(true);
    expect(result.windows).toHaveLength(1);

    const window = result.windows?.[0];
    expect(window?.windowType).toBe('custom');
    expect(window?.unit).toBe('requests');
    expect(window?.limit).toBe(1000);
    expect(window?.used).toBe(250);
    expect(window?.remaining).toBe(750);
    expect(window?.description).toBe('Usage limit');
    expect(window?.resetsAt).toEqual(new Date('2024-12-31T00:00:00Z'));
  });

  it('parses limits array and creates windows for each entry', async () => {
    const resetTime = '2024-12-31T05:00:00Z';

    setFetchMock(async () =>
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

    const checker = new KimiCodeQuotaChecker(makeConfig());
    const result = await checker.checkQuota();

    expect(result.success).toBe(true);
    expect(result.windows).toHaveLength(2);

    const [w0, w1] = result.windows!;
    expect(w0?.windowType).toBe('five_hour');
    expect(w0?.limit).toBe(100);
    expect(w0?.remaining).toBe(80);
    expect(w0?.used).toBe(20); // 100 - 80

  expect(w1?.windowType).toBe('daily');
    expect(w1?.limit).toBe(500);
    expect(w1?.remaining).toBe(400);
    expect(w1?.used).toBe(100); // 500 - 400
  });

  it('returns both usage and limits windows when both are present', async () => {
    setFetchMock(async () =>
      new Response(JSON.stringify(makeSuccessResponse()), {
        status: 200,
     headers: { 'Content-Type': 'application/json' },
      })
    );

    const checker = new KimiCodeQuotaChecker(makeConfig());
    const result = await checker.checkQuota();

    expect(result.success).toBe(true);
    // One from usage + one from limits
    expect(result.windows).toHaveLength(2);
    expect(result.windows?.[0]?.windowType).toBe('custom');
    expect(result.windows?.[1]?.windowType).toBe('five_hour');
  });

  it('returns empty windows when response has no usage and no limits', async () => {
    setFetchMock(async () =>
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const checker = new KimiCodeQuotaChecker(makeConfig());
    const result = await checker.checkQuota();

    expect(result.success).toBe(true);
    expect(result.windows).toHaveLength(0);
  });

  it('skips limit entries that have no detail field', async () => {
    setFetchMock(async () =>
      new Response(
        JSON.stringify({
      limits: [
          { window: { duration: 5, timeUnit: 'TIME_UNIT_HOUR' } }, // no detail
            {
         window: { duration: 1, timeUnit: 'TIME_UNIT_DAY' },
              detail: { limit: '500', remaining: '400', resetTime: '2024-12-31T00:00:00Z' },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );
    const checker = new KimiCodeQuotaChecker(makeConfig());
    const result = await checker.checkQuota();

    expect(result.success).toBe(true);
    expect(result.windows).toHaveLength(1);
    expect(result.windows?.[0]?.windowType).toBe('daily');
  });

  it('returns error for non-200 HTTP response', async () => {
    setFetchMock(async () =>
      new Response('Unauthorized', { status: 401, statusText: 'Unauthorized' })
    );

    const checker = new KimiCodeQuotaChecker(makeConfig());
    const result = await checker.checkQuota();

    expect(result.success).toBe(false);
    expect(result.error).toContain('HTTP 401: Unauthorized');
  });

  it('returns error when fetch throws a network error', async () => {
    setFetchMock(async () => {
      throw new Error('network timeout');
    });

    const checker = new KimiCodeQuotaChecker(makeConfig());
    const result = await checker.checkQuota();

    expect(result.success).toBe(false);
    expect(result.error).toContain('network timeout');
  });

  it('throws when apiKey option is missing', () => {
    const checker = new KimiCodeQuotaChecker({
      id: 'no-key',
      provider: 'kimi',
      type: 'kimi-code',
      enabled: true,
      intervalMinutes: 30,
      options: {},
    });

    expect(checker.checkQuota()).rejects.toThrow("Required option 'apiKey' not provided");
  });

  describe('windowTypeFromDuration', () => {
    const windowTypeFor = async (duration: number, timeUnit: string): Promise<string | undefined> => {
      setFetchMock(async () =>
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

      const checker = new KimiCodeQuotaChecker(makeConfig());
      const result = await checker.checkQuota();
      return result.windows?.[0]?.windowType;
    };

    it('maps 5 TIME_UNIT_HOUR to five_hour', async () => {
      expect(await windowTypeFor(5, 'TIME_UNIT_HOUR')).toBe('five_hour');
    });

    it('maps 60 TIME_UNIT_MINUTE to hourly', async () => {
      expect(await windowTypeFor(60, 'TIME_UNIT_MINUTE')).toBe('hourly');
    });

    it('maps 30 TIME_UNIT_MINUTE to hourly', async () => {
      expect(await windowTypeFor(30, 'TIME_UNIT_MINUTE')).toBe('hourly');
    });

    it('maps 1 TIME_UNIT_HOUR to hourly', async () => {
      expect(await windowTypeFor(1, 'TIME_UNIT_HOUR')).toBe('hourly');
    });

    it('maps 2 TIME_UNIT_HOUR to daily', async () => {
      expect(await windowTypeFor(2, 'TIME_UNIT_HOUR')).toBe('daily');
    });

    it('maps 1 TIME_UNIT_DAY to daily', async () => {
      expect(await windowTypeFor(1, 'TIME_UNIT_DAY')).toBe('daily');
    });

    it('maps 3 TIME_UNIT_DAY to weekly', async () => {
      expect(await windowTypeFor(3, 'TIME_UNIT_DAY')).toBe('weekly');
    });

    it('maps 7 TIME_UNIT_DAY to weekly', async () => {
      expect(await windowTypeFor(7, 'TIME_UNIT_DAY')).toBe('weekly');
    });

    it('maps 8 TIME_UNIT_DAY to monthly', async () => {
      expect(await windowTypeFor(8, 'TIME_UNIT_DAY')).toBe('monthly');
    });

    it('maps 30 TIME_UNIT_DAY to monthly', async () => {
      expect(await windowTypeFor(30, 'TIME_UNIT_DAY')).toBe('monthly');
    });

    it('defaults unknown timeUnit as TIME_UNIT_MINUTE', async () => {
      // Unknown timeUnit: duration stays as-is (minutes). 300 min = five_hour.
      expect(await windowTypeFor(300, 'UNKNOWN_UNIT')).toBe('five_hour');
    });
  });
});
