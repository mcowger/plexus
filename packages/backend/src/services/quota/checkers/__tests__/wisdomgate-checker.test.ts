import { beforeEach, describe, expect, it, jest, mock, spyOn, test } from 'bun:test';

import { createMeterContext, isCheckerRegistered } from '../../checker-registry';
import checkerDef from '../wisdomgate-checker';

const makeCtx = (options: Record<string, unknown> = {}) =>
  createMeterContext('wisdomgate-test', 'wisdomgate', {
    apiKey: 'test-api-key',
    ...options,
  });

const balanceBody = (overrides: Record<string, unknown> = {}) => ({
  available_balance: 12.5,
  package_balance: 10,
  cash_balance: 2.5,
  token_balance: 3.25,
  is_token_unlimited_quota: true,
  ...overrides,
});

describe('wisdomgate checker', () => {
  const setFetchMock = (impl: (...args: unknown[]) => Promise<Response>): void => {
    spyOn(globalThis, 'fetch').mockImplementation(mock(impl) as unknown as typeof fetch);
  };

  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it('is registered under wisdomgate', () => {
    expect(isCheckerRegistered('wisdomgate')).toBe(true);
  });

  it('queries with bearer API key and returns single balance meter when token quota is unlimited', async () => {
    let capturedUrl: string | undefined;
    let capturedAuth: string | undefined;

    setFetchMock(async (input: unknown, init: unknown) => {
      capturedUrl = String(input as string);
      capturedAuth =
        new Headers((init as RequestInit | undefined)?.headers).get('Authorization') ?? undefined;
      return new Response(JSON.stringify(balanceBody()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const meters = await checkerDef.check(makeCtx({ apiKey: 'my-api-key' }));

    expect(capturedUrl).toBe('https://api.wisgate.ai/v1/users/me/balance');
    expect(capturedAuth).toBe('Bearer my-api-key');
    expect(meters).toHaveLength(1);
    const m = meters[0]!;
    expect(m.kind).toBe('balance');
    expect(m.key).toBe('account_balance');
    expect(m.unit).toBe('usd');
    expect(m.remaining).toBeCloseTo(12.5, 6);
    expect(m.label).toBe('Wisdom Gate balance');
  });

  it('adds api_key_balance meter when token quota is limited', async () => {
    setFetchMock(
      async () =>
        new Response(JSON.stringify(balanceBody({ is_token_unlimited_quota: false })), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
    );

    const meters = await checkerDef.check(makeCtx());

    expect(meters).toHaveLength(2);
    const quota = meters[1]!;
    expect(quota.kind).toBe('balance');
    expect(quota.key).toBe('api_key_balance');
    expect(quota.unit).toBe('usd');
    expect(quota.remaining).toBeCloseTo(3.25, 6);
    expect(quota.label).toBe('API key quota');
  });

  it('throws for non-200 response', async () => {
    setFetchMock(
      async () => new Response('unauthorized', { status: 401, statusText: 'Unauthorized' })
    );

    await expect(checkerDef.check(makeCtx())).rejects.toThrow('HTTP 401: Unauthorized');
  });

  it('throws when available_balance is missing', async () => {
    setFetchMock(
      async () =>
        new Response(JSON.stringify(balanceBody({ available_balance: undefined })), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
    );

    await expect(checkerDef.check(makeCtx())).rejects.toThrow(
      'Invalid response: missing available_balance'
    );
  });

  it('ignores legacy session-era endpoint option', async () => {
    let capturedUrl: string | undefined;

    setFetchMock(async (input: unknown) => {
      capturedUrl = String(input as string);
      return new Response(JSON.stringify(balanceBody()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    await checkerDef.check(
      makeCtx({
        session: 'legacy-session',
        endpoint: 'https://wisgate.ai/api/dashboard/billing/usage/details',
      })
    );

    expect(capturedUrl).toBe('https://api.wisgate.ai/v1/users/me/balance');
  });

  it('throws when apiKey option is missing', async () => {
    const ctx = createMeterContext('wisdomgate-test', 'wisdomgate', {});
    await expect(checkerDef.check(ctx)).rejects.toThrow();
  });
});
