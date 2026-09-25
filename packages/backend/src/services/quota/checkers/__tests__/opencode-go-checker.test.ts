import { describe, expect, it } from 'vitest';
import { registerSpy } from '../../../../../test/test-utils';
import { createMeterContext, isCheckerRegistered } from '../../checker-registry';
import checkerDef from '../opencode-go-checker';

const makeCtx = (opts: Record<string, unknown> = {}) =>
  createMeterContext('opencode-go-test', 'opencode-go', {
    workspaceId: 'ws-test',
    authCookie: 'test-cookie',
    ...opts,
  });

function mockDashboardHtml(
  windows: Array<{
    field: string;
    usagePercent: number;
    resetInSec: number;
    resetFirst?: boolean;
  }>
): string {
  let html = '<!DOCTYPE html><html><head></head><body>';
  for (const w of windows) {
    if (w.resetFirst) {
      html += `${w.field}:$R[${Math.floor(Math.random() * 100)}]={other:1,resetInSec:${w.resetInSec},usagePercent:${w.usagePercent}}`;
    } else {
      html += `${w.field}:$R[${Math.floor(Math.random() * 100)}]={usagePercent:${w.usagePercent},resetInSec:${w.resetInSec}}`;
    }
  }
  return html + '</body></html>';
}

function mockCardHtml(
  cards: Array<{
    name: string;
    percent: number;
    resetTitle?: string;
    resetRelative?: string;
    wrapperClass?: string;
    badgePercent?: number | null;
    ariaValueNow?: number | null;
    ariaValueText?: number | null;
    ariaValueBeforeLabel?: boolean;
  }>
): string {
  let html = '<!DOCTYPE html><html><head></head><body>';
  for (const c of cards) {
    const reset =
      c.resetTitle !== undefined && c.resetRelative !== undefined
        ? `<span class="shrink-0 text-[0.75rem] text-muted" title="${c.resetTitle}">Resets in ${c.resetRelative}</span>`
        : '';
    const badgePercent = c.badgePercent === undefined ? c.percent : c.badgePercent;
    const ariaValueNow = c.ariaValueNow === undefined ? c.percent : c.ariaValueNow;
    const ariaValueText = c.ariaValueText === undefined ? c.percent : c.ariaValueText;
    const valueNowAttribute = ariaValueNow === null ? '' : ` aria-valuenow="${ariaValueNow}"`;
    html +=
      `<div class="${c.wrapperClass ?? 'flex flex-col rounded-md border px-4 py-3'}">` +
      `<div class="mb-3 flex flex-wrap items-center justify-between gap-2">` +
      `<p class="flex min-w-0 items-center gap-1"><span class="truncate">${c.name} usage</span>` +
      (badgePercent === null
        ? ''
        : `<span class="rounded-sm px-1 tabular-nums">${badgePercent}%</span>`) +
      `</p>${reset}</div>` +
      `<div class="mt-auto"><div class="flex h-2 w-full gap-1" role="progressbar" ` +
      `aria-valuemin="0" aria-valuemax="100"` +
      (c.ariaValueBeforeLabel ? valueNowAttribute : '') +
      ` aria-label="${c.name} usage used"` +
      (c.ariaValueBeforeLabel ? '' : valueNowAttribute) +
      (ariaValueText === null ? '' : ` aria-valuetext="${ariaValueText}% used"`) +
      `></div></div></div>`;
  }
  return html + '</body></html>';
}

describe('opencode-go checker', () => {
  const setFetchMock = (impl: (...args: unknown[]) => Promise<Response>): void => {
    registerSpy(global, 'fetch').mockImplementation(impl);
  };

  it('is registered under opencode-go', () => {
    expect(isCheckerRegistered('opencode-go')).toBe(true);
  });

  it('returns rolling_5h, weekly, and monthly allowance meters', async () => {
    setFetchMock(
      async () =>
        new Response(
          mockDashboardHtml([
            { field: 'rollingUsage', usagePercent: 12.5, resetInSec: 12345 },
            { field: 'weeklyUsage', usagePercent: 30, resetInSec: 67890 },
            { field: 'monthlyUsage', usagePercent: 50, resetInSec: 111213 },
          ]),
          { status: 200 }
        )
    );

    const meters = await checkerDef.check(makeCtx());
    expect(meters).toHaveLength(3);

    const rolling = meters.find((m) => m.key === 'rolling_5h')!;
    expect(rolling.kind).toBe('allowance');
    expect(rolling.unit).toBe('percentage');
    expect(rolling.used).toBe(12.5);
    expect(rolling.remaining).toBe(87.5);
    expect(rolling.periodValue).toBe(5);
    expect(rolling.periodUnit).toBe('hour');
    expect(rolling.periodCycle).toBe('rolling');

    const weekly = meters.find((m) => m.key === 'weekly')!;
    expect(weekly.used).toBe(30);
    expect(weekly.remaining).toBe(70);
    expect(weekly.periodValue).toBe(7);
    expect(weekly.periodUnit).toBe('day');

    const monthly = meters.find((m) => m.key === 'monthly')!;
    expect(monthly.used).toBe(50);
    expect(monthly.remaining).toBe(50);
    expect(monthly.periodValue).toBe(1);
    expect(monthly.periodUnit).toBe('month');
  });

  it('parses both field orderings (pct-first and reset-first)', async () => {
    setFetchMock(
      async () =>
        new Response(
          mockDashboardHtml([
            { field: 'rollingUsage', usagePercent: 10, resetInSec: 5000 },
            { field: 'weeklyUsage', usagePercent: 25, resetInSec: 60000, resetFirst: true },
          ]),
          { status: 200 }
        )
    );

    const meters = await checkerDef.check(makeCtx());
    expect(meters).toHaveLength(2);

    const rolling = meters.find((m) => m.key === 'rolling_5h')!;
    expect(rolling.used).toBe(10);
    expect(rolling.remaining).toBe(90);

    const weekly = meters.find((m) => m.key === 'weekly')!;
    expect(weekly.used).toBe(25);
    expect(weekly.remaining).toBe(75);
  });

  it('preserves exact legacy reset times, including zero seconds', async () => {
    const now = Date.parse('2026-09-24T12:00:00.000Z');
    registerSpy(Date, 'now').mockReturnValue(now);
    setFetchMock(
      async () =>
        new Response(
          mockDashboardHtml([
            { field: 'rollingUsage', usagePercent: 0, resetInSec: 0 },
            { field: 'weeklyUsage', usagePercent: 25, resetInSec: 3600, resetFirst: true },
            { field: 'monthlyUsage', usagePercent: 70, resetInSec: 86400 },
          ]),
          { status: 200 }
        )
    );

    const meters = await checkerDef.check(makeCtx());
    expect(meters).toHaveLength(3);
    expect(meters.find((m) => m.key === 'rolling_5h')).toMatchObject({
      used: 0,
      resetsAt: '2026-09-24T12:00:00.000Z',
    });
    expect(meters.find((m) => m.key === 'weekly')?.resetsAt).toBe('2026-09-24T13:00:00.000Z');
    expect(meters.find((m) => m.key === 'monthly')?.resetsAt).toBe('2026-09-25T12:00:00.000Z');
  });

  it('returns partial meters when only some windows are available', async () => {
    setFetchMock(
      async () =>
        new Response(
          mockDashboardHtml([{ field: 'monthlyUsage', usagePercent: 80, resetInSec: 999 }]),
          {
            status: 200,
          }
        )
    );

    const meters = await checkerDef.check(makeCtx());
    expect(meters).toHaveLength(1);
    expect(meters[0]!.key).toBe('monthly');
  });

  it('sends auth cookie and user-agent header', async () => {
    let capturedCookie: string | undefined;
    let capturedUA: string | undefined;

    setFetchMock(async (_input: unknown, init: unknown) => {
      const headers = new Headers((init as RequestInit | undefined)?.headers);
      capturedCookie = headers.get('Cookie') ?? undefined;
      capturedUA = headers.get('User-Agent') ?? undefined;
      return new Response(
        mockDashboardHtml([{ field: 'rollingUsage', usagePercent: 5, resetInSec: 100 }]),
        { status: 200 }
      );
    });

    await checkerDef.check(makeCtx());
    expect(capturedCookie).toBe('auth=test-cookie');
    expect(capturedUA).toContain('Firefox');
  });

  it('parses server-rendered usage cards with resets from title timestamps', async () => {
    setFetchMock(
      async () =>
        new Response(
          mockCardHtml([
            { name: 'Rolling', percent: 0 },
            {
              name: 'Weekly',
              percent: 0,
              resetTitle: '2026-09-20T20:00:00Z',
              resetRelative: '7h 58m',
            },
            {
              name: 'Monthly',
              percent: 70,
              resetTitle: '2026-09-24T21:24:56-04:00',
              resetRelative: '4d 9h',
            },
          ]),
          { status: 200 }
        )
    );

    const meters = await checkerDef.check(makeCtx());
    expect(meters).toHaveLength(3);

    const rolling = meters.find((m) => m.key === 'rolling_5h')!;
    expect(rolling.used).toBe(0);
    expect(rolling.remaining).toBe(100);
    expect(rolling.resetsAt).toBeUndefined();

    const weekly = meters.find((m) => m.key === 'weekly')!;
    expect(weekly.used).toBe(0);
    expect(weekly.resetsAt).toBe('2026-09-20T20:00:00.000Z');

    const monthly = meters.find((m) => m.key === 'monthly')!;
    expect(monthly.used).toBe(70);
    expect(monthly.remaining).toBe(30);
    expect(monthly.resetsAt).toBe('2026-09-25T01:24:56.000Z');
  });

  it('falls back to the relative reset duration when the title is unparseable', async () => {
    const now = Date.parse('2026-09-24T12:00:00.000Z');
    registerSpy(Date, 'now').mockReturnValue(now);
    setFetchMock(
      async () =>
        new Response(
          mockCardHtml([
            { name: 'Weekly', percent: 12.5, resetTitle: 'not-a-date', resetRelative: '7h 58m' },
          ]),
          { status: 200 }
        )
    );

    const meters = await checkerDef.check(makeCtx());
    expect(meters).toHaveLength(1);
    expect(meters[0]!.resetsAt).toBe('2026-09-24T19:58:00.000Z');
  });

  it.each([
    ['2026-09-24T21:00:00', '5h', '2026-09-24T17:00:00.000Z'],
    ['9/24/2026, 9:00:00 PM', '2h', '2026-09-24T14:00:00.000Z'],
  ])('uses the relative reset for timezone-free title %s', async (title, relative, expected) => {
    registerSpy(Date, 'now').mockReturnValue(Date.parse('2026-09-24T12:00:00.000Z'));
    setFetchMock(
      async () =>
        new Response(
          mockCardHtml([
            { name: 'Weekly', percent: 12, resetTitle: title, resetRelative: relative },
          ]),
          { status: 200 }
        )
    );

    const meters = await checkerDef.check(makeCtx());
    expect(meters[0]!.resetsAt).toBe(expected);
  });

  it('accepts a timezone-explicit ISO reset title without a colon in the offset', async () => {
    setFetchMock(
      async () =>
        new Response(
          mockCardHtml([
            {
              name: 'Weekly',
              percent: 12,
              resetTitle: '2026-09-24T21:00:00+0530',
              resetRelative: '5h',
            },
          ]),
          { status: 200 }
        )
    );

    const meters = await checkerDef.check(makeCtx());
    expect(meters[0]!.resetsAt).toBe('2026-09-24T15:30:00.000Z');
  });

  it.each([
    ['5 hours 30 minutes', '2026-09-24T17:30:00.000Z'],
    ['2 days 4 hours', '2026-09-26T16:00:00.000Z'],
    ['1d, 2h, 3m', '2026-09-25T14:03:00.000Z'],
    ['5 hrs 30 min 15 sec', '2026-09-24T17:30:15.000Z'],
    ['1 hr 5 mins 15 secs', '2026-09-24T13:05:15.000Z'],
    ['4d9h', '2026-09-28T21:00:00.000Z'],
    ['about 5h', '2026-09-24T17:00:00.000Z'],
  ])('parses the complete relative reset %s', async (relative, expected) => {
    registerSpy(Date, 'now').mockReturnValue(Date.parse('2026-09-24T12:00:00.000Z'));
    setFetchMock(
      async () =>
        new Response(
          mockCardHtml([
            { name: 'Weekly', percent: 12, resetTitle: 'not-an-ISO-date', resetRelative: relative },
          ]),
          { status: 200 }
        )
    );

    const meters = await checkerDef.check(makeCtx());
    expect(meters[0]!.resetsAt).toBe(expected);
  });

  it.each(['2 months', '2 months 4 hours', '5 hours nonsense'])(
    'does not parse a partial or unsupported relative reset %s',
    async (relative) => {
      registerSpy(Date, 'now').mockReturnValue(Date.parse('2026-09-24T12:00:00.000Z'));
      setFetchMock(
        async () =>
          new Response(
            mockCardHtml([
              {
                name: 'Weekly',
                percent: 12,
                resetTitle: 'not-an-ISO-date',
                resetRelative: relative,
              },
            ]),
            { status: 200 }
          )
      );

      const meters = await checkerDef.check(makeCtx());
      expect(meters[0]!.resetsAt).toBeUndefined();
    }
  );

  it('does not leak a preceding card reset into a card without reset metadata', async () => {
    setFetchMock(
      async () =>
        new Response(
          mockCardHtml([
            {
              name: 'Weekly',
              percent: 10,
              resetTitle: '2026-09-20T20:00:00Z',
              resetRelative: '7h 58m',
            },
            { name: 'Monthly', percent: 70 },
          ]),
          { status: 200 }
        )
    );

    const meters = await checkerDef.check(makeCtx());
    expect(meters).toHaveLength(2);

    const weekly = meters.find((m) => m.key === 'weekly')!;
    expect(weekly.resetsAt).toBe('2026-09-20T20:00:00.000Z');

    const monthly = meters.find((m) => m.key === 'monthly')!;
    expect(monthly.used).toBe(70);
    expect(monthly.resetsAt).toBeUndefined();
  });

  it('keeps badge-only percentages within adjacent cards when wrapper classes change order', async () => {
    setFetchMock(
      async () =>
        new Response(
          mockCardHtml([
            {
              name: 'Weekly',
              percent: 17,
              ariaValueNow: null,
              ariaValueText: null,
              wrapperClass: 'rounded-md flex border flex-col px-4 py-3',
            },
            {
              name: 'Monthly',
              percent: 71,
              ariaValueNow: null,
              ariaValueText: null,
              wrapperClass: 'rounded-md border px-4 flex py-3 flex-col',
            },
          ]),
          { status: 200 }
        )
    );

    const meters = await checkerDef.check(makeCtx());
    expect(meters).toHaveLength(2);
    expect(meters.find((m) => m.key === 'weekly')?.used).toBe(17);
    expect(meters.find((m) => m.key === 'monthly')?.used).toBe(71);
  });

  it('omits a card with no badge, aria value, or wrapper class instead of using a neighbor', async () => {
    setFetchMock(
      async () =>
        new Response(
          mockCardHtml([
            { name: 'Weekly', percent: 17, ariaValueNow: null, ariaValueText: null },
            {
              name: 'Monthly',
              percent: 71,
              badgePercent: null,
              ariaValueNow: null,
              ariaValueText: null,
              wrapperClass: '',
            },
          ]),
          { status: 200 }
        )
    );

    const meters = await checkerDef.check(makeCtx());
    expect(meters.map((m) => m.key)).toEqual(['weekly']);
    expect(meters[0]!.used).toBe(17);
  });

  it('keeps reset metadata within its card when wrapper classes change order', async () => {
    setFetchMock(
      async () =>
        new Response(
          mockCardHtml([
            {
              name: 'Weekly',
              percent: 17,
              resetTitle: '2026-09-24T21:00:00Z',
              resetRelative: '5h',
            },
            {
              name: 'Monthly',
              percent: 71,
              wrapperClass: 'rounded-md flex border flex-col px-4 py-3',
            },
          ]),
          { status: 200 }
        )
    );

    const meters = await checkerDef.check(makeCtx());
    expect(meters.find((m) => m.key === 'weekly')?.resetsAt).toBe('2026-09-24T21:00:00.000Z');
    expect(meters.find((m) => m.key === 'monthly')?.resetsAt).toBeUndefined();
  });

  it('reads aria-valuenow before aria-label in the same progressbar opening tag', async () => {
    setFetchMock(
      async () =>
        new Response(
          mockCardHtml([
            {
              name: 'Weekly',
              percent: 42,
              badgePercent: null,
              ariaValueText: null,
              ariaValueBeforeLabel: true,
            },
          ]),
          { status: 200 }
        )
    );

    const meters = await checkerDef.check(makeCtx());
    expect(meters.map((m) => [m.key, m.used])).toEqual([['weekly', 42]]);
  });

  it('does not read aria values from the following progressbar opening tag', async () => {
    setFetchMock(
      async () =>
        new Response(
          '<div role="progressbar" aria-label="Weekly usage used"></div>' +
            '<div role="progressbar" aria-label="Monthly usage used" aria-valuenow="63"></div>',
          { status: 200 }
        )
    );

    const meters = await checkerDef.check(makeCtx());
    expect(meters.map((m) => [m.key, m.used])).toEqual([['monthly', 63]]);
  });

  it('prefers usage cards over flight data when both are present', async () => {
    setFetchMock(
      async () =>
        new Response(
          mockDashboardHtml([{ field: 'rollingUsage', usagePercent: 99, resetInSec: 5 }]) +
            mockCardHtml([{ name: 'Rolling', percent: 3 }]),
          { status: 200 }
        )
    );

    const meters = await checkerDef.check(makeCtx());
    expect(meters).toHaveLength(1);
    expect(meters[0]!.used).toBe(3);
  });

  it('throws when no windows can be parsed from HTML', async () => {
    setFetchMock(
      async () => new Response('<html><body>no data here</body></html>', { status: 200 })
    );

    await expect(checkerDef.check(makeCtx())).rejects.toThrow(
      'Could not parse any OpenCode Go dashboard usage windows'
    );
  });

  it('throws on non-200 response', async () => {
    setFetchMock(async () => new Response('Forbidden', { status: 403, statusText: 'Forbidden' }));

    await expect(checkerDef.check(makeCtx())).rejects.toThrow('OpenCode Go dashboard error');
  });

  it('uses custom endpoint when configured', async () => {
    let capturedUrl: string | undefined;

    setFetchMock(async (input: unknown) => {
      capturedUrl = typeof input === 'string' ? input : undefined;
      return new Response(
        mockDashboardHtml([{ field: 'rollingUsage', usagePercent: 1, resetInSec: 10 }]),
        { status: 200 }
      );
    });

    await checkerDef.check(makeCtx({ endpoint: 'https://custom.example.com/dashboard' }));
    expect(capturedUrl).toBe('https://custom.example.com/dashboard');
  });

  it('throws with actionable message when workspaceId is missing', async () => {
    await expect(checkerDef.check(createMeterContext('test', 'opencode-go', {}))).rejects.toThrow(
      'OpenCode Go requires workspaceId, authCookie'
    );
  });

  it('throws with actionable message when authCookie is missing', async () => {
    await expect(
      checkerDef.check(createMeterContext('test', 'opencode-go', { workspaceId: 'ws-1' }))
    ).rejects.toThrow('OpenCode Go requires authCookie');
  });
});
