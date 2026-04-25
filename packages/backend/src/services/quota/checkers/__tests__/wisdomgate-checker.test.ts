import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMeterContext, isCheckerRegistered } from '../../checker-registry';
import checkerDef from '../wisdomgate-checker';

const makeCtx = (options: Record<string, unknown> = {}) =>
  createMeterContext('wisdomgate-test', 'wisdomgate', {
    session: 'test_session_token',
    ...options,
  });

describe('wisdomgate checker', () => {
  const setFetchMock = (impl: (...args: unknown[]) => Promise<Response>): void => {
    global.fetch = vi.fn(impl) as unknown as typeof fetch;
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('is registered under wisdomgate', () => {
    expect(isCheckerRegistered('wisdomgate')).toBe(true);
  });

  it('queries with session cookie and returns allowance meter', async () => {
    let capturedUrl: string | undefined;
    let capturedCookie: string | undefined;

    setFetchMock(async (input: unknown, init: unknown) => {
      capturedUrl = String(input as string);
      capturedCookie =
        new Headers((init as RequestInit | undefined)?.headers).get('Cookie') ?? undefined;
      return new Response(
        JSON.stringify({
          object: 'usage_details',
          total_usage: 148.49091,
          total_available: 0.067706,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });

    const meters = await checkerDef.check(makeCtx({ session: 'my-session-token' }));

    expect(capturedUrl).toBe('https://wisgate.ai/api/dashboard/billing/usage/details');
    expect(capturedCookie).toBe('session=my-session-token');
    expect(meters).toHaveLength(1);
    const m = meters[0]!;
    expect(m.kind).toBe('allowance');
    expect(m.unit).toBe('usd');
    expect(m.used).toBeCloseTo(148.49091, 6);
    expect(m.remaining).toBeCloseTo(0.067706, 6);
    expect(m.limit).toBeCloseTo(148.558616, 6);
    expect(m.label).toBe('Wisdom Gate subscription');
    expect(m.periodValue).toBe(1);
    expect(m.periodUnit).toBe('month');
    expect(m.periodCycle).toBe('fixed');
  });

  it('throws for non-200 response', async () => {
    setFetchMock(
      async () => new Response('unauthorized', { status: 401, statusText: 'Unauthorized' })
    );

    await expect(checkerDef.check(makeCtx())).rejects.toThrow('HTTP 401: Unauthorized');
  });

  it('uses custom endpoint when provided', async () => {
    let capturedUrl: string | undefined;

    setFetchMock(async (input: unknown) => {
      capturedUrl = String(input as string);
      return new Response(
        JSON.stringify({ object: 'usage_details', total_usage: 10, total_available: 10 }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });

    await checkerDef.check(
      makeCtx({
        endpoint: 'https://custom.endpoint.example.com/api/dashboard/billing/usage/details',
      })
    );

    expect(capturedUrl).toBe(
      'https://custom.endpoint.example.com/api/dashboard/billing/usage/details'
    );
  });

  it('throws when session option is missing', async () => {
    const ctx = createMeterContext('wisdomgate-test', 'wisdomgate', {});
    await expect(checkerDef.check(ctx)).rejects.toThrow();
  });
});
