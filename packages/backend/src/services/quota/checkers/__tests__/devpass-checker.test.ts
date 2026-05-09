import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMeterContext, isCheckerRegistered } from '../../checker-registry';
import checkerDef from '../devpass-checker';

const makeCtx = (options: Record<string, unknown> = {}) =>
  createMeterContext('devpass-test', 'devpass', {
    session: '__Secure-better-auth.session_token',
    ...options,
  });

describe('devpass checker', () => {
  const setFetchMock = (impl: (...args: unknown[]) => Promise<Response>): void => {
    global.fetch = vi.fn(impl) as unknown as typeof fetch;
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('is registered under devpass', () => {
    expect(isCheckerRegistered('devpass')).toBe(true);
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
          hasPersonalOrg: true,
          devPlan: 'lite',
          devPlanCycle: 'monthly',
          devPlanCreditsUsed: '0.0029051214',
          devPlanCreditsLimit: '87',
          devPlanCreditsRemaining: '87.00',
          devPlanBillingCycleStart: '2026-05-07T13:46:51.312Z',
          devPlanCancelled: false,
          devPlanExpiresAt: null,
          regularCredits: '0',
          organizationId: '0W5y4P1KI735Ds4FRmNE',
          projectId: 'JOMpgL26ASdexOjF74e8',
          apiKey: 'llmgtwy_test',
          devPlanAllowAllModels: true,
          cachingEnabled: false,
          cacheDurationSeconds: 60,
          retentionLevel: 'none',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });

    const meters = await checkerDef.check(makeCtx({ session: 'my-session-token' }));

    expect(capturedUrl).toBe('https://internal.llmgateway.io/dev-plans/status');
    expect(capturedCookie).toBe('__Secure-better-auth.session_token=my-session-token');
    expect(meters).toHaveLength(1);

    const m = meters[0]!;
    expect(m.kind).toBe('allowance');
    expect(m.unit).toBe('usd');
    expect(m.used).toBeCloseTo(0.0029051214, 10);
    expect(m.remaining).toBeCloseTo(87.0, 2);
    expect(m.limit).toBeCloseTo(87, 2);
    expect(m.label).toBe('DevPass subscription');
    expect(m.periodValue).toBe(1);
    expect(m.periodUnit).toBe('month');
    expect(m.periodCycle).toBe('fixed');
    expect(m.resetsAt).toBe('2026-06-07T13:46:51.312Z');
  });

  it('computes resetsAt for yearly cycle', async () => {
    setFetchMock(
      async () =>
        new Response(
          JSON.stringify({
            devPlan: 'pro',
            devPlanCycle: 'yearly',
            devPlanCreditsUsed: '10',
            devPlanCreditsLimit: '1000',
            devPlanCreditsRemaining: '990',
            devPlanBillingCycleStart: '2025-01-01T00:00:00.000Z',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
    );

    const meters = await checkerDef.check(makeCtx());
    expect(meters[0]!.resetsAt).toBe('2026-01-01T00:00:00.000Z');
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
        JSON.stringify({
          devPlanCreditsUsed: '0',
          devPlanCreditsLimit: '10',
          devPlanCreditsRemaining: '10',
          devPlanBillingCycleStart: '2026-05-01T00:00:00.000Z',
          devPlanCycle: 'monthly',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });

    await checkerDef.check(
      makeCtx({
        endpoint: 'https://custom.internal.example.com/dev-plans/status',
      })
    );

    expect(capturedUrl).toBe('https://custom.internal.example.com/dev-plans/status');
  });

  it('throws when session option is missing', async () => {
    const ctx = createMeterContext('devpass-test', 'devpass', {});
    await expect(checkerDef.check(ctx)).rejects.toThrow();
  });

  it('handles numeric values in response', async () => {
    setFetchMock(
      async () =>
        new Response(
          JSON.stringify({
            devPlanCreditsUsed: 5.5,
            devPlanCreditsLimit: 100,
            devPlanCreditsRemaining: 94.5,
            devPlanBillingCycleStart: '2026-05-07T13:46:51.312Z',
            devPlanCycle: 'monthly',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
    );

    const meters = await checkerDef.check(makeCtx());
    expect(meters[0]!.used).toBe(5.5);
    expect(meters[0]!.limit).toBe(100);
    expect(meters[0]!.remaining).toBe(94.5);
  });
});
