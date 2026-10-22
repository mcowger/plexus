import { describe, expect, test } from 'bun:test';

import { calculateCosts } from '../calculate-costs';
import { applyProviderReportedCost, applyUsageCostDetails } from '../provider-cost';

describe('calculateCosts upstream attribution (issue #916)', () => {
  test('configured rewrite uses upstream pricing and records provenance', () => {
    const record: any = {
      tokensInput: 1_000_000,
      tokensOutput: 500_000,
      tokensCached: 0,
      tokensCacheWrite: 0,
    };
    calculateCosts(record, { source: 'simple', input: 10, output: 20 }, undefined, {
      upstreamModel: 'muse-spark-1.3',
      pricingModel: 'muse-spark-1.3',
      pricingFallback: false,
    });
    // 1M * 10 + 0.5M * 20 = 10 + 10 = 20
    expect(record.costTotal).toBe(20);
    const meta = JSON.parse(record.costMetadata);
    expect(meta.upstream_model).toBe('muse-spark-1.3');
    expect(meta.pricing_model).toBe('muse-spark-1.3');
    expect(meta.pricing_fallback).toBe(false);
  });

  test('fallback retains route pricing and marks pricing_fallback', () => {
    const record: any = {
      tokensInput: 1_000_000,
      tokensOutput: 0,
      tokensCached: 0,
      tokensCacheWrite: 0,
    };
    calculateCosts(record, { source: 'simple', input: 1, output: 2 }, undefined, {
      upstreamModel: 'unconfigured-model',
      pricingModel: 'route-model',
      pricingFallback: true,
    });
    expect(record.costTotal).toBe(1);
    const meta = JSON.parse(record.costMetadata);
    expect(meta.pricing_fallback).toBe(true);
    expect(meta.upstream_model).toBe('unconfigured-model');
  });

  test('provider-reported cost remains authoritative and is not labelled fallback', () => {
    const record: any = {
      tokensInput: 1000,
      tokensOutput: 500,
      tokensCached: 0,
      tokensCacheWrite: 0,
      requestId: 'r1',
    };
    calculateCosts(record, { source: 'simple', input: 10, output: 20 }, undefined, {
      upstreamModel: 'muse-spark-1.3',
      pricingModel: 'muse-spark-1.3',
      pricingFallback: false,
    });
    const calculatedTotal = record.costTotal;
    expect(calculatedTotal).toBeGreaterThan(0);
    applyProviderReportedCost(record, { request_cost_usd: 0.000721 });
    expect(record.costTotal).toBeCloseTo(0.000721, 8);
    expect(record.costSource).toBe('provider_reported');
    const meta = JSON.parse(record.costMetadata);
    expect(meta.source).toBe('provider_reported');
    expect(meta.pricing_fallback).toBeUndefined();
  });

  test('usage.cost_details override also stays authoritative without fallback label', () => {
    const record: any = { tokensInput: 1000, tokensOutput: 500, requestId: 'r2' };
    calculateCosts(record, { source: 'simple', input: 10, output: 20 }, undefined, {
      upstreamModel: 'muse-spark-1.3',
      pricingModel: 'route-model',
      pricingFallback: true,
    });
    applyUsageCostDetails(record, {
      total_cost: 0.005,
      input_cost: 0.003,
      output_cost: 0.002,
      cached_input_cost: null,
      cache_write_input_cost: null,
      upstream_inference_prompt_cost: null,
      upstream_inference_completions_cost: null,
    } as any);
    expect(record.costSource).toBe('provider_reported');
    const meta = JSON.parse(record.costMetadata);
    expect(meta.source).toBe('provider_reported');
    expect(meta.pricing_fallback).toBeUndefined();
  });
});
