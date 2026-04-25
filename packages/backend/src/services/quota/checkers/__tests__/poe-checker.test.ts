import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMeterContext, isCheckerRegistered } from '../../checker-registry';
import checkerDef from '../poe-checker';

const makeCtx = (options: Record<string, unknown> = {}) =>
  createMeterContext('poe-test', 'poe', { apiKey: 'poe-api-key', ...options });

describe('poe checker', () => {
  const setFetchMock = (impl: (...args: unknown[]) => Promise<Response>): void => {
    global.fetch = vi.fn(impl) as unknown as typeof fetch;
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('is registered under poe', () => {
    expect(isCheckerRegistered('poe')).toBe(true);
  });

  it('queries balance endpoint and returns balance meter', async () => {
    let capturedUrl: string | undefined;
    let capturedAuth: string | undefined;

    setFetchMock(async (input: unknown, init: unknown) => {
      capturedUrl = String(input as string);
      capturedAuth =
        new Headers((init as RequestInit | undefined)?.headers).get('Authorization') ?? undefined;
      return new Response(JSON.stringify({ current_point_balance: 4948499 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const meters = await checkerDef.check(makeCtx());

    expect(capturedUrl).toBe('https://api.poe.com/usage/current_balance');
    expect(capturedAuth).toBe('Bearer poe-api-key');
    expect(meters).toHaveLength(1);
    expect(meters[0]?.kind).toBe('balance');
    expect(meters[0]?.unit).toBe('points');
    expect(meters[0]?.remaining).toBe(4948499);
    expect(meters[0]?.label).toBe('POE point balance');
  });

  it('uses custom endpoint when provided', async () => {
    let capturedUrl: string | undefined;

    setFetchMock(async (input: unknown) => {
      capturedUrl = String(input as string);
      return new Response(JSON.stringify({ current_point_balance: 1000 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    await checkerDef.check(makeCtx({ endpoint: 'https://custom.poe.com/balance' }));

    expect(capturedUrl).toBe('https://custom.poe.com/balance');
  });

  it('throws for non-200 response', async () => {
    setFetchMock(
      async () => new Response('unauthorized', { status: 401, statusText: 'Unauthorized' })
    );

    await expect(checkerDef.check(makeCtx())).rejects.toThrow('HTTP 401: Unauthorized');
  });

  it('throws when balance is not numeric', async () => {
    setFetchMock(
      async () =>
        new Response(JSON.stringify({ current_point_balance: 'not-a-number' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
    );

    await expect(checkerDef.check(makeCtx())).rejects.toThrow('Invalid balance:');
  });
});
