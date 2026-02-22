import { beforeEach, describe, expect, it, mock } from 'bun:test';
import type { QuotaCheckerConfig } from '../../../../types/quota';
import { MiniMaxCodingQuotaChecker } from '../minimax-coding-checker';
import { QuotaCheckerFactory } from '../../quota-checker-factory';

const makeConfig = (options: Record<string, unknown> = {}): QuotaCheckerConfig => ({
  id: 'minimax-coding-test',
  provider: 'minimax',
  type: 'minimax-coding',
  enabled: true,
  intervalMinutes: 30,
  options: {
    apiKey: 'test-api-key',
    ...options,
  },
});

const makeSuccessResponse = (
  overrides: Partial<{
    current_interval_total_count: number;
    current_interval_usage_count: number;
    end_time: number;
  }> = {}
) => ({
  model_remains: [
    {
      start_time: 1700000000000,
      end_time: overrides.end_time ?? 1700086400000,
      remains_time: 86400,
      current_interval_total_count: overrides.current_interval_total_count ?? 1000,
      // NOTE: this field name is misleading - it is REMAINING, not used
      current_interval_usage_count: overrides.current_interval_usage_count ?? 750,
      model_name: 'MiniMax-Text-01',
    },
  ],
  base_resp: {
    status_code: 0,
    status_msg: 'success',
  },
});

describe('MiniMaxCodingQuotaChecker', () => {
  const setFetchMock = (impl: (...args: any[]) => Promise<Response>): void => {
    global.fetch = mock(impl) as unknown as typeof fetch;
  };

  beforeEach(() => {
    mock.restore();
  });

  it('is registered under minimax-coding', () => {
    expect(QuotaCheckerFactory.isRegistered('minimax-coding')).toBe(true);
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

    const checker = new MiniMaxCodingQuotaChecker(makeConfig({ apiKey: 'my-api-key' }));
    await checker.checkQuota();

    expect(capturedUrl).toBe('https://www.minimax.io/v1/api/openplatform/coding_plan/remains');
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

    const checker = new MiniMaxCodingQuotaChecker(
      makeConfig({ endpoint: 'https://custom.example.com/quota' })
    );
    await checker.checkQuota();

    expect(capturedUrl).toBe('https://custom.example.com/quota');
  });

  it('maps current_interval_usage_count as remaining and calculates used = limit - remaining', async () => {
    setFetchMock(
      async () =>
        new Response(
          JSON.stringify(
            makeSuccessResponse({
              current_interval_total_count: 1000,
              current_interval_usage_count: 750, // this is remaining (misleading field name)
            })
          ),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
    );

    const checker = new MiniMaxCodingQuotaChecker(makeConfig());
    const result = await checker.checkQuota();

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.windows).toHaveLength(1);

    const window = result.windows?.[0];
    expect(window?.windowType).toBe('custom');
    expect(window?.unit).toBe('requests');
    expect(window?.limit).toBe(1000);
    expect(window?.remaining).toBe(750);
    expect(window?.used).toBe(250); // 1000 - 750
    expect(window?.description).toBe('Coding plan');
  });

  it('sets resetsAt from end_time on the first model entry', async () => {
    const endTime = 17000864000;

    setFetchMock(
      async () =>
        new Response(JSON.stringify(makeSuccessResponse({ end_time: endTime })), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
    );

    const checker = new MiniMaxCodingQuotaChecker(makeConfig());
    const result = await checker.checkQuota();

    expect(result.success).toBe(true);
    const window = result.windows?.[0];
    expect(window?.resetsAt).toEqual(new Date(endTime));
  });

  it('returns an empty windows array when model_remains is empty', async () => {
    setFetchMock(
      async () =>
        new Response(
          JSON.stringify({
            model_remains: [],
            base_resp: { status_code: 0, status_msg: 'success' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
    );

    const checker = new MiniMaxCodingQuotaChecker(makeConfig());
    const result = await checker.checkQuota();

    expect(result.success).toBe(true);
    expect(result.windows).toHaveLength(0);
  });

  it('uses only the first model entry (all models share same quota pool)', async () => {
    setFetchMock(
      async () =>
        new Response(
          JSON.stringify({
            model_remains: [
              {
                start_time: 1700000000,
                end_time: 1700086400000,
                remains_time: 86400,
                current_interval_total_count: 1000,
                current_interval_usage_count: 800,
                model_name: 'MiniMax-Text-01',
              },
              {
                start_time: 1700000000000,
                end_time: 1700086400000,
                remains_time: 86400,
                current_interval_total_count: 1000,
                current_interval_usage_count: 800,
                model_name: 'MiniMax-Code-01',
              },
            ],
            base_resp: { status_code: 0, status_msg: 'success' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
    );

    const checker = new MiniMaxCodingQuotaChecker(makeConfig());
    const result = await checker.checkQuota();

    expect(result.success).toBe(true);
    // Only one window despite two model entries
    expect(result.windows).toHaveLength(1);
    expect(result.windows?.[0]?.limit).toBe(1000);
  });

  it('returns error for non-200 HTTP response', async () => {
    setFetchMock(async () => new Response('forbidden', { status: 403, statusText: 'Forbidden' }));

    const checker = new MiniMaxCodingQuotaChecker(makeConfig());
    const result = await checker.checkQuota();

    expect(result.success).toBe(false);
    expect(result.error).toContain('HTTP 403: Forbidden');
  });

  it('returns error when base_resp.status_code is non-zero', async () => {
    setFetchMock(
      async () =>
        new Response(
          JSON.stringify({
            model_remains: [],
            base_resp: { status_code: 1002, status_msg: 'invalid api key' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
    );

    const checker = new MiniMaxCodingQuotaChecker(makeConfig());
    const result = await checker.checkQuota();

    expect(result.success).toBe(false);
    expect(result.error).toContain('MiniMax API error: invalid api key');
  });

  it('returns error with fallback message when base_resp.status_msg is absent', async () => {
    setFetchMock(
      async () =>
        new Response(
          JSON.stringify({
            model_remains: [],
            base_resp: { status_code: 500 },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
    );

    const checker = new MiniMaxCodingQuotaChecker(makeConfig());
    const result = await checker.checkQuota();

    expect(result.success).toBe(false);
    expect(result.error).toContain('unknown error');
  });

  it('returns error when fetch throws a network error', async () => {
    setFetchMock(async () => {
      throw new Error('network failure');
    });

    const checker = new MiniMaxCodingQuotaChecker(makeConfig());
    const result = await checker.checkQuota();

    expect(result.success).toBe(false);
    expect(result.error).toContain('network failure');
  });
});
