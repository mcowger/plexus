/**
 * Format a fractional number of minutes into a human-readable "min:sec" string.
 *
 * Examples:
 *   2      → "2m"
 *   0.5    → "30s"
 *   1.5    → "1m 30s"
 *   0.25   → "15s"
 *
 * @param minutes - The number of minutes (can be fractional, e.g. 0.5 for 30 seconds)
 * @returns A formatted string like "2m", "30s", or "1m 30s"
 */
export function formatMinutesToMinSec(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return '0s';
  }

  const totalSeconds = Math.round(minutes * 60);
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;

  if (mins === 0) {
    return `${secs}s`;
  }

  if (secs === 0) {
    return `${mins}m`;
  }

  return `${mins}m ${secs}s`;
}

/**
 * Format a duration in milliseconds into a human-readable "min:sec" string.
 *
 * Examples:
 *   120000  → "2m"
 *   30000   → "30s"
 *   90000   → "1m 30s"
 *
 * @param ms - The duration in milliseconds
 * @returns A formatted string like "2m", "30s", or "1m 30s"
 */
export function formatMsToMinSec(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) {
    return '0s';
  }

  const totalSeconds = Math.ceil(ms / 1000);
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;

  if (mins === 0) {
    return `${secs}s`;
  }

  if (secs === 0) {
    return `${mins}m`;
  }

  return `${mins}m ${secs}s`;
}
