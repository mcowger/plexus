import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMeterContext, isCheckerRegistered } from '../../checker-registry';
import checkerDef from '../minimax-coding-checker';

const makeCtx = (options: Record<string, unknown> = {}) =>
  createMeterContext('minimax-coding-test', 'minimax', { apiKey: 'test-api-key', ...options });

const makeSuccessResponse = (
  overrides: {
    current_interval_total_count?: number;
    current_interval_usage_count?: number;
    end_time?: number;
  } = {}
) => ({
  model_remains: [
    {
      start_time: 1700000000000,
      end_time: overrides.end_time ?? 1700086400000,
      remains_time: 86400,
      current_interval_total_count: overrides.current_interval_total_count ?? 1000,
      // NOTE: this field name is misleading — it is REMAINING, not used
      current_interval_usage_count: overrides.current_interval_usage_count ?? 750,
      model_name: 'MiniMax-Text-01',
    },
  ],
  base_resp: { status_code: 0, status_msg: 'success' },
});

describe('minimax-coding checker', () => {
  const setFetchMock = (impl: (...args: unknown[]) => Promise<Response>): void => {
    global.fetch = vi.fn(impl) as unknown as typeof fetch;
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('is registered under minimax-coding', () => {
    expect(isCheckerRegistered('minimax-coding')).toBe(true);
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

    expect(capturedUrl).toBe('https://www.minimax.io/v1/api/openplatform/coding_plan/remains');
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

  it('maps current_interval_usage_count as remaining, calculates used = limit - remaining', async () => {
    setFetchMock(
      async () =>
        new Response(
          JSON.stringify(
            makeSuccessResponse({
              current_interval_total_count: 1000,
              current_interval_usage_count: 750,
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
    expect(m.remaining).toBe(750);
    expect(m.used).toBe(250);
    expect(m.label).toBe('Coding plan');
  });

  it('sets resetsAt from end_time', async () => {
    const endTime = 1700086400000;

    setFetchMock(
      async () =>
        new Response(JSON.stringify(makeSuccessResponse({ end_time: endTime })), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
    );

    const meters = await checkerDef.check(makeCtx());

    expect(meters[0]?.resetsAt).toBe(new Date(endTime).toISOString());
  });

  it('returns an empty meters array when model_remains is empty', async () => {
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

    const meters = await checkerDef.check(makeCtx());

    expect(meters).toHaveLength(0);
  });

  it('uses only the first model entry', async () => {
    setFetchMock(
      async () =>
        new Response(
          JSON.stringify({
            model_remains: [
              {
                start_time: 1700000000000,
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

    const meters = await checkerDef.check(makeCtx());

    expect(meters).toHaveLength(1);
    expect(meters[0]?.limit).toBe(1000);
  });

  it('throws for non-200 HTTP response', async () => {
    setFetchMock(async () => new Response('forbidden', { status: 403, statusText: 'Forbidden' }));

    await expect(checkerDef.check(makeCtx())).rejects.toThrow('HTTP 403: Forbidden');
  });

  it('throws when base_resp.status_code is non-zero', async () => {
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

    await expect(checkerDef.check(makeCtx())).rejects.toThrow('MiniMax API error: invalid api key');
  });

  it('throws with fallback message when base_resp.status_msg is absent', async () => {
    setFetchMock(
      async () =>
        new Response(JSON.stringify({ model_remains: [], base_resp: { status_code: 500 } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
    );

    await expect(checkerDef.check(makeCtx())).rejects.toThrow('unknown error');
  });

  it('throws when fetch throws a network error', async () => {
    setFetchMock(async () => {
      throw new Error('network failure');
    });

    await expect(checkerDef.check(makeCtx())).rejects.toThrow('network failure');
  });
});
