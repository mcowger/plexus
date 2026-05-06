import { beforeEach, describe, expect, it, vi } from 'vitest';
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

describe('opencode-go checker', () => {
  const setFetchMock = (impl: (...args: unknown[]) => Promise<Response>): void => {
    global.fetch = vi.fn(impl) as unknown as typeof fetch;
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

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
