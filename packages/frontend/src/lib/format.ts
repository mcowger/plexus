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
 * Format an ISO resets-at timestamp as a short relative string, e.g.
 * "in 3h 20m". Falls back to an absolute date for far-future resets.
 */
export function formatResetsIn(iso: string | null): string {
  if (!iso) return '—';
  const resetsAt = new Date(iso).getTime();
  const diffMs = resetsAt - Date.now();
  if (diffMs <= 0) return 'resetting now';
  const diffSeconds = Math.floor(diffMs / 1000);
  const days = Math.floor(diffSeconds / 86400);
  const hours = Math.floor((diffSeconds % 86400) / 3600);
  const minutes = Math.floor((diffSeconds % 3600) / 60);
  if (days > 7) return `on ${new Date(iso).toLocaleDateString()}`;
  if (days > 0) return `in ${days}d ${hours}h`;
  if (hours > 0) return `in ${hours}h ${minutes}m`;
  return minutes > 0 ? `in ${minutes}m` : 'in <1m';
}

export interface ResetCountdown {
  /** Compact form for tight layouts: "3h 12m", "45s", "now", "Dec 25" */
  short: string;
  /** Sentence form: "resets in 3h 12m", "resetting now", "resets Dec 25" */
  long: string;
  /** Absolute local timestamp, for tooltips */
  absolute: string;
  /** Milliseconds until the reset; <= 0 once due */
  remainingMs: number;
}

/**
 * Build the display forms of a quota reset countdown. Returns null when the
 * meter reports no reset time (many providers only expose a balance).
 */
export function formatResetCountdown(
  iso: string | null | undefined,
  nowMs: number = Date.now()
): ResetCountdown | null {
  if (!iso) return null;
  const date = new Date(iso);
  const resetsAtMs = date.getTime();
  if (!Number.isFinite(resetsAtMs)) return null;

  const absolute = date.toLocaleString();
  const remainingMs = resetsAtMs - nowMs;
  if (remainingMs <= 0) {
    return { short: 'now', long: 'resetting now', absolute, remainingMs };
  }

  const totalSeconds = Math.floor(remainingMs / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 7) {
    const short = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    return { short, long: `resets ${short}`, absolute, remainingMs };
  }

  const short =
    days > 0
      ? `${days}d ${hours}h`
      : hours > 0
        ? `${hours}h ${minutes}m`
        : minutes > 0
          ? `${minutes}m`
          : `${seconds}s`;

  return { short, long: `resets in ${short}`, absolute, remainingMs };
}

/**
 * How often a countdown for `remainingMs` needs to re-render to stay accurate:
 * every second in the final minute (seconds are shown), otherwise every 30s.
 */
export function countdownTickMs(remainingMs: number): number {
  return remainingMs > 0 && remainingMs < 60_000 ? 1_000 : 30_000;
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
 * Format cost in dollars, always showing 4 decimal places.
 * Costs below $0.0001 are shown as "$<0.0001" to avoid implying zero.
 * Costs of exactly $0 show "$0.0000".
 */
export function formatCost(cost: number, decimals: number = 4): string {
  if (cost === 0) return `$${cost.toFixed(decimals)}`;
  const threshold = Math.pow(10, -decimals);
  if (cost > 0 && cost < threshold) return `$<${threshold.toFixed(decimals)}`;
  if (cost >= 0.01) {
    return `$${cost.toLocaleString(undefined, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })}`;
  }
  return `$${cost.toFixed(decimals)}`;
}

export type FormatCostInOptions = {
  currency: string;
  rate: number;
  symbol?: string;
  decimals?: number;
};

export function formatCostIn(costUsd: number, options: FormatCostInOptions): string {
  const decimals = options.decimals ?? 4;
  const cost = costUsd * options.rate;
  const formatter = new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: options.currency,
    currencyDisplay: 'symbol',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

  const formatValue = (value: number, marker?: string): string => {
    let integerPartSeen = false;
    return formatter
      .formatToParts(value)
      .map((part) => {
        if (part.type === 'currency' && options.symbol) return options.symbol;
        if (marker && !integerPartSeen && part.type === 'integer') {
          integerPartSeen = true;
          return `${marker}${part.value}`;
        }
        return part.value;
      })
      .join('');
  };

  if (cost === 0) return formatValue(cost);
  const threshold = Math.pow(10, -decimals);
  if (cost > 0 && cost < threshold) return formatValue(threshold, '<');
  return formatValue(cost);
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
 * Format byte counts with B/KB/MB suffixes (e.g., 1536 -> "1.5 KB")
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
  const date = parseTimestamp(timestamp);
  if (date) return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return timestamp;
}

/**
 * Format a timestamp string into a detailed date-time label for chart tooltips.
 * Includes date and time (e.g., "2025/05/15 14:00").
 */
export function formatDateTimeLabel(timestamp: string): string {
  const date = parseTimestamp(timestamp);
  if (date) {
    const dateStr = date.toLocaleDateString([], {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return `${dateStr} ${timeStr}`;
  }
  return timestamp;
}

function parseTimestamp(timestamp: string): Date | null {
  const date = new Date(timestamp);
  if (!isNaN(date.getTime())) return date;
  const num = Number(timestamp);
  if (!isNaN(num)) {
    const dateFromNum = new Date(num);
    if (!isNaN(dateFromNum.getTime())) return dateFromNum;
  }
  return null;
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

/**
 * Estimate average wire bytes per token for an API response stream.
 * In live SSE streams, each token chunk is wrapped in SSE event headers and JSON schema
 * structures (`data: {"id":...,"choices":[{"delta":...}]}`). This protocol framing
 * dominates wire payload size compared to plain text (~4 bytes/token).
 */
export function getEstimatedBytesPerToken(options: {
  incomingApiType?: string | null;
  outgoingApiType?: string | null;
  isStreamed?: boolean | null;
}): number {
  if (options.isStreamed === false) {
    // Non-streamed response: single bulk JSON payload (~4.5 bytes per token)
    return 4.5;
  }

  const apiType = (options.incomingApiType || options.outgoingApiType || '').toLowerCase();

  if (apiType.includes('anthropic') || apiType.includes('messages') || apiType === 'oauth') {
    // Anthropic SSE: `event: content_block_delta\ndata: {"type":...}\n\n` (~115 B/token)
    return 115;
  }

  if (
    apiType.includes('openai') ||
    apiType.includes('chat') ||
    apiType.includes('responses') ||
    apiType.includes('antigravity')
  ) {
    // OpenAI SSE: `data: {"id":...,"object":"chat.completion.chunk",...}\n\n` (~160 B/token)
    return 160;
  }

  if (apiType.includes('gemini') || apiType.includes('google')) {
    // Gemini SSE streaming: (~140 B/token)
    return 140;
  }

  // Default SSE stream overhead fallback
  return 140;
}
