import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMeterContext, isCheckerRegistered } from '../../checker-registry';
import checkerDef from '../wafer-checker';

const makeCtx = (options: Record<string, unknown> = {}) =>
  createMeterContext('wafer-test', 'wafer', { apiKey: 'test-key', ...options });

describe('wafer checker', () => {
  const setFetchMock = (impl: (...args: unknown[]) => Promise<Response>): void => {
    global.fetch = vi.fn(impl) as unknown as typeof fetch;
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('is registered under wafer', () => {
    expect(isCheckerRegistered('wafer')).toBe(true);
  });

  it('queries quota endpoint and returns allowance meter', async () => {
    let capturedUrl: string | undefined;
    let capturedHeaders: Headers | undefined;

    setFetchMock(async (input: unknown, init: unknown) => {
      capturedUrl = String(input as string);
      capturedHeaders = new Headers((init as RequestInit | undefined)?.headers);
      return new Response(
        JSON.stringify({
          window_start: '2023-01-01T00:00:00Z',
          window_end: '2023-01-01T05:00:00Z',
          included_request_limit: 2000,
          included_request_count: 35,
          remaining_included_requests: 1965,
          current_period_used_percent: 1.75,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });

    const meters = await checkerDef.check(makeCtx());

    expect(capturedUrl).toBe('https://pass.wafer.ai/v1/inference/quota');
    expect(capturedHeaders!.get('Accept-Encoding')).toBe('identity');
    expect(capturedHeaders!.get('Accept')).toBe('application/json');
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

  it('handles non-ok HTTP response', async () => {
    setFetchMock(
      async () =>
        new Response('Internal Server Error', { status: 500, statusText: 'Internal Server Error' })
    );

    await expect(checkerDef.check(makeCtx())).rejects.toThrow('HTTP 500: Internal Server Error');
  });

  it('handles invalid included_request_limit', async () => {
    setFetchMock(
      async () =>
        new Response(
          JSON.stringify({
            window_start: '2023-01-01T00:00:00Z',
            window_end: '2023-01-01T05:00:00Z',
            included_request_limit: 'not-a-number',
            included_request_count: 0,
            remaining_included_requests: 2000,
            current_period_used_percent: 0,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
    );

    await expect(checkerDef.check(makeCtx())).rejects.toThrow(
      'Invalid included_request_limit received: not-a-number'
    );
  });

  it('handles negative included_request_count', async () => {
    setFetchMock(
      async () =>
        new Response(
          JSON.stringify({
            window_start: '2023-01-01T00:00:00Z',
            window_end: '2023-01-01T05:00:00Z',
            included_request_limit: 2000,
            included_request_count: -5,
            remaining_included_requests: 2005,
            current_period_used_percent: 0,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
    );

    await expect(checkerDef.check(makeCtx())).rejects.toThrow(
      'Invalid included_request_count received: -5'
    );
  });

  it('handles negative remaining_included_requests', async () => {
    setFetchMock(
      async () =>
        new Response(
          JSON.stringify({
            window_start: '2023-01-01T00:00:00Z',
            window_end: '2023-01-01T05:00:00Z',
            included_request_limit: 2000,
            included_request_count: 0,
            remaining_included_requests: -10,
            current_period_used_percent: 0,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
    );

    await expect(checkerDef.check(makeCtx())).rejects.toThrow(
      'Invalid remaining_included_requests received: -10'
    );
  });

  it('handles invalid window_end', async () => {
    setFetchMock(
      async () =>
        new Response(
          JSON.stringify({
            window_start: '2023-01-01T00:00:00Z',
            window_end: 'invalid-date',
            included_request_limit: 2000,
            included_request_count: 0,
            remaining_included_requests: 2000,
            current_period_used_percent: 0,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
    );

    await expect(checkerDef.check(makeCtx())).rejects.toThrow(
      'Invalid window_end date received: invalid-date'
    );
  });

  it('uses custom endpoint when provided', async () => {
    let capturedUrl: string | undefined;

    setFetchMock(async (input: unknown) => {
      capturedUrl = String(input as string);
      return new Response(
        JSON.stringify({
          window_start: '2023-01-01T00:00:00Z',
          window_end: '2023-01-01T05:00:00Z',
          included_request_limit: 100,
          included_request_count: 10,
          remaining_included_requests: 90,
          current_period_used_percent: 10,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });

    await checkerDef.check(makeCtx({ endpoint: 'https://custom.wafer.example.com/quota' }));
    expect(capturedUrl).toBe('https://custom.wafer.example.com/quota');
  });
});
