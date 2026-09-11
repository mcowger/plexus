import { describe, expect, it } from 'vitest';
import { parseCustomDateRange, parsePresetFromQuery } from '../helpers';

describe('parsePresetFromQuery', () => {
  it('filters unknown metrics while preserving valid live metrics', () => {
    expect(
      parsePresetFromQuery('range=live&metrics=requests,unknown,velocity,errors').selectedMetrics
    ).toEqual(['requests', 'velocity', 'errors']);
  });

  it('falls back to the default metrics when the query has no valid metrics', () => {
    expect(parsePresetFromQuery('metrics=unknown').selectedMetrics).toEqual([
      'requests',
      'tokens',
      'cost',
    ]);
  });
});

describe('parseCustomDateRange', () => {
  it('returns null for incomplete or invalid dates', () => {
    expect(parseCustomDateRange('2026-09-01T00:00:00.000Z')).toBeNull();
    expect(parseCustomDateRange('not-a-date', '2026-09-02T00:00:00.000Z')).toBeNull();
  });
});
