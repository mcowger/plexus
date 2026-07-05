import type { QuotaStatusEntry } from './api';
import { formatCost, formatNumber } from './format';
import type { MeterStatus } from '../types/quota';

/**
 * Map a quota utilization percentage onto the progress-bar status colors
 * shared by every quota view (MyKey, admin Keys, limited-user OverallTab).
 * Kept in sync with `QuotaProgressBar`'s palette.
 */
export function statusForPercent(pct: number): MeterStatus {
  if (pct >= 100) return 'exhausted';
  if (pct >= 90) return 'critical';
  if (pct >= 75) return 'warning';
  return 'ok';
}

/**
 * Format a quota usage value based on its limitType. `cost` renders at 5
 * decimals (quota spend is often fractions of a cent); `tokens` and
 * `requests` reuse the compact number formatter.
 */
export function formatQuotaValue(value: number, limitType: QuotaStatusEntry['limitType']): string {
  return limitType === 'cost' ? formatCost(value, 5) : formatNumber(value);
}

/** Most-constrained ranking now lives in @plexus/shared so the backend's
 * selectors and every frontend view use the exact same ratio logic. */
export { mostConstrained, sortMostConstrainedFirst } from '@plexus/shared';

/**
 * Usage percentage for a quota entry, shared by QuotaStatusCard and the Keys
 * list rows so the zero-limit behavior can't drift. A `limit <= 0` entry has
 * no headroom at all, so when blocked it renders as fully used (100%) rather
 * than an ok-looking empty bar.
 */
export function quotaUsagePercent(
  entry: Pick<QuotaStatusEntry, 'limit' | 'currentUsage' | 'allowed'>
): number {
  if (entry.limit > 0) return Math.min(100, (entry.currentUsage / entry.limit) * 100);
  return entry.allowed ? 0 : 100;
}
