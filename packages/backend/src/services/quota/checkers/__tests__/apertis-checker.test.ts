import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMeterContext, isCheckerRegistered } from '../../checker-registry';
import checkerDef from '../apertis-checker';

const makeCtx = (options: Record<string, unknown> = {}) =>
  createMeterContext('apertis-test', 'apertis', { apiKey: 'apertis-api-key', ...options });

const makePaygResponse = (
  overrides: { account_credits?: number; is_subscriber?: boolean; subscription?: unknown } = {}
) => ({
  object: 'billing_credits',
  is_subscriber: overrides.is_subscriber ?? false,
  payg: {
    account_credits: overrides.account_credits ?? 24.980973,
    token_used: 0,
    token_total: 'unlimited',
    token_remaining: 'unlimited',
    token_is_unlimited: true,
  },
  ...(overrides.subscription ? { subscription: overrides.subscription } : {}),
});

describe('apertis checker', () => {
  const setFetchMock = (impl: (...args: unknown[]) => Promise<Response>): void => {
    global.fetch = vi.fn(impl) as unknown as typeof fetch;
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('is registered under apertis', () => {
    expect(isCheckerRegistered('apertis')).toBe(true);
  });

  it('queries the default endpoint with Bearer token auth', async () => {
    let capturedUrl: string | undefined;
    let capturedAuth: string | undefined;

    setFetchMock(async (input: unknown, init: unknown) => {
      capturedUrl = String(input as string);
      capturedAuth =
        new Headers((init as RequestInit | undefined)?.headers).get('Authorization') ?? undefined;
      return new Response(JSON.stringify(makePaygResponse()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    await checkerDef.check(makeCtx());

    expect(capturedUrl).toBe('https://api.apertis.ai/v1/dashboard/billing/credits');
    expect(capturedAuth).toBe('Bearer apertis-api-key');
  });

  it('uses a custom endpoint when provided', async () => {
    let capturedUrl: string | undefined;

    setFetchMock(async (input: unknown) => {
      capturedUrl = String(input as string);
      return new Response(JSON.stringify(makePaygResponse()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    await checkerDef.check(makeCtx({ endpoint: 'https://custom.example.com/billing' }));

    expect(capturedUrl).toBe('https://custom.example.com/billing');
  });

  it('returns PAYG balance meter from account_credits', async () => {
    setFetchMock(
      async () =>
        new Response(JSON.stringify(makePaygResponse({ account_credits: 24.980973 })), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
    );

    const meters = await checkerDef.check(makeCtx());

    expect(meters).toHaveLength(1);
    const m = meters[0]!;
    expect(m.kind).toBe('balance');
    expect(m.unit).toBe('usd');
    expect(m.remaining).toBe(24.980973);
    expect(m.label).toBe('PAYG balance');
  });

  it('returns both balance and allowance meters for a subscriber', async () => {
    setFetchMock(
      async () =>
        new Response(
          JSON.stringify(
            makePaygResponse({
              account_credits: 5,
              is_subscriber: true,
              subscription: {
                plan_type: 'lite',
                status: 'active',
                cycle_quota_limit: 1000,
                cycle_quota_used: 200,
                cycle_quota_remaining: 800,
                cycle_end: '2026-05-01T00:00:00Z',
              },
            })
          ),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
    );

    const meters = await checkerDef.check(makeCtx());

    expect(meters).toHaveLength(2);
    expect(meters[0]?.kind).toBe('balance');
    expect(meters[1]?.kind).toBe('allowance');
    expect(meters[1]?.unit).toBe('requests');
    expect(meters[1]?.limit).toBe(1000);
    expect(meters[1]?.used).toBe(200);
    expect(meters[1]?.remaining).toBe(800);
  });

  it('omits PAYG balance meter when account_credits is NaN', async () => {
    setFetchMock(
      async () =>
        new Response(
          JSON.stringify({
            object: 'billing_credits',
            is_subscriber: false,
            payg: {
              account_credits: NaN,
              token_used: 0,
              token_total: 'unlimited',
              token_remaining: 'unlimited',
              token_is_unlimited: true,
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
    );

    const meters = await checkerDef.check(makeCtx());
    expect(meters).toHaveLength(0);
  });

  it('throws for non-200 HTTP response', async () => {
    setFetchMock(
      async () => new Response('unauthorized', { status: 401, statusText: 'Unauthorized' })
    );

    await expect(checkerDef.check(makeCtx())).rejects.toThrow('HTTP 401: Unauthorized');
  });

  it('throws when response object is not billing_credits', async () => {
    setFetchMock(
      async () =>
        new Response(JSON.stringify({ object: 'error', message: 'Invalid request' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
    );

    await expect(checkerDef.check(makeCtx())).rejects.toThrow(
      'Invalid response: expected billing_credits object'
    );
  });

  it('throws when fetch throws a network error', async () => {
    setFetchMock(async () => {
      throw new Error('network failure');
    });

    await expect(checkerDef.check(makeCtx())).rejects.toThrow('network failure');
  });
});
