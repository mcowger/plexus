/**
 * Caching utilities for metrics module
 */

import { CacheEntry } from './types';

const CACHE_TTL_MS = 30000; // 30 seconds cache TTL

// Simple in-memory cache for aggregated data
const cache = new Map<string, CacheEntry<unknown>>();

export function getCached<T>(key: string): T | null {
    const entry = cache.get(key);
    if (entry && entry.expiresAt > Date.now()) {
        return entry.data as T;
    }
    cache.delete(key);
    return null;
}

export function setCache<T>(key: string, data: T, ttlMs: number = CACHE_TTL_MS): void {
    cache.set(key, {
        data,
        expiresAt: Date.now() + ttlMs
    });
}

export function generateCacheKey(prefix: string, params: Record<string, unknown>): string {
    const sortedParams = Object.entries(params)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}=${v}`)
        .join('&');
    return `${prefix}:${sortedParams}`;
}

export function clearCache(): void {
    cache.clear();
}

export function getCacheSize(): number {
    return cache.size;
}
