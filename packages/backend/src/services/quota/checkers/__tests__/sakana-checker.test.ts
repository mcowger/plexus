import { beforeEach, describe, expect, it, jest, mock, spyOn, test } from 'bun:test';

import { createMeterContext, isCheckerRegistered } from '../../checker-registry';
import checkerDef from '../sakana-checker';

const makeCtx = (options: Record<string, unknown> = {}) =>
  createMeterContext('sakana-test', 'sakana', {
    sessionCookie: 'test-session-cookie',
    ...options,
  });

function mockBillingHtml(opts: {
  fiveHourPercent?: number;
  fiveHourReset?: string;
  weeklyPercent?: number;
  weeklyReset?: string;
  creditBalance?: number;
}): string {
  let usageLimitHtml = '';
  if (opts.fiveHourPercent !== undefined) {
    usageLimitHtml += `<div class="space-y-2"><div class="flex flex-wrap items-end justify-between gap-2"><div class="flex items-center gap-1.5"><p class="font-medium text-sm">5-hour</p><p class="text-muted-foreground text-xs tabular-nums">Resets on ${opts.fiveHourReset ?? 'June 24, 2026 at 4:47 AM'}</p></div><div aria-label="5-hour: ${opts.fiveHourPercent}% used" data-state="indeterminate" data-max="100" data-slot="progress" class="relative w-full overflow-hidden rounded-full bg-primary/20 h-2.5" role="progressbar"><div data-state="indeterminate" data-max="100" data-slot="progress-indicator" class="h-full w-full flex-1 bg-primary transition-all" style="transform:translateX(-${100 - opts.fiveHourPercent}%)"></div></div></div>`;
  }
  if (opts.weeklyPercent !== undefined) {
    usageLimitHtml += `<div class="space-y-2"><div class="flex flex-wrap items-end justify-between gap-2"><div class="flex items-center gap-1.5"><p class="font-medium text-sm">Weekly</p><p class="text-muted-foreground text-xs tabular-nums">Resets on ${opts.weeklyReset ?? 'June 29, 2026 at 12:00 AM'}</p></div><div aria-label="Weekly: ${opts.weeklyPercent}% used" data-state="indeterminate" data-max="100" data-slot="progress" class="relative w-full overflow-hidden rounded-full bg-primary/20 h-2.5" role="progressbar"><div data-state="indeterminate" data-max="100" data-slot="progress-indicator" class="h-full w-full flex-1 bg-primary transition-all" style="transform:translateX(-${100 - opts.weeklyPercent}%)"></div></div></div>`;
  }

  let creditHtml = '';
  if (opts.creditBalance !== undefined) {
    const formatted = opts.creditBalance.toFixed(2);
    creditHtml = `<script>self.__next_f.push([1,"35:[\\"$\\",\\"$L42\\",null,{\\"data\\":[],\\"children\\":[[\\"$\\",\\"div\\",null,{\\"children\\":[[\\"$\\",\\"h2\\",null,{\\"children\\":\\"Credit balance\\"}],[\\"$\\",\\"p\\",null,{\\"children\\":\\"$$${formatted}\\"}]]}]}]</script>`;
  }

  return `<!DOCTYPE html><html><head><title>Sakana AI Console</title></head><body><div data-slot="card"><div data-slot="card-title">Usage limit</div><div data-slot="card-content" class="px-6 space-y-5">${usageLimitHtml}</div></div>${creditHtml}</body></html>`;
}

describe('sakana checker', () => {
  const setFetchMock = (impl: (...args: unknown[]) => Promise<Response>): void => {
    spyOn(globalThis, 'fetch').mockImplementation(mock(impl) as unknown as typeof fetch);
  };

  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it('is registered under sakana', () => {
    expect(isCheckerRegistered('sakana')).toBe(true);
  });

  it('returns five_hour and weekly allowance meters', async () => {
    setFetchMock(
      async () =>
        new Response(mockBillingHtml({ fiveHourPercent: 15, weeklyPercent: 9 }), { status: 200 })
    );

    const meters = await checkerDef.check(makeCtx());
    expect(meters).toHaveLength(2);

    const fiveHour = meters.find((m) => m.key === 'five_hour')!;
    expect(fiveHour.kind).toBe('allowance');
    expect(fiveHour.unit).toBe('percentage');
    expect(fiveHour.used).toBe(15);
    expect(fiveHour.remaining).toBe(85);
    expect(fiveHour.periodValue).toBe(5);
    expect(fiveHour.periodUnit).toBe('hour');
    expect(fiveHour.periodCycle).toBe('rolling');
    expect(fiveHour.resetsAt).toBeDefined();

    const weekly = meters.find((m) => m.key === 'weekly')!;
    expect(weekly.kind).toBe('allowance');
    expect(weekly.unit).toBe('percentage');
    expect(weekly.used).toBe(9);
    expect(weekly.remaining).toBe(91);
    expect(weekly.periodValue).toBe(7);
    expect(weekly.periodUnit).toBe('day');
    expect(weekly.periodCycle).toBe('rolling');
    expect(weekly.resetsAt).toBeDefined();
  });

  it('includes credit balance meter when balance > 0', async () => {
    setFetchMock(
      async () =>
        new Response(
          mockBillingHtml({ fiveHourPercent: 5, weeklyPercent: 3, creditBalance: 42.5 }),
          { status: 200 }
        )
    );

    const meters = await checkerDef.check(makeCtx());
    expect(meters).toHaveLength(3);

    const credit = meters.find((m) => m.key === 'credit')!;
    expect(credit.kind).toBe('balance');
    expect(credit.unit).toBe('usd');
    expect(credit.remaining).toBe(42.5);
  });

  it('includes credit balance meter when balance is 0', async () => {
    setFetchMock(
      async () =>
        new Response(
          mockBillingHtml({ fiveHourPercent: 10, weeklyPercent: 20, creditBalance: 0 }),
          { status: 200 }
        )
    );

    const meters = await checkerDef.check(makeCtx());
    expect(meters).toHaveLength(3);

    const credit = meters.find((m) => m.key === 'credit')!;
    expect(credit.kind).toBe('balance');
    expect(credit.unit).toBe('usd');
    expect(credit.remaining).toBe(0);
  });

  it('returns partial meters when only 5-hour is available', async () => {
    setFetchMock(
      async () => new Response(mockBillingHtml({ fiveHourPercent: 50 }), { status: 200 })
    );

    const meters = await checkerDef.check(makeCtx());
    expect(meters).toHaveLength(1);
    expect(meters[0]!.key).toBe('five_hour');
    expect(meters[0]!.used).toBe(50);
    expect(meters[0]!.remaining).toBe(50);
  });

  it('sends session cookie and user-agent header', async () => {
    let capturedCookie: string | undefined;
    let capturedUA: string | undefined;

    setFetchMock(async (_input: unknown, init: unknown) => {
      const headers = new Headers((init as RequestInit | undefined)?.headers);
      capturedCookie = headers.get('Cookie') ?? undefined;
      capturedUA = headers.get('User-Agent') ?? undefined;
      return new Response(mockBillingHtml({ fiveHourPercent: 1, weeklyPercent: 1 }), {
        status: 200,
      });
    });

    await checkerDef.check(makeCtx({ sessionCookie: 'my-cookie-value' }));
    expect(capturedCookie).toBe('__Secure-authjs.session-token=my-cookie-value');
    expect(capturedUA).toContain('Chrome');
  });

  it('throws when no usage data can be parsed from HTML', async () => {
    setFetchMock(
      async () => new Response('<html><body>no data here</body></html>', { status: 200 })
    );

    await expect(checkerDef.check(makeCtx())).rejects.toThrow(
      'Could not parse usage data from Sakana billing page'
    );
  });

  it('throws on non-200 response', async () => {
    setFetchMock(
      async () => new Response('Unauthorized', { status: 401, statusText: 'Unauthorized' })
    );

    await expect(checkerDef.check(makeCtx())).rejects.toThrow('HTTP 401: Unauthorized');
  });

  it('uses custom endpoint when configured', async () => {
    let capturedUrl: string | undefined;

    setFetchMock(async (input: unknown) => {
      capturedUrl = typeof input === 'string' ? input : undefined;
      return new Response(mockBillingHtml({ fiveHourPercent: 1, weeklyPercent: 1 }), {
        status: 200,
      });
    });

    await checkerDef.check(makeCtx({ endpoint: 'https://custom.example.com/billing' }));
    expect(capturedUrl).toBe('https://custom.example.com/billing');
  });

  it('throws when sessionCookie option is missing', async () => {
    const ctx = createMeterContext('sakana-test', 'sakana', {});
    await expect(checkerDef.check(ctx)).rejects.toThrow();
  });

  it('parses reset date as UTC ISO string', async () => {
    setFetchMock(
      async () =>
        new Response(
          mockBillingHtml({
            fiveHourPercent: 10,
            fiveHourReset: 'June 24, 2026 at 4:47 AM',
            weeklyPercent: 5,
            weeklyReset: 'June 29, 2026 at 12:00 AM',
          }),
          { status: 200 }
        )
    );

    const meters = await checkerDef.check(makeCtx());
    const fiveHour = meters.find((m) => m.key === 'five_hour')!;
    expect(fiveHour.resetsAt).toBe('2026-06-24T04:47:00.000Z');

    const weekly = meters.find((m) => m.key === 'weekly')!;
    expect(weekly.resetsAt).toBe('2026-06-29T00:00:00.000Z');
  });
});
