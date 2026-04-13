import humanFormat from 'human-format';

export const KWH_PER_SLICE = 0.01;

/**
 * Format a duration in seconds to human-readable format (e.g., "2h 30m", "45m", "30s", "3mo 2w", "1y 2mo")
 */
export function formatDuration(seconds: number): string {
  if (seconds < 0) return 'Expired';
  if (seconds === 0) return '0s';

  const years = Math.floor(seconds / 31536000);
  const months = Math.floor((seconds % 31536000) / 2592000);
  const weeks = Math.floor((seconds % 2592000) / 604800);
  const days = Math.floor((seconds % 604800) / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  const parts: string[] = [];
  if (years > 0) parts.push(`${years}y`);
  if (months > 0) parts.push(`${months}mo`);
  if (weeks > 0) parts.push(`${weeks}w`);
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (secs > 0 && years === 0 && months === 0 && weeks === 0 && days === 0 && hours === 0)
    parts.push(`${Math.round(secs)}s`);

  return parts.slice(0, 2).join(' ');
}

/**
 * Format a time ago (e.g., "5m ago", "2h ago", "3d ago")
 */
export function formatTimeAgo(seconds: number): string {
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * Format large numbers with K, M, B suffixes (e.g., "1.3k", "2.5M")
 */
export function formatNumber(num: number, decimals: number = 1): string {
  if (num === 0) return '0';
  return humanFormat(num, {
    maxDecimals: decimals,
    separator: '',
  });
}

/**
 * Format token counts (same as formatNumber but specifically for tokens)
 */
export function formatTokens(tokens: number): string {
  return formatNumber(tokens, 1);
}

/**
 * Format cost in dollars (e.g., "$0.001234", "$1.23")
 */
export function formatCost(cost: number, maxDecimals: number = 6): string {
  if (cost === 0) return '$0';
  if (cost >= 0.01) {
    // For costs >= 1 cent, use 2-4 decimals
    return `$${cost.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    })}`;
  }
  // For small costs, show up to maxDecimals
  return `$${cost.toFixed(maxDecimals)}`;
}

/**
 * Format large point balances with k, M, B suffixes (e.g., 4948499 -> "4.9M", 1500 -> "1k")
 */
export function formatPoints(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  if (n < 1_000_000_000) {
    const val = (n / 1_000_000).toFixed(1).replace(/\.0$/, '');
    return `${val}M`;
  }
  const val = (n / 1_000_000_000).toFixed(1).replace(/\.0$/, '');
  return `${val}B`;
}

/**
 * Format point balances with full precision and comma separators (e.g., 4948499 -> "4,948,499")
 * Use this everywhere except compact sidebar displays.
 */
export function formatPointsFull(n: number): string {
  return Math.round(n).toLocaleString();
}

/**
 * Format milliseconds to seconds with appropriate precision
 */
export function formatMs(ms: number): string {
  if (ms === 0) return '∅';
  if (ms < 10) return `${Math.round(ms)}ms`;
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Format tokens per second
 */
export function formatTPS(tps: number): string {
  if (tps === 0) return '0';
  return tps.toFixed(1);
}

/**
 * Format energy in kWh with human-readable sub-units.
 */
export function formatEnergy(kwh: number): string {
  if (kwh >= 1) return `${kwh.toFixed(3)} kWh`;

  const wh = kwh * 1000;
  if (wh >= 1) return `${wh.toFixed(3)} Wh`;

  const mwh = wh * 1000;
  if (mwh >= 0.01) return `${mwh.toFixed(3)} mWh`;

  return `${(mwh * 1000).toFixed(3)} µWh`;
}

/**
 * Format a number of toast-slices with appropriate precision.
 */
export function formatSlices(slices: number): string {
  if (slices < 1) return slices.toFixed(2);
  if (slices < 10) return slices.toFixed(1);
  return Math.round(slices).toLocaleString();
}

/**
 * Format a percentage value (e.g., 99.5 -> "99.5%", 100 -> "100%")
 */
export function formatPercent(value: number, decimals: number = 1): string {
  if (value === 0) return '0%';
  if (value === 100) return '100%';
  return `${value.toFixed(decimals)}%`;
}

/**
 * Format a timestamp string into a readable time label for chart axes.
 * Handles ISO strings and epoch-millisecond numeric strings.
 */
export function formatTimeLabel(timestamp: string): string {
  const date = new Date(timestamp);
  if (!isNaN(date.getTime())) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  // Try parsing as a numeric string (epoch ms)
  const num = Number(timestamp);
  if (!isNaN(num)) {
    const dateFromNum = new Date(num);
    if (!isNaN(dateFromNum.getTime())) {
      return dateFromNum.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
  }
  return timestamp;
}

/**
 * Convert string to Title Case (e.g., "hello-world" -> "Hello World")
 */
export function toTitleCase(str: string): string {
  return str
    .split(/[-_\s]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}
