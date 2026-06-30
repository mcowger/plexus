import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMeterContext, isCheckerRegistered } from '../../checker-registry';
import checkerDef from '../cline-checker';

const makeCtx = (options: Record<string, unknown> = {}) =>
  createMeterContext('cline-test', 'cline', { apiKey: 'cline-api-key', ...options });

const meResponse = (overrides: { id?: string } = {}) => ({
  success: true,
  data: { id: overrides.id ?? 'usr-test-1' },
});

const balanceResponse = (overrides: { balance?: number; userId?: string } = {}) => ({
  success: true,
  data: { balance: overrides.balance ?? 5_000_000, userId: overrides.userId ?? 'usr-test-1' },
});

const planResponse = (
  overrides: {
    subscriptionId?: string | null;
    currentPeriodStart?: string;
    currentPeriodEnd?: string;
    planDisplayName?: string;
  } = {}
) => ({
  success: true,
  data:
    overrides.subscriptionId === null
      ? { userId: 'usr-test-1' }
      : {
          userId: 'usr-test-1',
          subscriptionId: overrides.subscriptionId ?? 'sub-1',
          planHistoryId: 'plh-1',
          plan: {
            id: 'pln-1',
            name: 'cline-pass',
            displayName: overrides.planDisplayName ?? 'Cline Pass',
          },
          currentPeriodStart: overrides.currentPeriodStart ?? '2026-06-01T00:00:00Z',
          currentPeriodEnd: overrides.currentPeriodEnd ?? '2026-07-01T00:00:00Z',
        },
});

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('cline checker', () => {
  const capturedUrls: string[] = [];
  let capturedAuth: string | undefined;

  const setFetchMock = (responses: Response[]): void => {
    capturedUrls.length = 0;
    let i = 0;
    global.fetch = vi.fn(async (input: unknown, init: unknown) => {
      capturedUrls.push(String(input as string));
      capturedAuth =
        new Headers((init as RequestInit | undefined)?.headers).get('Authorization') ?? undefined;
      const res = responses[i] ?? responses[responses.length - 1]!;
      i++;
      return res;
    }) as unknown as typeof fetch;
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    capturedAuth = undefined;
  });

  it('is registered under cline', () => {
    expect(isCheckerRegistered('cline')).toBe(true);
  });

  it('fetches /users/me, then balance, then plan with Bearer auth', async () => {
    setFetchMock([
      jsonResponse(meResponse()),
      jsonResponse(balanceResponse()),
      jsonResponse(planResponse()),
    ]);

    await checkerDef.check(makeCtx());

    expect(capturedUrls[0]).toBe('https://api.cline.bot/api/v1/users/me');
    expect(capturedUrls[1]).toBe('https://api.cline.bot/api/v1/users/usr-test-1/balance');
    expect(capturedUrls[2]).toBe('https://api.cline.bot/api/v1/users/me/plan');
    expect(capturedAuth).toBe('Bearer cline-api-key');
  });

  it('uses a custom endpoint when provided', async () => {
    setFetchMock([
      jsonResponse(meResponse()),
      jsonResponse(balanceResponse()),
      jsonResponse(planResponse()),
    ]);

    await checkerDef.check(makeCtx({ endpoint: 'https://custom.example.com' }));

    expect(capturedUrls[0]).toBe('https://custom.example.com/api/v1/users/me');
    expect(capturedUrls[1]).toBe('https://custom.example.com/api/v1/users/usr-test-1/balance');
    expect(capturedUrls[2]).toBe('https://custom.example.com/api/v1/users/me/plan');
  });

  it('returns balance meter converted from microcredits to USD', async () => {
    setFetchMock([
      jsonResponse(meResponse()),
      jsonResponse(balanceResponse({ balance: 5_000_000 })),
      jsonResponse(planResponse({ subscriptionId: null })),
    ]);

    const meters = await checkerDef.check(makeCtx());

    const balanceMeter = meters.find((m) => m.key === 'balance');
    expect(balanceMeter).toBeDefined();
    expect(balanceMeter?.kind).toBe('balance');
    expect(balanceMeter?.unit).toBe('usd');
    expect(balanceMeter?.remaining).toBe(5);
  });

  it('returns a subscription allowance meter when an active plan exists', async () => {
    const now = new Date('2026-06-16T00:00:00Z');
    vi.useFakeTimers();
    vi.setSystemTime(now);

    setFetchMock([
      jsonResponse(meResponse()),
      jsonResponse(balanceResponse()),
      jsonResponse(
        planResponse({
          currentPeriodStart: '2026-06-01T00:00:00Z',
          currentPeriodEnd: '2026-07-01T00:00:00Z',
          planDisplayName: 'Cline Pass (Monthly)',
        })
      ),
    ]);

    const meters = await checkerDef.check(makeCtx());
    vi.useRealTimers();

    const planMeter = meters.find((m) => m.key === 'subscription_plan');
    expect(planMeter).toBeDefined();
    expect(planMeter?.kind).toBe('allowance');
    expect(planMeter?.unit).toBe('percentage');
    expect(planMeter?.label).toBe('Cline Pass (Monthly) billing cycle');
    expect(planMeter?.resetsAt).toBe('2026-07-01T00:00:00.000Z');
    expect(planMeter?.used).toBeCloseTo(50, 0);
    expect(planMeter?.remaining).toBeCloseTo(50, 0);
  });

  it('omits subscription meter when there is no active subscription', async () => {
    setFetchMock([
      jsonResponse(meResponse()),
      jsonResponse(balanceResponse()),
      jsonResponse(planResponse({ subscriptionId: null })),
    ]);

    const meters = await checkerDef.check(makeCtx());

    expect(meters.find((m) => m.key === 'subscription_plan')).toBeUndefined();
  });

  it('throws for non-200 HTTP response', async () => {
    setFetchMock([new Response('unauthorized', { status: 401, statusText: 'Unauthorized' })]);

    await expect(checkerDef.check(makeCtx())).rejects.toThrow('HTTP 401: Unauthorized');
  });

  it('throws when envelope success is false', async () => {
    setFetchMock([jsonResponse({ success: false, error: 'Unauthorized: bad token' })]);

    await expect(checkerDef.check(makeCtx())).rejects.toThrow('Unauthorized: bad token');
  });

  it('throws when fetch throws a network error', async () => {
    global.fetch = vi.fn(async () => {
      throw new Error('network failure');
    }) as unknown as typeof fetch;

    await expect(checkerDef.check(makeCtx())).rejects.toThrow('network failure');
  });
});
