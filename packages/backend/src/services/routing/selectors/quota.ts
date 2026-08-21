import { ModelTarget } from '../../../config';
import type { Meter, MeterCheckResult } from '../../../types/meter';
import { logger } from '../../../utils/logger';
import { Selector } from './base';

const MILLISECONDS_PER_HOUR = 60 * 60 * 1000;

export interface QuotaSnapshotProvider {
  getLatestQuotaForProvider(provider: string): Promise<MeterCheckResult | null>;
}

interface ScoredTarget {
  target: ModelTarget;
  category: 'expiring' | 'balance' | 'unknown';
  score: number;
  order: number;
}

function getUtilization(meter: Meter): number | null {
  if (meter.status === 'exhausted') return 100;

  if (
    typeof meter.remaining === 'number' &&
    Number.isFinite(meter.remaining) &&
    meter.remaining <= 0
  ) {
    return 100;
  }

  if (typeof meter.utilizationPercent === 'number' && Number.isFinite(meter.utilizationPercent)) {
    return Math.min(100, Math.max(0, meter.utilizationPercent));
  }

  if (
    typeof meter.used === 'number' &&
    Number.isFinite(meter.used) &&
    typeof meter.limit === 'number' &&
    Number.isFinite(meter.limit) &&
    meter.limit > 0
  ) {
    return Math.min(100, Math.max(0, (meter.used / meter.limit) * 100));
  }

  if (
    typeof meter.remaining === 'number' &&
    Number.isFinite(meter.remaining) &&
    typeof meter.limit === 'number' &&
    Number.isFinite(meter.limit) &&
    meter.limit > 0
  ) {
    return Math.min(100, Math.max(0, 100 - (meter.remaining / meter.limit) * 100));
  }

  if (
    typeof meter.used === 'number' &&
    Number.isFinite(meter.used) &&
    typeof meter.remaining === 'number' &&
    Number.isFinite(meter.remaining)
  ) {
    const total = meter.used + meter.remaining;
    if (total > 0) return Math.min(100, Math.max(0, (meter.used / total) * 100));
  }

  return null;
}

function getBurnDownScore(
  result: MeterCheckResult
): { category: ScoredTarget['category']; score: number } | null {
  if (!result.success) return null;

  const meters = result.meters
    .map((meter) => ({ meter, utilization: getUtilization(meter) }))
    .filter((entry): entry is { meter: Meter; utilization: number } => entry.utilization !== null);

  if (meters.length === 0) return null;

  const now = Date.now();
  const deadlineScores: number[] = [];
  const balanceScores: number[] = [];

  for (const { meter, utilization } of meters) {
    if (!meter.resetsAt) {
      balanceScores.push((100 - utilization) / 100);
      continue;
    }

    const resetsAtMs = Date.parse(meter.resetsAt);
    // Expired windows are not current quota pressure. Ignore them instead of
    // assigning zero headroom, which could make a freshly reset plan look
    // exhausted. Expired-only snapshots remain unknown until the next poll.
    if (!Number.isFinite(resetsAtMs) || resetsAtMs <= now) continue;

    const remainingHeadroom = (100 - utilization) / 100;
    const hoursUntilReset = Math.max((resetsAtMs - now) / MILLISECONDS_PER_HOUR, 1 / 60);
    deadlineScores.push(remainingHeadroom / hoursUntilReset);
  }

  if (deadlineScores.length > 0) {
    return { category: 'expiring', score: Math.min(...deadlineScores) };
  }

  if (balanceScores.length > 0) {
    // A balance without a reset has no expiry pressure. Rank it after
    // resettable quotas, using remaining headroom to order balances.
    return { category: 'balance', score: Math.min(...balanceScores) };
  }

  return { category: 'unknown', score: 0 };
}

export class QuotaSelector extends Selector {
  private readonly quotaProvider: QuotaSnapshotProvider;
  private readonly snapshotCache = new Map<string, Promise<MeterCheckResult | null>>();

  constructor(quotaProvider: QuotaSnapshotProvider) {
    super();
    this.quotaProvider = quotaProvider;
  }

  async select(targets: ModelTarget[]): Promise<ModelTarget | null> {
    if (!targets || targets.length === 0) return null;
    if (targets.length === 1) return targets[0] ?? null;

    const scoredTargets = await Promise.all(
      targets.map(async (target, order): Promise<ScoredTarget> => {
        if (!target.provider) {
          return { target, category: 'unknown', score: 0, order };
        }

        const result = await this.getSnapshot(target.provider);
        const score = result ? getBurnDownScore(result) : null;
        return {
          target,
          category: score?.category ?? 'unknown',
          score: score?.score ?? 0,
          order,
        };
      })
    );

    scoredTargets.sort((a, b) => {
      const categoryRank = { expiring: 0, balance: 1, unknown: 2 };
      const categoryDifference = categoryRank[a.category] - categoryRank[b.category];
      if (categoryDifference !== 0) return categoryDifference;
      if (a.score !== b.score) return b.score - a.score;
      return a.order - b.order;
    });

    return scoredTargets[0]?.target ?? null;
  }

  private getSnapshot(provider: string): Promise<MeterCheckResult | null> {
    const cached = this.snapshotCache.get(provider);
    if (cached) return cached;

    const snapshot = this.quotaProvider.getLatestQuotaForProvider(provider).catch((error) => {
      logger.debug(`QuotaSelector: failed to read quota for provider '${provider}': ${error}`);
      return null;
    });
    this.snapshotCache.set(provider, snapshot);
    return snapshot;
  }
}
