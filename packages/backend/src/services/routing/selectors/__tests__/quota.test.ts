import { describe, expect, it, vi } from 'vitest';
import type { ModelTarget } from '../../../../config';
import type { MeterCheckResult } from '../../../../types/meter';
import { QuotaSelector, QuotaSnapshotProvider } from '../quota';

const HOUR_MS = 60 * 60 * 1000;

function result(
  provider: string,
  meters: MeterCheckResult['meters'],
  success = true
): MeterCheckResult {
  return {
    checkerId: `${provider}-quota`,
    checkerType: 'test',
    provider,
    checkedAt: new Date().toISOString(),
    success,
    meters,
  };
}

function allowance(utilizationPercent: number, resetsInHours: number) {
  return {
    key: 'window',
    label: 'Window',
    kind: 'allowance' as const,
    unit: 'requests',
    limit: 100,
    used: utilizationPercent,
    remaining: 100 - utilizationPercent,
    utilizationPercent,
    periodValue: 1,
    periodUnit: 'day' as const,
    periodCycle: 'fixed' as const,
    resetsAt: new Date(Date.now() + resetsInHours * HOUR_MS).toISOString(),
    status: 'ok' as const,
  };
}

function target(provider: string): ModelTarget {
  return { provider, model: 'claude' };
}

describe('QuotaSelector', () => {
  it('returns null for empty targets and the target for a single candidate', async () => {
    const provider: QuotaSnapshotProvider = {
      getLatestQuotaForProvider: vi.fn(),
    };
    const selector = new QuotaSelector(provider);
    const onlyTarget = target('one');

    expect(await selector.select([])).toBeNull();
    expect(await selector.select([onlyTarget])).toEqual(onlyTarget);
    expect(provider.getLatestQuotaForProvider).not.toHaveBeenCalled();
  });

  it('favors the tracked plan with more quota to consume before its reset', async () => {
    const snapshots = new Map([
      ['soon', result('soon', [allowance(0, 24)])],
      ['later', result('later', [allowance(50, 72)])],
    ]);
    const provider: QuotaSnapshotProvider = {
      getLatestQuotaForProvider: vi.fn((name: string) =>
        Promise.resolve(snapshots.get(name) ?? null)
      ),
    };
    const selector = new QuotaSelector(provider);

    expect(await selector.select([target('later'), target('soon')])).toEqual(target('soon'));
  });

  it('uses remaining plus used values when utilization is unknown', async () => {
    const snapshots = new Map([
      [
        'available',
        result('available', [
          {
            ...allowance(0, 24),
            utilizationPercent: 'unknown',
            used: 10,
            remaining: 90,
          },
        ]),
      ],
      ['full', result('full', [allowance(90, 24)])],
    ]);
    const provider: QuotaSnapshotProvider = {
      getLatestQuotaForProvider: vi.fn((name: string) =>
        Promise.resolve(snapshots.get(name) ?? null)
      ),
    };
    const selector = new QuotaSelector(provider);

    expect(await selector.select([target('full'), target('available')])).toEqual(
      target('available')
    );
  });

  it('can select a highly utilized plan when its reset is much sooner', async () => {
    const snapshots = new Map([
      ['nearly-full', result('nearly-full', [allowance(96, 1)])],
      ['available', result('available', [allowance(50, 72)])],
    ]);
    const provider: QuotaSnapshotProvider = {
      getLatestQuotaForProvider: vi.fn((name: string) =>
        Promise.resolve(snapshots.get(name) ?? null)
      ),
    };
    const selector = new QuotaSelector(provider);

    expect(await selector.select([target('available'), target('nearly-full')])).toEqual(
      target('nearly-full')
    );
  });

  it('ignores expired windows instead of treating them as current quota pressure', async () => {
    const snapshots = new Map([
      [
        'expired',
        result('expired', [
          {
            ...allowance(10, -1),
            resetsAt: new Date(Date.now() - HOUR_MS).toISOString(),
          },
        ]),
      ],
      ['balance', result('balance', [{ ...allowance(50, 24), resetsAt: undefined }])],
    ]);
    const selector = new QuotaSelector({
      getLatestQuotaForProvider: vi.fn((name: string) =>
        Promise.resolve(snapshots.get(name) ?? null)
      ),
    });

    expect(await selector.select([target('expired'), target('balance')])).toEqual(
      target('balance')
    );
  });

  it('tracks balance-only meters without reset times as non-expiring quota', async () => {
    const selector = new QuotaSelector({
      getLatestQuotaForProvider: vi.fn((provider: string) =>
        Promise.resolve(
          provider === 'balance'
            ? result('balance', [{ ...allowance(50, 24), resetsAt: undefined }])
            : null
        )
      ),
    });

    expect(await selector.select([target('untracked'), target('balance')])).toEqual(
      target('balance')
    );
  });

  it('orders balance-only meters by remaining headroom', async () => {
    const snapshots = new Map([
      ['more-headroom', result('more-headroom', [{ ...allowance(10, 24), resetsAt: undefined }])],
      ['less-headroom', result('less-headroom', [{ ...allowance(80, 24), resetsAt: undefined }])],
    ]);
    const selector = new QuotaSelector({
      getLatestQuotaForProvider: vi.fn((provider: string) =>
        Promise.resolve(snapshots.get(provider) ?? null)
      ),
    });

    expect(await selector.select([target('less-headroom'), target('more-headroom')])).toEqual(
      target('more-headroom')
    );
  });

  it('uses the most constrained resettable meter for a plan', async () => {
    const snapshots = new Map([
      ['multiple-windows', result('multiple-windows', [allowance(0, 24), allowance(50, 72)])],
      ['single-window', result('single-window', [allowance(25, 72)])],
    ]);
    const provider: QuotaSnapshotProvider = {
      getLatestQuotaForProvider: vi.fn((name: string) =>
        Promise.resolve(snapshots.get(name) ?? null)
      ),
    };
    const selector = new QuotaSelector(provider);

    expect(await selector.select([target('multiple-windows'), target('single-window')])).toEqual(
      target('single-window')
    );
  });

  it('keeps untracked and failed quota targets as declared-order fallbacks', async () => {
    const snapshots = new Map([
      ['failed', result('failed', [], false)],
      ['tracked', result('tracked', [allowance(10, 24)])],
    ]);
    const provider: QuotaSnapshotProvider = {
      getLatestQuotaForProvider: vi.fn((name: string) =>
        Promise.resolve(snapshots.get(name) ?? null)
      ),
    };
    const selector = new QuotaSelector(provider);

    expect(
      await selector.select([target('untracked'), target('failed'), target('tracked')])
    ).toEqual(target('tracked'));

    const fallbackSelector = new QuotaSelector({
      getLatestQuotaForProvider: vi.fn(() => Promise.resolve(null)),
    });
    expect(await fallbackSelector.select([target('first'), target('second')])).toEqual(
      target('first')
    );
  });

  it('treats exhausted meters as having zero available headroom', async () => {
    const snapshots = new Map([
      [
        'exhausted',
        result('exhausted', [
          {
            ...allowance(0, 24),
            status: 'exhausted',
            utilizationPercent: 'unknown',
            remaining: 0,
          },
        ]),
      ],
      ['available', result('available', [allowance(50, 72)])],
    ]);
    const selector = new QuotaSelector({
      getLatestQuotaForProvider: vi.fn((name: string) =>
        Promise.resolve(snapshots.get(name) ?? null)
      ),
    });

    expect(await selector.select([target('exhausted'), target('available')])).toEqual(
      target('available')
    );
  });

  it('shares quota reads while ordering the full candidate list', async () => {
    const getLatestQuotaForProvider = vi.fn(() =>
      Promise.resolve(result('tracked', [allowance(10, 24)]))
    );
    const selector = new QuotaSelector({ getLatestQuotaForProvider });
    const candidates = [target('tracked'), target('tracked')];

    await selector.select(candidates);
    await selector.select(candidates);

    expect(getLatestQuotaForProvider).toHaveBeenCalledTimes(1);
  });
});
