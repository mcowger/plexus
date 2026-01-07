import humanFormat from 'human-format';

// Time scale for human-readable time formatting
const timeScale = new humanFormat.Scale({
    s: 1,
    m: 60,
    h: 3600,
    d: 86400,
    w: 604800,
    mo: 2592000,
    y: 31536000
});

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
    if (secs > 0 && years === 0 && months === 0 && weeks === 0 && days === 0 && hours === 0) parts.push(`${secs}s`);

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
        separator: ''
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
            maximumFractionDigits: 4
        })}`;
    }
    // For small costs, show up to maxDecimals
    return `$${cost.toFixed(maxDecimals)}`;
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
