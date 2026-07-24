import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMeterContext, isCheckerRegistered } from '../../checker-registry';
import checkerDef from '../claude-code-checker';

const makeCtx = (options: Record<string, unknown> = {}) =>
  createMeterContext('claude-code-test', 'claude-code', {
    apiKey: 'test-claude-token',
    ...options,
  });

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

function fableLimit(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'weekly_scoped',
    group: 'weekly',
    percent: 0,
    severity: 'normal',
    resets_at: '2026-06-04T00:00:00Z',
    is_active: false,
    scope: { model: { id: null, display_name: 'Fable' }, surface: null },
    ...overrides,
  };
}

describe('claude-code checker', () => {
  let capturedAuth: string | undefined;

  const setFetchMock = (response: Response): void => {
    global.fetch = vi.fn(async (_input: unknown, init: unknown) => {
      capturedAuth =
        new Headers((init as RequestInit | undefined)?.headers).get('Authorization') ?? undefined;
      return response;
    }) as unknown as typeof fetch;
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    capturedAuth = undefined;
  });

  it('is registered under claude-code', () => {
    expect(isCheckerRegistered('claude-code')).toBe(true);
  });

  it('parses five_hour and seven_day top-level windows', async () => {
    setFetchMock(
      jsonResponse({
        five_hour: { utilization: 15, resets_at: '2026-06-01T21:00:00Z' },
        seven_day: { utilization: 40, resets_at: '2026-06-04T00:00:00Z' },
      })
    );

    const meters = await checkerDef.check(makeCtx());

    expect(capturedAuth).toBe('Bearer test-claude-token');
    expect(meters).toHaveLength(2);
    expect(meters[0]).toMatchObject({
      key: 'five_hour',
      label: '5-hour quota',
      used: 15,
      remaining: 85,
      resetsAt: '2026-06-01T21:00:00.000Z',
    });
    expect(meters[1]).toMatchObject({
      key: 'weekly',
      label: 'Weekly quota',
      used: 40,
      remaining: 60,
      resetsAt: '2026-06-04T00:00:00.000Z',
    });
  });

  it('renders a scoped weekly limit from limits[] as its own meter', async () => {
    setFetchMock(
      jsonResponse({
        five_hour: { utilization: 6, resets_at: '2026-06-01T21:00:00Z' },
        seven_day: { utilization: 23, resets_at: '2026-06-04T00:00:00Z' },
        limits: [fableLimit({ percent: 12 })],
      })
    );

    const meters = await checkerDef.check(makeCtx());

    expect(meters.map((m) => m.key)).toEqual(['five_hour', 'weekly', 'weekly_model_fable']);

    const fableMeter = meters.find((m) => m.key === 'weekly_model_fable');
    expect(fableMeter).toMatchObject({
      label: 'Weekly · Fable',
      used: 12,
      remaining: 88,
      scope: 'model',
      resetsAt: '2026-06-04T00:00:00.000Z',
    });
  });

  it('renders a scoped window that is at zero percent', async () => {
    setFetchMock(
      jsonResponse({
        seven_day: { utilization: 23, resets_at: '2026-06-04T00:00:00Z' },
        limits: [fableLimit({ percent: 0, is_active: false })],
      })
    );

    const meters = await checkerDef.check(makeCtx());

    const fableMeter = meters.find((m) => m.key === 'weekly_model_fable');
    expect(fableMeter).toMatchObject({
      used: 0,
      remaining: 100,
    });
  });

  it('ignores session and weekly_all limit entries in limits[]', async () => {
    setFetchMock(
      jsonResponse({
        five_hour: { utilization: 6, resets_at: '2026-06-01T21:00:00Z' },
        seven_day: { utilization: 23, resets_at: '2026-06-04T00:00:00Z' },
        limits: [
          { kind: 'session', percent: 6, resets_at: '2026-06-01T21:00:00Z', scope: null },
          { kind: 'weekly_all', percent: 23, resets_at: '2026-06-04T00:00:00Z', scope: null },
          fableLimit(),
        ],
      })
    );

    const meters = await checkerDef.check(makeCtx());

    expect(meters.map((m) => m.key)).toEqual(['five_hour', 'weekly', 'weekly_model_fable']);
  });

  it('labels a surface-scoped limit from its surface name', async () => {
    setFetchMock(
      jsonResponse({
        seven_day: { utilization: 23, resets_at: '2026-06-04T00:00:00Z' },
        limits: [
          fableLimit({
            scope: { model: null, surface: { id: 'code', display_name: 'Code' } },
          }),
        ],
      })
    );

    const meters = await checkerDef.check(makeCtx());

    expect(meters).toContainEqual(
      expect.objectContaining({
        key: 'weekly_surface_code',
        label: 'Weekly · Code',
        scope: 'surface',
      })
    );
  });

  it('keeps valid meters when a limits entry is malformed', async () => {
    setFetchMock(
      jsonResponse({
        five_hour: { utilization: 6, resets_at: '2026-06-01T21:00:00Z' },
        seven_day: { utilization: 23, resets_at: '2026-06-04T00:00:00Z' },
        limits: [{ percent: 'not-a-valid-number' }, fableLimit()],
      })
    );

    const meters = await checkerDef.check(makeCtx());

    expect(meters.map((m) => m.key)).toEqual(['five_hour', 'weekly', 'weekly_model_fable']);
  });

  it('reconciles legacy seven_day_opus key with limits[] entry', async () => {
    setFetchMock(
      jsonResponse({
        seven_day_opus: { utilization: 10, resets_at: '2026-06-04T00:00:00Z' },
        limits: [
          fableLimit({
            percent: 25,
            scope: { model: { id: 'claude-3-opus', display_name: 'Opus' }, surface: null },
          }),
        ],
      })
    );

    const meters = await checkerDef.check(makeCtx());

    expect(meters).toHaveLength(1);
    expect(meters[0]).toMatchObject({
      key: 'weekly_model_claude-3-opus',
      label: 'Weekly · Opus',
      used: 25,
    });
  });

  it('distinguishes model and surface limits sharing the same name', async () => {
    setFetchMock(
      jsonResponse({
        limits: [
          fableLimit({
            percent: 5,
            scope: { model: { id: null, display_name: 'Code' }, surface: null },
          }),
          fableLimit({
            percent: 15,
            scope: { model: null, surface: { id: 'code', display_name: 'Code' } },
          }),
        ],
      })
    );

    const meters = await checkerDef.check(makeCtx());

    expect(meters.map((m) => m.key)).toEqual(['weekly_model_code', 'weekly_surface_code']);
    expect(meters[0]).toMatchObject({ used: 5 });
    expect(meters[1]).toMatchObject({ used: 15 });
  });

  it('throws for non-200 HTTP response', async () => {
    setFetchMock(new Response('unauthorized', { status: 401, statusText: 'Unauthorized' }));

    await expect(checkerDef.check(makeCtx())).rejects.toThrow('HTTP 401: Unauthorized');
  });
});
