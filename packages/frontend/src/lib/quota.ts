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

/** Sort most-constrained (least remaining headroom) first, mirroring the
 * backend's own `mostConstrained` shim. A `limit === 0` entry is treated as
 * fully constrained (ratio 0) rather than dividing by zero. */
export function sortMostConstrainedFirst(entries: QuotaStatusEntry[]): QuotaStatusEntry[] {
  const ratio = (e: QuotaStatusEntry) => (e.limit > 0 ? e.remaining / e.limit : 0);
  return [...entries].sort((a, b) => ratio(a) - ratio(b));
}
