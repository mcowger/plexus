import { logger } from '../../utils/logger';
import type { QuotaSnapshot } from '../../types/quota';

interface EstimationResult {
  projectedUsedAtReset: number;
  projectedUtilizationPercent: number;
  willExceed: boolean;
  exceedanceTimestamp?: number;
  projectionBasedOnMinutes: number;
}

export class QuotaEstimator {
  /**
   * Calculate projected quota usage at reset time based on historical data
   *
   * @param checkerId - Checker ID for logging
   * @param windowType - Type of quota window
   * @param currentUsed - Current usage value
   * @param limit - Quota limit (if any)
   * @param resetsAt - When the quota resets (timestamp in ms)
   * @param history - Historical snapshots for this window, ordered by checkedAt DESC
   * @returns Estimation data or null if insufficient data
   */
  static estimateUsageAtReset(
    checkerId: string,
    windowType: string,
    currentUsed: number | null | undefined,
    limit: number | null | undefined,
    resetsAt: number | null | undefined,
    history: QuotaSnapshot[]
  ): EstimationResult | null {
    // Can't estimate without current usage or reset time
    if (currentUsed == null || resetsAt == null) {
      return null;
    }

    const now = Date.now();
    const timeUntilReset = resetsAt - now;

    // If quota already reset or about to reset (< 1 minute), no point estimating
    if (timeUntilReset <= 60_000) {
      return null;
    }

    // Filter history to relevant snapshots (same window type, not in future)
    const relevantHistory = history
      .filter((s) => s.windowType === windowType && s.checkedAt <= now && s.used != null)
      .sort((a, b) => b.checkedAt - a.checkedAt); // Ensure DESC order

    if (relevantHistory.length < 2) {
      logger.debug(
        `[QuotaEstimator] Not enough history for ${checkerId}:${windowType} (${relevantHistory.length} snapshots)`
      );
      return null;
    }

    // Use data from the last hour for short windows (hourly), or last 6 hours for longer windows
    const lookbackMs = windowType === 'hourly' ? 60 * 60 * 1000 : 6 * 60 * 60 * 1000;
    const lookbackStart = now - lookbackMs;

    const recentHistory = relevantHistory.filter((s) => s.checkedAt >= lookbackStart);

    if (recentHistory.length < 2) {
      logger.debug(
        `[QuotaEstimator] Not enough recent history for ${checkerId}:${windowType} (${recentHistory.length} snapshots in last ${lookbackMs}ms)`
      );
      return null;
    }

    // Calculate usage rate (units per millisecond)
    // Use linear regression for better accuracy with multiple data points
    const usageRate = this.calculateUsageRate(recentHistory);

    if (usageRate === null || usageRate <= 0) {
      logger.debug(
        `[QuotaEstimator] Invalid usage rate for ${checkerId}:${windowType}: ${usageRate}`
      );
      return null;
    }

    // Project usage at reset time
    const projectedUsedAtReset = currentUsed + usageRate * timeUntilReset;

    // Calculate projected utilization
    const projectedUtilizationPercent =
      limit != null && limit > 0 ? (projectedUsedAtReset / limit) * 100 : 0;

    // Determine if quota will exceed
    const willExceed = limit != null && projectedUsedAtReset > limit;

    // Calculate when exceedance will occur
    let exceedanceTimestamp: number | undefined;
    if (willExceed && limit != null) {
      const remaining = limit - currentUsed;
      const timeToExceedMs = remaining / usageRate;
      exceedanceTimestamp = now + timeToExceedMs;
    }

    const oldestSnapshotUsed = recentHistory[recentHistory.length - 1];
    const projectionBasedOnMinutes = oldestSnapshotUsed
      ? Math.round((now - oldestSnapshotUsed.checkedAt) / 60_000)
      : 0;

    logger.debug(
      `[QuotaEstimator] ${checkerId}:${windowType} - ` +
        `current=${currentUsed.toFixed(1)}, ` +
        `rate=${(usageRate * 3600_000).toFixed(2)}/hr, ` +
        `projected=${projectedUsedAtReset.toFixed(1)} ` +
        `(${projectedUtilizationPercent.toFixed(1)}%), ` +
        `willExceed=${willExceed}, ` +
        `basedOn=${projectionBasedOnMinutes}min`
    );

    return {
      projectedUsedAtReset,
      projectedUtilizationPercent,
      willExceed,
      exceedanceTimestamp,
      projectionBasedOnMinutes,
    };
  }

  /**
   * Calculate usage rate using linear regression for better accuracy
   * Returns units per millisecond
   */
  private static calculateUsageRate(snapshots: QuotaSnapshot[]): number | null {
    if (snapshots.length < 2) {
      return null;
    }

    // Simple linear regression: fit y = mx + b where:
    // x = time (checkedAt)
    // y = usage (used)
    // m = usage rate (slope)

    const n = snapshots.length;
    let sumX = 0;
    let sumY = 0;
    let sumXY = 0;
    let sumXX = 0;

    for (const snapshot of snapshots) {
      const x = snapshot.checkedAt;
      const y = snapshot.used ?? 0;
      sumX += x;
      sumY += y;
      sumXY += x * y;
      sumXX += x * x;
    }

    const denominator = n * sumXX - sumX * sumX;

    if (denominator === 0) {
      // Fallback to simple rate calculation between first and last point
      const first = snapshots[snapshots.length - 1];
      const last = snapshots[0];

      if (!first || !last) {
        return null;
      }

      const deltaUsage = (last.used ?? 0) - (first.used ?? 0);
      const deltaTime = last.checkedAt - first.checkedAt;

      if (deltaTime <= 0) {
        return null;
      }

      return deltaUsage / deltaTime;
    }

    // Calculate slope (usage rate)
    const slope = (n * sumXY - sumX * sumY) / denominator;

    return slope;
  }
}
