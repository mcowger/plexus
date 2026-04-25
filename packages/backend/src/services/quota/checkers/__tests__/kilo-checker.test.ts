import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMeterContext, isCheckerRegistered } from '../../checker-registry';
import checkerDef from '../kilo-checker';

const makeCtx = (options: Record<string, unknown> = {}) =>
  createMeterContext('kilo-test', 'kilo', { apiKey: 'kilo-api-key', ...options });

describe('kilo checker', () => {
  const setFetchMock = (impl: (...args: unknown[]) => Promise<Response>): void => {
    global.fetch = vi.fn(impl) as unknown as typeof fetch;
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('is registered under kilo', () => {
    expect(isCheckerRegistered('kilo')).toBe(true);
  });

  it('queries the balance endpoint with Bearer auth and returns balance meter', async () => {
    let capturedUrl: string | undefined;
    let capturedAuth: string | undefined;

    setFetchMock(async (input: unknown, init: unknown) => {
      capturedUrl = String(input as string);
      capturedAuth =
        new Headers((init as RequestInit | undefined)?.headers).get('Authorization') ?? undefined;
      return new Response(JSON.stringify({ balance: 42.5 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const meters = await checkerDef.check(makeCtx());

    expect(capturedUrl).toBe('https://api.kilo.ai/api/profile/balance');
    expect(capturedAuth).toBe('Bearer kilo-api-key');
    expect(meters).toHaveLength(1);
    expect(meters[0]?.kind).toBe('balance');
    expect(meters[0]?.unit).toBe('usd');
    expect(meters[0]?.remaining).toBe(42.5);
  });

  it('sends x-kilocode-organizationid header when organizationId option is set', async () => {
    let orgHeader: string | undefined;

    setFetchMock(async (_input: unknown, init: unknown) => {
      orgHeader =
        new Headers((init as RequestInit | undefined)?.headers).get('x-kilocode-organizationid') ??
        undefined;
      return new Response(JSON.stringify({ balance: 12 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    await checkerDef.check(makeCtx({ organizationId: 'org-123' }));

    expect(orgHeader).toBe('org-123');
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
        new Response(JSON.stringify({ balance: 'not-a-number' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
    );

    await expect(checkerDef.check(makeCtx())).rejects.toThrow('Invalid balance:');
  });
});
