import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMeterContext, isCheckerRegistered } from '../../checker-registry';
import checkerDef from '../exedev-checker';

const makeCtx = (options: Record<string, unknown> = {}) =>
  createMeterContext('exedev-test', 'exedev', { apiKey: 'exedev-api-key', ...options });

const mockCreditsResponse = {
  monthly_allowance_usd: 20,
  monthly_credits_left_usd: 17.992124659999995,
  extra_credits_left_usd: 0,
  next_credit_reset: '00:00 on Jun 1',
};

describe('exedev checker', () => {
  const setFetchMock = (impl: (...args: unknown[]) => Promise<Response>): void => {
    global.fetch = vi.fn(impl) as unknown as typeof fetch;
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('is registered under exedev', () => {
    expect(isCheckerRegistered('exedev')).toBe(true);
  });

  it('sends POST with correct body, headers, and returns two meters', async () => {
    let capturedUrl: string | undefined;
    let capturedMethod: string | undefined;
    let capturedBody: string | undefined;
    let capturedAuth: string | undefined;
    let capturedContentType: string | undefined;

    setFetchMock(async (input: unknown, init: unknown) => {
      const reqInit = init as RequestInit | undefined;
      capturedUrl = String(input as string);
      capturedMethod = reqInit?.method;
      const body = reqInit?.body;
      capturedBody = typeof body === 'string' ? body : body ? await new Response(body).text() : '';
      const headers = new Headers(reqInit?.headers);
      capturedAuth = headers.get('Authorization') ?? undefined;
      capturedContentType = headers.get('Content-Type') ?? undefined;
      return new Response(JSON.stringify(mockCreditsResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const meters = await checkerDef.check(makeCtx());

    expect(capturedUrl).toBe('https://exe.dev/exec');
    expect(capturedMethod).toBe('POST');
    expect(capturedBody).toBe('billing credits --json');
    expect(capturedAuth).toBe('Bearer exedev-api-key');
    expect(capturedContentType).toBe('text/plain');

    expect(meters).toHaveLength(2);

    const allowance = meters.find((m) => m.key === 'shelley_allowance')!;
    expect(allowance.kind).toBe('allowance');
    expect(allowance.limit).toBe(20);
    expect(allowance.used).toBeCloseTo(2.00787534);
    expect(allowance.remaining).toBeCloseTo(17.99212466);
    expect(allowance.periodValue).toBe(1);
    expect(allowance.periodUnit).toBe('month');
    expect(allowance.periodCycle).toBe('fixed');
    expect(allowance.resetsAt).toMatch(/^20\d{2}-06-01T00:00:00\.000Z$/);

    const balance = meters.find((m) => m.key === 'shelley_extra_credits')!;
    expect(balance.kind).toBe('balance');
    expect(balance.remaining).toBe(0);
    expect(balance.unit).toBe('usd');
  });

  it('returns extra credits balance when greater than zero', async () => {
    setFetchMock(
      async () =>
        new Response(
          JSON.stringify({
            ...mockCreditsResponse,
            extra_credits_left_usd: 5.5,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
    );

    const meters = await checkerDef.check(makeCtx());
    const balance = meters.find((m) => m.key === 'shelley_extra_credits')!;
    expect(balance.remaining).toBe(5.5);
  });

  it('throws for non-200 response', async () => {
    setFetchMock(
      async () => new Response('unauthorized', { status: 401, statusText: 'Unauthorized' })
    );

    await expect(checkerDef.check(makeCtx())).rejects.toThrow(
      'HTTP 401: Unauthorized - unauthorized'
    );
  });

  it('uses custom endpoint when provided', async () => {
    let capturedUrl: string | undefined;
    setFetchMock(async (input: unknown) => {
      capturedUrl = String(input as string);
      return new Response(JSON.stringify(mockCreditsResponse), { status: 200 });
    });

    await checkerDef.check(makeCtx({ endpoint: 'https://custom.example.com/exec' }));

    expect(capturedUrl).toBe('https://custom.example.com/exec');
  });

  it('parses next_credit_reset with year inference', async () => {
    setFetchMock(async () => new Response(JSON.stringify(mockCreditsResponse), { status: 200 }));

    const meters = await checkerDef.check(makeCtx());
    const allowance = meters.find((m) => m.key === 'shelley_allowance')!;
    // resetsAt should be an ISO string for June 1 of current or next year
    const resetsAt = allowance.resetsAt!;
    const resetDate = new Date(resetsAt);
    expect(resetDate.getUTCMonth()).toBe(5); // June = 5
    expect(resetDate.getUTCDate()).toBe(1);
    expect(resetDate.getUTCHours()).toBe(0);
    expect(resetDate.getUTCMinutes()).toBe(0);
  });

  it('throws on invalid monthly_allowance_usd', async () => {
    setFetchMock(
      async () =>
        new Response(JSON.stringify({ ...mockCreditsResponse, monthly_allowance_usd: 'bad' }), {
          status: 200,
        })
    );

    await expect(checkerDef.check(makeCtx())).rejects.toThrow('Invalid monthly_allowance_usd');
  });

  it('throws on negative monthly_allowance_usd', async () => {
    setFetchMock(
      async () =>
        new Response(JSON.stringify({ ...mockCreditsResponse, monthly_allowance_usd: -5 }), {
          status: 200,
        })
    );

    await expect(checkerDef.check(makeCtx())).rejects.toThrow('Invalid monthly_allowance_usd');
  });
});
