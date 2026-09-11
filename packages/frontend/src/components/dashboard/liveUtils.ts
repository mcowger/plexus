/**
 * @file liveUtils.ts
 *
 * Label normalisation, provider/model derivation, and aggregation helpers
 * for the Live Metrics dashboard.
 */

import type { UsageRecord } from '../../lib/api';
import { EXCLUDED_PROVIDER_LABELS, PLACEHOLDER_LABELS, type EntityStats } from './liveTypes';

/**
 * Strips whitespace and filters out placeholder telemetry labels.
 * Returns an empty string for any value that is null, undefined, blank,
 * or matches a known placeholder (e.g. "unknown", "n/a", "null").
 */
export const normalizeTelemetryLabel = (value: string | null | undefined): string => {
  const normalized = value?.trim();
  if (!normalized) {
    return '';
  }

  if (PLACEHOLDER_LABELS[normalized.toLowerCase()]) {
    return '';
  }

  return normalized;
};

/**
 * Derives a display label for the provider of a request.
 * Falls back to "Failed Request" if the request errored before a provider was
 * resolved, or "Unresolved Provider" if the provider field is simply absent.
 */
export const getProviderLabel = (request: UsageRecord): string => {
  const provider = normalizeTelemetryLabel(request.provider);
  if (provider) {
    return provider;
  }

  const status = (request.responseStatus || '').toLowerCase();
  if (status && status !== 'success') {
    return 'Failed Request';
  }

  return 'Unresolved Provider';
};

/**
 * Derives a display label for the model used in a request.
 * Prefers `selectedModelName` (the actual model dispatched to) over
 * `incomingModelAlias` (the alias the client requested). Falls back to
 * "Failed Before Model Selection" for errors, or "Unresolved Model" otherwise.
 */
export const getModelLabel = (request: UsageRecord): string => {
  const model =
    normalizeTelemetryLabel(request.selectedModelName) ||
    normalizeTelemetryLabel(request.incomingModelAlias);
  if (model) {
    return model;
  }

  const status = (request.responseStatus || '').toLowerCase();
  if (status && status !== 'success') {
    return 'Failed Before Model Selection';
  }

  return 'Unresolved Model';
};

/**
 * Groups an array of usage records by a specified entity dimension (provider
 * or model), then computes aggregate statistics for each group.
 *
 * @param requests - The filtered array of live UsageRecords
 * @param entityType - Whether to group by 'provider' or 'model'
 * @returns Top 5 entities sorted by descending request count
 */
export const aggregateByEntity = (
  requests: UsageRecord[],
  entityType: 'provider' | 'model'
): EntityStats[] => {
  const grouped = new Map<
    string,
    {
      requests: number;
      errors: number;
      tokens: number;
      cost: number;
      latency: number;
      ttft: number;
      tps: number;
    }
  >();

  requests.forEach((request) => {
    const key = entityType === 'provider' ? getProviderLabel(request) : getModelLabel(request);

    const existing = grouped.get(key) || {
      requests: 0,
      errors: 0,
      tokens: 0,
      cost: 0,
      latency: 0,
      ttft: 0,
      tps: 0,
    };

    existing.requests++;
    if (request.responseStatus !== 'success') existing.errors++;
    existing.tokens +=
      (request.tokensInput || 0) +
      (request.tokensOutput || 0) +
      (request.tokensCached || 0) +
      (request.tokensCacheWrite || 0);
    existing.cost += request.costTotal || 0;
    existing.latency += request.durationMs || 0;
    existing.ttft += request.ttftMs || 0;
    existing.tps += request.tokensPerSec || 0;
    grouped.set(key, existing);
  });

  return Array.from(grouped.entries())
    .map(([name, data]) => ({
      name,
      requests: data.requests,
      errors: data.errors,
      successRate: data.requests > 0 ? ((data.requests - data.errors) / data.requests) * 100 : 0,
      tokens: data.tokens,
      cost: data.cost,
      avgLatency: data.requests > 0 ? data.latency / data.requests : 0,
      avgTtft: data.requests > 0 ? data.ttft / data.requests : 0,
      avgTps: data.requests > 0 ? data.tps / data.requests : 0,
    }))
    .sort((a, b) => b.requests - a.requests)
    .slice(0, 5);
};

export { EXCLUDED_PROVIDER_LABELS };
