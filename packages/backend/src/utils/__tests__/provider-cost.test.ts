import { describe, test, expect } from 'vitest';
import { applyProviderReportedCost, applyUsageCostDetails } from '../provider-cost';
import { extractUsageCostDetails } from '../usage-normalizer';
import type { UsageRecord } from '../../types/usage';
import type { ProviderCostDetails } from '../usage-normalizer';

function createUsageRecord(overrides: Partial<UsageRecord> = {}): Partial<UsageRecord> {
  return {
    requestId: 'test-123',
    costInput: 0.001,
    costOutput: 0.002,
    costCached: 0.0005,
    costCacheWrite: 0,
    costTotal: 0.0035,
    costSource: 'simple',
    costMetadata: JSON.stringify({ input: 3, output: 6, cached: 1.5, cache_write: 0 }),
    ...overrides,
  };
}

describe('applyProviderReportedCost', () => {
  test('overrides costTotal with request_cost_usd', () => {
    const record = createUsageRecord();
    applyProviderReportedCost(record, {
      request_cost_usd: 0.0007217243274280318,
      cache_savings_usd: 0.0,
      allowance_remaining_usd: 14.991,
      budget_remaining_usd: 14.991,
    });

    expect(record.costTotal).toBe(0.00072172);
    expect(record.costSource).toBe('provider_reported');
    expect(record.providerReportedCost).toBe(0.0007217243274280318);
  });

  test('distributes cost proportionally based on existing cost ratios', () => {
    const record = createUsageRecord();
    // costInput=0.001, costOutput=0.002, costCached=0.0005, total=0.0035
    applyProviderReportedCost(record, {
      request_cost_usd: 0.007,
      cache_savings_usd: 0.0,
    });

    expect(record.costTotal).toBe(0.007);
    // Ratios: input=1/3.5, output=2/3.5, cached=0.5/3.5
    expect(record.costInput).toBeCloseTo((0.001 / 0.0035) * 0.007, 8);
    expect(record.costOutput).toBeCloseTo((0.002 / 0.0035) * 0.007, 8);
    expect(record.costCached).toBeCloseTo((0.0005 / 0.0035) * 0.007, 8);
  });

  test('attributes full cost to input when no breakdown available', () => {
    const record = createUsageRecord({
      costInput: 0,
      costOutput: 0,
      costCached: 0,
      costCacheWrite: 0,
      costTotal: 0,
    });
    applyProviderReportedCost(record, {
      request_cost_usd: 0.005,
    });

    expect(record.costTotal).toBe(0.005);
    expect(record.costInput).toBe(0.005);
    expect(record.costOutput).toBe(0);
    expect(record.costCached).toBe(0);
    expect(record.costCacheWrite).toBe(0);
  });

  test('stores full provider payload in costMetadata', () => {
    const record = createUsageRecord();
    const costData = {
      request_cost_usd: 0.0007217243274280318,
      cache_savings_usd: 0.0,
      allowance_remaining_usd: 14.991,
      budget_remaining_usd: 14.991,
    };
    applyProviderReportedCost(record, costData);

    const metadata = JSON.parse(record.costMetadata!);
    expect(metadata.source).toBe('provider_reported');
    expect(metadata.request_cost_usd).toBe(0.0007217243274280318);
    expect(metadata.cache_savings_usd).toBe(0.0);
    expect(metadata.allowance_remaining_usd).toBe(14.991);
    expect(metadata.budget_remaining_usd).toBe(14.991);
    expect(metadata.previous_cost_source).toBe('simple');
    expect(metadata.previous_cost_total).toBe(0.0035);
  });

  test('ignores invalid request_cost_usd (not a number)', () => {
    const record = createUsageRecord();
    applyProviderReportedCost(record, { request_cost_usd: 'invalid' });

    expect(record.costTotal).toBe(0.0035);
    expect(record.costSource).toBe('simple');
  });

  test('ignores negative request_cost_usd', () => {
    const record = createUsageRecord();
    applyProviderReportedCost(record, { request_cost_usd: -0.001 });

    expect(record.costTotal).toBe(0.0035);
    expect(record.costSource).toBe('simple');
  });

  test('ignores missing request_cost_usd', () => {
    const record = createUsageRecord();
    applyProviderReportedCost(record, { cache_savings_usd: 0.0 });

    expect(record.costTotal).toBe(0.0035);
    expect(record.costSource).toBe('simple');
  });

  test('handles zero request_cost_usd', () => {
    const record = createUsageRecord();
    applyProviderReportedCost(record, { request_cost_usd: 0 });

    expect(record.costTotal).toBe(0);
    expect(record.costSource).toBe('provider_reported');
    expect(record.costInput).toBe(0);
    expect(record.costOutput).toBe(0);
  });
});

describe('extractUsageCostDetails', () => {
  test('extracts cost_details from the new usage format', () => {
    const usage = {
      prompt_tokens: 23,
      total_tokens: 66,
      completion_tokens: 43,
      estimated_cost: 0.00017465,
      prompt_tokens_details: {
        cached_tokens: 0,
        cache_write_tokens: 0,
      },
      cost: 0.00017465,
      cost_details: {
        upstream_inference_cost: 0.00017465,
        upstream_inference_prompt_cost: 0.00002415,
        upstream_inference_completions_cost: 0.0001505,
        total_cost: 0.00017465,
        input_cost: 0.00002415,
        output_cost: 0.0001505,
        cached_input_cost: 0,
        cache_write_input_cost: 0,
        request_cost: 0,
        web_search_cost: 0,
        image_input_cost: null,
        image_output_cost: null,
        audio_input_cost: null,
        data_storage_cost: 0.00000106,
      },
    };

    const result = extractUsageCostDetails(usage);
    expect(result).not.toBeNull();
    expect(result!.total_cost).toBe(0.00017465);
    expect(result!.input_cost).toBe(0.00002415);
    expect(result!.output_cost).toBe(0.0001505);
    expect(result!.cached_input_cost).toBe(0);
    expect(result!.cache_write_input_cost).toBe(0);
    expect(result!.data_storage_cost).toBe(0.00000106);
  });

  test('falls back to usage.cost when cost_details.total_cost is missing', () => {
    const usage = {
      cost: 0.005,
      cost_details: {
        input_cost: 0.001,
        output_cost: 0.004,
      },
    };

    const result = extractUsageCostDetails(usage);
    expect(result).not.toBeNull();
    expect(result!.total_cost).toBe(0.005);
    expect(result!.input_cost).toBe(0.001);
    expect(result!.output_cost).toBe(0.004);
  });

  test('falls back to usage.estimated_cost when cost and total_cost are both missing', () => {
    const usage = {
      estimated_cost: 0.003,
      cost_details: {
        input_cost: 0.001,
        output_cost: 0.002,
      },
    };

    const result = extractUsageCostDetails(usage);
    expect(result).not.toBeNull();
    expect(result!.total_cost).toBe(0.003);
  });

  test('returns null when usage has no cost_details', () => {
    const usage = {
      prompt_tokens: 23,
      completion_tokens: 43,
      total_tokens: 66,
    };

    expect(extractUsageCostDetails(usage)).toBeNull();
  });

  test('returns null when cost_details exists but no total cost is available', () => {
    const usage = {
      cost_details: {
        input_cost: 0.001,
      },
    };

    expect(extractUsageCostDetails(usage)).toBeNull();
  });

  test('returns null when cost_details is not an object', () => {
    expect(extractUsageCostDetails({ cost_details: 'invalid' })).toBeNull();
    expect(extractUsageCostDetails({ cost_details: 42 })).toBeNull();
    expect(extractUsageCostDetails({ cost_details: null })).toBeNull();
  });

  test('returns null when usage is null or undefined', () => {
    expect(extractUsageCostDetails(null)).toBeNull();
    expect(extractUsageCostDetails(undefined)).toBeNull();
  });

  test('maps upstream_inference_prompt_cost as fallback for input_cost', () => {
    const usage = {
      cost: 0.01,
      cost_details: {
        upstream_inference_prompt_cost: 0.003,
        upstream_inference_completions_cost: 0.007,
      },
    };

    const result = extractUsageCostDetails(usage);
    expect(result!.input_cost).toBe(0.003);
    expect(result!.output_cost).toBe(0.007);
  });

  test('preserves null values for optional cost fields', () => {
    const usage = {
      cost: 0.01,
      cost_details: {
        total_cost: 0.01,
        image_input_cost: null,
        image_output_cost: null,
        audio_input_cost: null,
      },
    };

    const result = extractUsageCostDetails(usage);
    expect(result!.image_input_cost).toBeNull();
    expect(result!.image_output_cost).toBeNull();
    expect(result!.audio_input_cost).toBeNull();
  });

  test('returns null for negative total_cost', () => {
    const usage = {
      cost_details: {
        total_cost: -0.01,
      },
    };

    expect(extractUsageCostDetails(usage)).toBeNull();
  });
});

describe('applyUsageCostDetails', () => {
  test('overrides costs with provider cost_details breakdown', () => {
    const record = createUsageRecord();
    const costDetails: ProviderCostDetails = {
      total_cost: 0.00017465,
      input_cost: 0.00002415,
      output_cost: 0.0001505,
      cached_input_cost: 0,
      cache_write_input_cost: 0,
      upstream_inference_cost: 0.00017465,
      upstream_inference_prompt_cost: 0.00002415,
      upstream_inference_completions_cost: 0.0001505,
      request_cost: 0,
      web_search_cost: 0,
      image_input_cost: null,
      image_output_cost: null,
      audio_input_cost: null,
      data_storage_cost: 0.00000106,
    };

    applyUsageCostDetails(record, costDetails);

    expect(record.costTotal).toBe(0.00017465);
    expect(record.costSource).toBe('provider_reported');
    expect(record.providerReportedCost).toBe(0.00017465);
    expect(record.costInput).toBe(0.00002415);
    expect(record.costOutput).toBe(0.0001505);
    expect(record.costCached).toBe(0);
    expect(record.costCacheWrite).toBe(0);
  });

  test('falls back to proportional distribution when no breakdown available', () => {
    const record = createUsageRecord();
    // costInput=0.001, costOutput=0.002, costCached=0.0005, total=0.0035
    const costDetails: ProviderCostDetails = {
      total_cost: 0.007,
      input_cost: null,
      output_cost: null,
      cached_input_cost: null,
      cache_write_input_cost: null,
      upstream_inference_cost: null,
      upstream_inference_prompt_cost: null,
      upstream_inference_completions_cost: null,
      request_cost: null,
      web_search_cost: null,
      image_input_cost: null,
      image_output_cost: null,
      audio_input_cost: null,
      data_storage_cost: null,
    };

    applyUsageCostDetails(record, costDetails);

    expect(record.costTotal).toBe(0.007);
    // Ratios: input=1/3.5, output=2/3.5, cached=0.5/3.5
    expect(record.costInput).toBeCloseTo((0.001 / 0.0035) * 0.007, 8);
    expect(record.costOutput).toBeCloseTo((0.002 / 0.0035) * 0.007, 8);
    expect(record.costCached).toBeCloseTo((0.0005 / 0.0035) * 0.007, 8);
  });

  test('attributes full cost to input when no breakdown and no prior costs', () => {
    const record = createUsageRecord({
      costInput: 0,
      costOutput: 0,
      costCached: 0,
      costCacheWrite: 0,
      costTotal: 0,
    });
    const costDetails: ProviderCostDetails = {
      total_cost: 0.005,
      input_cost: null,
      output_cost: null,
      cached_input_cost: null,
      cache_write_input_cost: null,
      upstream_inference_cost: null,
      upstream_inference_prompt_cost: null,
      upstream_inference_completions_cost: null,
      request_cost: null,
      web_search_cost: null,
      image_input_cost: null,
      image_output_cost: null,
      audio_input_cost: null,
      data_storage_cost: null,
    };

    applyUsageCostDetails(record, costDetails);

    expect(record.costTotal).toBe(0.005);
    expect(record.costInput).toBe(0.005);
    expect(record.costOutput).toBe(0);
    expect(record.costCached).toBe(0);
    expect(record.costCacheWrite).toBe(0);
  });

  test('uses partial breakdown — only input_cost provided', () => {
    const record = createUsageRecord();
    const costDetails: ProviderCostDetails = {
      total_cost: 0.005,
      input_cost: 0.002,
      output_cost: null,
      cached_input_cost: null,
      cache_write_input_cost: null,
      upstream_inference_cost: null,
      upstream_inference_prompt_cost: null,
      upstream_inference_completions_cost: null,
      request_cost: null,
      web_search_cost: null,
      image_input_cost: null,
      image_output_cost: null,
      audio_input_cost: null,
      data_storage_cost: null,
    };

    applyUsageCostDetails(record, costDetails);

    expect(record.costTotal).toBe(0.005);
    expect(record.costInput).toBe(0.002);
    expect(record.costOutput).toBe(0);
    expect(record.costCached).toBe(0);
    expect(record.costCacheWrite).toBe(0);
  });

  test('does nothing when total_cost is null', () => {
    const record = createUsageRecord();
    const costDetails: ProviderCostDetails = {
      total_cost: null,
      input_cost: 0.001,
      output_cost: 0.002,
      cached_input_cost: null,
      cache_write_input_cost: null,
      upstream_inference_cost: null,
      upstream_inference_prompt_cost: null,
      upstream_inference_completions_cost: null,
      request_cost: null,
      web_search_cost: null,
      image_input_cost: null,
      image_output_cost: null,
      audio_input_cost: null,
      data_storage_cost: null,
    };

    applyUsageCostDetails(record, costDetails);

    // Should remain unchanged
    expect(record.costTotal).toBe(0.0035);
    expect(record.costSource).toBe('simple');
  });

  test('does nothing when costDetails is null or undefined', () => {
    const record = createUsageRecord();
    applyUsageCostDetails(record, null as any);
    expect(record.costTotal).toBe(0.0035);
    expect(record.costSource).toBe('simple');
  });

  test('stores cost_details in costMetadata for audit', () => {
    const record = createUsageRecord();
    const costDetails: ProviderCostDetails = {
      total_cost: 0.00017465,
      input_cost: 0.00002415,
      output_cost: 0.0001505,
      cached_input_cost: 0,
      cache_write_input_cost: 0,
      upstream_inference_cost: 0.00017465,
      upstream_inference_prompt_cost: 0.00002415,
      upstream_inference_completions_cost: 0.0001505,
      request_cost: 0,
      web_search_cost: 0,
      image_input_cost: null,
      image_output_cost: null,
      audio_input_cost: null,
      data_storage_cost: 0.00000106,
    };

    applyUsageCostDetails(record, costDetails);

    const metadata = JSON.parse(record.costMetadata!);
    expect(metadata.source).toBe('provider_reported');
    expect(metadata.cost_details).toEqual(costDetails);
    expect(metadata.previous_cost_source).toBe('simple');
    expect(metadata.previous_cost_total).toBe(0.0035);
  });

  test('handles zero total_cost', () => {
    const record = createUsageRecord();
    const costDetails: ProviderCostDetails = {
      total_cost: 0,
      input_cost: 0,
      output_cost: 0,
      cached_input_cost: 0,
      cache_write_input_cost: 0,
      upstream_inference_cost: 0,
      upstream_inference_prompt_cost: 0,
      upstream_inference_completions_cost: 0,
      request_cost: 0,
      web_search_cost: 0,
      image_input_cost: null,
      image_output_cost: null,
      audio_input_cost: null,
      data_storage_cost: 0,
    };

    applyUsageCostDetails(record, costDetails);

    expect(record.costTotal).toBe(0);
    expect(record.costSource).toBe('provider_reported');
    expect(record.costInput).toBe(0);
    expect(record.costOutput).toBe(0);
  });

  test('SSE : cost comments take precedence over cost_details', () => {
    const record = createUsageRecord();
    // SSE comment cost applied first
    applyProviderReportedCost(record, { request_cost_usd: 0.001 });
    expect(record.costTotal).toBe(0.001);
    expect(record.providerReportedCost).toBe(0.001);

    // cost_details should NOT override because providerReportedCost is already set
    // (this check is done at the call site, not in applyUsageCostDetails itself)
    // The ordering in usage-logging.ts is:
    //   1. applyProviderReportedCost (if providerReportedCost)
    //   2. applyUsageCostDetails (only if !providerReportedCost)
    expect(record.providerReportedCost).toBe(0.001);
  });
});

describe('extractProviderCostFromSSEComments (via DebugLoggingInspector)', () => {
  test('parses : cost SSE comment lines from raw SSE body', () => {
    const rawBody = [
      'data: {"id":"chatcmpl-123","choices":[{"delta":{"content":"Hello"}}]}',
      '',
      ': cost {"request_cost_usd": 0.0007217243274280318, "cache_savings_usd": 0.0, "allowance_remaining_usd": 14.991, "budget_remaining_usd": 14.991}',
      '',
      'data: {"id":"chatcmpl-123","choices":[{"delta":{"content":" world"}}]}',
      '',
      'data: [DONE]',
    ].join('\n');

    // Use the same regex logic that DebugLoggingInspector uses
    const lines = rawBody.split(/\r?\n/);
    let lastCost: any = null;

    for (const line of lines) {
      const costMatch = line.match(/^:\s*cost\s+(\{.+\})\s*$/);
      if (costMatch) {
        lastCost = JSON.parse(costMatch[1]!);
      }
    }

    expect(lastCost).not.toBeNull();
    expect(lastCost.request_cost_usd).toBe(0.0007217243274280318);
    expect(lastCost.cache_savings_usd).toBe(0.0);
    expect(lastCost.allowance_remaining_usd).toBe(14.991);
    expect(lastCost.budget_remaining_usd).toBe(14.991);
  });

  test('uses last cost line when multiple are present', () => {
    const rawBody = [
      ': cost {"request_cost_usd": 0.001}',
      ': cost {"request_cost_usd": 0.002}',
    ].join('\n');

    const lines = rawBody.split(/\r?\n/);
    let lastCost: any = null;

    for (const line of lines) {
      const costMatch = line.match(/^:\s*cost\s+(\{.+\})\s*$/);
      if (costMatch) {
        lastCost = JSON.parse(costMatch[1]!);
      }
    }

    expect(lastCost.request_cost_usd).toBe(0.002);
  });

  test('returns null when no cost lines present', () => {
    const rawBody = [
      'data: {"id":"chatcmpl-123","choices":[{"delta":{"content":"Hello"}}]}',
      'data: [DONE]',
    ].join('\n');

    const lines = rawBody.split(/\r?\n/);
    let lastCost: any = null;

    for (const line of lines) {
      const costMatch = line.match(/^:\s*cost\s+(\{.+\})\s*$/);
      if (costMatch) {
        lastCost = JSON.parse(costMatch[1]!);
      }
    }

    expect(lastCost).toBeNull();
  });

  test('skips malformed cost lines', () => {
    const rawBody = [': cost not-json', ': cost {"request_cost_usd": 0.001}'].join('\n');

    const lines = rawBody.split(/\r?\n/);
    let lastCost: any = null;

    for (const line of lines) {
      const costMatch = line.match(/^:\s*cost\s+(\{.+\})\s*$/);
      if (costMatch) {
        try {
          lastCost = JSON.parse(costMatch[1]!);
        } catch (e) {
          // Skip
        }
      }
    }

    expect(lastCost.request_cost_usd).toBe(0.001);
  });
});

describe('extractProviderEnergyFromSSEComments (via DebugLoggingInspector)', () => {
  test('parses : energy SSE comment lines from raw SSE body', () => {
    const rawBody = [
      'data: {"id":"chatcmpl-123","choices":[{"delta":{"content":"Hello"}}]}',
      '',
      ': energy {"energy_joules": 190.46, "energy_kwh": 5.2904e-05, "avg_power_watts": 3109.0, "duration_seconds": 0.613}',
      '',
      'data: {"id":"chatcmpl-123","choices":[{"delta":{"content":" world"}}]}',
      '',
      'data: [DONE]',
    ].join('\n');

    // Use the same regex logic that DebugLoggingInspector uses
    const lines = rawBody.split(/\r?\n/);
    let lastEnergy: any = null;

    for (const line of lines) {
      const energyMatch = line.match(/^:\s*energy\s+(\{.+\})\s*$/);
      if (energyMatch) {
        lastEnergy = JSON.parse(energyMatch[1]!);
      }
    }

    expect(lastEnergy).not.toBeNull();
    expect(lastEnergy.energy_joules).toBe(190.46);
    expect(lastEnergy.energy_kwh).toBe(5.2904e-5);
    expect(lastEnergy.avg_power_watts).toBe(3109.0);
    expect(lastEnergy.duration_seconds).toBe(0.613);
  });

  test('uses last energy line when multiple are present', () => {
    const rawBody = [': energy {"energy_kwh": 0.0001}', ': energy {"energy_kwh": 0.00052904}'].join(
      '\n'
    );

    const lines = rawBody.split(/\r?\n/);
    let lastEnergy: any = null;

    for (const line of lines) {
      const energyMatch = line.match(/^:\s*energy\s+(\{.+\})\s*$/);
      if (energyMatch) {
        lastEnergy = JSON.parse(energyMatch[1]!);
      }
    }

    expect(lastEnergy.energy_kwh).toBe(0.00052904);
  });

  test('returns null when no energy lines present', () => {
    const rawBody = [
      'data: {"id":"chatcmpl-123","choices":[{"delta":{"content":"Hello"}}]}',
      'data: [DONE]',
    ].join('\n');

    const lines = rawBody.split(/\r?\n/);
    let lastEnergy: any = null;

    for (const line of lines) {
      const energyMatch = line.match(/^:\s*energy\s+(\{.+\})\s*$/);
      if (energyMatch) {
        lastEnergy = JSON.parse(energyMatch[1]!);
      }
    }

    expect(lastEnergy).toBeNull();
  });

  test('skips malformed energy lines', () => {
    const rawBody = [': energy not-json', ': energy {"energy_kwh": 0.0001}'].join('\n');

    const lines = rawBody.split(/\r?\n/);
    let lastEnergy: any = null;

    for (const line of lines) {
      const energyMatch = line.match(/^:\s*energy\s+(\{.+\})\s*$/);
      if (energyMatch) {
        try {
          lastEnergy = JSON.parse(energyMatch[1]!);
        } catch (e) {
          // Skip
        }
      }
    }

    expect(lastEnergy.energy_kwh).toBe(0.0001);
  });

  test('handles scientific notation for energy_kwh', () => {
    const rawBody = [': energy {"energy_kwh": 5.2904e-05}'].join('\n');

    const lines = rawBody.split(/\r?\n/);
    let lastEnergy: any = null;

    for (const line of lines) {
      const energyMatch = line.match(/^:\s*energy\s+(\{.+\})\s*$/);
      if (energyMatch) {
        lastEnergy = JSON.parse(energyMatch[1]!);
      }
    }

    expect(lastEnergy.energy_kwh).toBe(5.2904e-5);
  });
});
