import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMeterContext, isCheckerRegistered } from '../../checker-registry';
import checkerDef from '../wafer-checker';

const makeCtx = (options: Record<string, unknown> = {}) =>
  createMeterContext('wafer-test', 'wafer', { apiKey: 'test-key', ...options });

const QUOTA_RESPONSE = {
  window_start: '2023-01-01T00:00:00Z',
  window_end: '2023-01-01T05:00:00Z',
  included_request_limit: 2000,
  included_request_count: 35,
  remaining_included_requests: 1965,
  current_period_used_percent: 1.75,
};

const makeQuotaMock = (body: unknown = QUOTA_RESPONSE, status = 200) => {
  const urls: string[] = [];
  const mock = vi.fn(async (input: unknown, init: unknown) => {
    urls.push(String(input));
    return new Response(status === 200 ? JSON.stringify(body) : 'error', {
      status,
      statusText: status === 200 ? 'OK' : 'Internal Server Error',
      headers: { 'Content-Type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { mock, urls };
};

describe('wafer checker', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('is registered under wafer', () => {
    expect(isCheckerRegistered('wafer')).toBe(true);
  });

  it('queries quota endpoint and returns allowance meter', async () => {
    const { mock, urls } = makeQuotaMock();
    global.fetch = mock;

    const meters = await checkerDef.check(makeCtx());

    expect(urls[0]).toBe('https://pass.wafer.ai/v1/inference/quota');
    expect(meters).toHaveLength(1);

    const m = meters[0]!;
    expect(m.kind).toBe('allowance');
    expect(m.unit).toBe('requests');
    expect(m.limit).toBe(2000);
    expect(m.used).toBe(35);
    expect(m.remaining).toBe(1965);
    expect(m.label).toBe('5-hour request quota');
    expect(m.periodValue).toBe(5);
    expect(m.periodUnit).toBe('hour');
    expect(m.periodCycle).toBe('fixed');
    expect(m.resetsAt).toBe('2023-01-01T05:00:00.000Z');
  });

  it('sends correct headers', async () => {
    let capturedHeaders: Headers | undefined;
    global.fetch = vi.fn(async (_input: unknown, init: unknown) => {
      capturedHeaders = new Headers((init as RequestInit | undefined)?.headers);
      return new Response(JSON.stringify(QUOTA_RESPONSE), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    await checkerDef.check(makeCtx());

    expect(capturedHeaders!.get('Accept-Encoding')).toBe('identity');
    expect(capturedHeaders!.get('Accept')).toBe('application/json');
    expect(capturedHeaders!.get('Authorization')).toBe('Bearer test-key');
  });

  it('uses custom endpoint when provided', async () => {
    const { mock, urls } = makeQuotaMock();
    global.fetch = mock;

    await checkerDef.check(makeCtx({ endpoint: 'https://custom.wafer.example.com/quota' }));

    expect(urls[0]).toBe('https://custom.wafer.example.com/quota');
  });

  it('handles non-ok HTTP response', async () => {
    global.fetch = vi.fn(
      async () =>
        new Response('Internal Server Error', { status: 500, statusText: 'Internal Server Error' })
    ) as unknown as typeof fetch;

    await expect(checkerDef.check(makeCtx())).rejects.toThrow('HTTP 500: Internal Server Error');
  });

  it('handles invalid included_request_limit', async () => {
    const { mock } = makeQuotaMock({ ...QUOTA_RESPONSE, included_request_limit: 'not-a-number' });
    global.fetch = mock;

    await expect(checkerDef.check(makeCtx())).rejects.toThrow(
      'Invalid included_request_limit received: not-a-number'
    );
  });

  it('handles negative included_request_count', async () => {
    const { mock } = makeQuotaMock({ ...QUOTA_RESPONSE, included_request_count: -5 });
    global.fetch = mock;

    await expect(checkerDef.check(makeCtx())).rejects.toThrow(
      'Invalid included_request_count received: -5'
    );
  });

  it('handles negative remaining_included_requests', async () => {
    const { mock } = makeQuotaMock({ ...QUOTA_RESPONSE, remaining_included_requests: -10 });
    global.fetch = mock;

    await expect(checkerDef.check(makeCtx())).rejects.toThrow(
      'Invalid remaining_included_requests received: -10'
    );
  });

  it('handles invalid window_end', async () => {
    const { mock } = makeQuotaMock({ ...QUOTA_RESPONSE, window_end: 'invalid-date' });
    global.fetch = mock;

    await expect(checkerDef.check(makeCtx())).rejects.toThrow(
      'Invalid window_end date received: invalid-date'
    );
  });

  describe('includeAllowance: false', () => {
    it('makes no fetch calls and returns no meters', async () => {
      const fetchSpy = vi.fn();
      global.fetch = fetchSpy as unknown as typeof fetch;

      const meters = await checkerDef.check(makeCtx({ includeAllowance: false }));

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(meters).toHaveLength(0);
    });

    it('does not call a custom endpoint even if one is configured', async () => {
      const fetchSpy = vi.fn();
      global.fetch = fetchSpy as unknown as typeof fetch;

      await checkerDef.check(
        makeCtx({ includeAllowance: false, endpoint: 'https://custom.wafer.example.com/quota' })
      );

      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });
});
