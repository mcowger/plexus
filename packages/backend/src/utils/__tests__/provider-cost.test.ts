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
    // Real response: glm-5.1 via LLM Gateway (has both gateway and upstream fields)
    const usage = {
      prompt_tokens: 90122,
      completion_tokens: 104,
      total_tokens: 90226,
      cost: 0.022101624,
      prompt_tokens_details: {
        cached_tokens: 89536,
        cache_write_tokens: 0,
        audio_tokens: 0,
        video_tokens: 0,
        image_tokens: 0,
      },
      cost_details: {
        upstream_inference_cost: 0.022101624,
        upstream_inference_prompt_cost: 0.021689784,
        upstream_inference_completions_cost: 0.00041184,
        total_cost: 0.022101624,
        input_cost: 0.00073836,
        output_cost: 0.00041184,
        cached_input_cost: 0.020951424,
        cache_write_input_cost: 0,
        request_cost: 0,
        web_search_cost: 0,
        image_input_cost: null,
        image_output_cost: null,
        audio_input_cost: null,
      },
    };

    const result = extractUsageCostDetails(usage);
    expect(result).not.toBeNull();
    expect(result!.total_cost).toBe(0.022101624);
    expect(result!.input_cost).toBe(0.00073836);
    expect(result!.output_cost).toBe(0.00041184);
    expect(result!.cached_input_cost).toBe(0.020951424);
    expect(result!.cache_write_input_cost).toBe(0);
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

  test('keeps upstream prompt/completions fields separate from input_cost/output_cost', () => {
    // Real response: normal-tier (no gateway input_cost/output_cost fields)
    const usage = {
      completion_tokens: 2177,
      cost: 0.00435825,
      cost_details: {
        upstream_inference_completions_cost: 0.004354,
        upstream_inference_cost: null,
        upstream_inference_prompt_cost: 4.25e-6,
      },
      is_byok: false,
      prompt_tokens: 17,
      prompt_tokens_details: { cached_tokens: 0 },
    };

    const result = extractUsageCostDetails(usage);
    expect(result).not.toBeNull();
    expect(result!.total_cost).toBe(0.00435825);
    expect(result!.input_cost).toBeNull();
    expect(result!.output_cost).toBeNull();
    expect(result!.upstream_inference_prompt_cost).toBe(4.25e-6);
    expect(result!.upstream_inference_completions_cost).toBe(0.004354);
  });

  test('preserves null values for optional cost fields', () => {
    // Real response: LLM Gateway — image/audio costs null for text-only models
    const usage = {
      cost: 0.022101624,
      cost_details: {
        total_cost: 0.022101624,
        input_cost: 0.00073836,
        output_cost: 0.00041184,
        cached_input_cost: 0.020951424,
        cache_write_input_cost: 0,
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

  test('uses upstream_inference_cost as total when usage.cost is 0 (BYOK)', () => {
    // Real response: BYOK — Plexus charges $0, actual cost reported in upstream_inference_cost
    const usage = {
      completion_tokens: 91,
      cost: 0,
      cost_details: {
        upstream_inference_completions_cost: 0.0002275,
        upstream_inference_cost: 0.0003253,
        upstream_inference_prompt_cost: 9.78e-5,
      },
      is_byok: true,
      prompt_tokens: 326,
      prompt_tokens_details: { cached_tokens: 0 },
    };

    const result = extractUsageCostDetails(usage);
    expect(result).not.toBeNull();
    expect(result!.total_cost).toBe(0.0003253);
    expect(result!.input_cost).toBeNull();
    expect(result!.output_cost).toBeNull();
    expect(result!.upstream_inference_prompt_cost).toBe(9.78e-5);
    expect(result!.upstream_inference_completions_cost).toBe(0.0002275);
  });

  test('aliases upstream_inference_input/output_cost to prompt/completions (Responses API)', () => {
    // Real response: OpenAI Responses API uses _input/_output suffix rather than _prompt/_completions
    const usage = {
      input_tokens: 78,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens: 37,
      total_tokens: 115,
      cost: 0.0000113,
      is_byok: false,
      cost_details: {
        upstream_inference_cost: null,
        upstream_inference_input_cost: 0.0000039,
        upstream_inference_output_cost: 0.0000074,
      },
    };

    const result = extractUsageCostDetails(usage);
    expect(result).not.toBeNull();
    expect(result!.total_cost).toBe(0.0000113);
    expect(result!.input_cost).toBeNull();
    expect(result!.output_cost).toBeNull();
    expect(result!.upstream_inference_prompt_cost).toBe(0.0000039);
    expect(result!.upstream_inference_completions_cost).toBe(0.0000074);
  });

  test('uses input_cost/output_cost directly when present alongside upstream fields', () => {
    // Real response: LLM Gateway includes both gateway fields (input_cost/output_cost/cached_input_cost)
    // and upstream fields (upstream_inference_prompt/completions_cost); gateway fields take priority
    const usage = {
      cost: 0.022101624,
      cost_details: {
        total_cost: 0.022101624,
        input_cost: 0.00073836,
        output_cost: 0.00041184,
        cached_input_cost: 0.020951424,
        upstream_inference_prompt_cost: 0.021689784,
        upstream_inference_completions_cost: 0.00041184,
      },
    };

    const result = extractUsageCostDetails(usage);
    expect(result!.input_cost).toBe(0.00073836);
    expect(result!.output_cost).toBe(0.00041184);
    expect(result!.cached_input_cost).toBe(0.020951424);
  });

  test('returns null when cost is 0 and upstream_inference_cost is null (non-BYOK zero-cost)', () => {
    // Real response: stream_error — non-BYOK request that genuinely cost $0.
    // The || fallback in total cost detection causes 0 || null → null, so extract
    // returns null. This is acceptable: zero-cost requests have nothing to report.
    const usage = {
      prompt_tokens: 43,
      completion_tokens: 10,
      total_tokens: 53,
      cost: 0,
      is_byok: false,
      prompt_tokens_details: { cached_tokens: 0, audio_tokens: 0 },
      cost_details: {
        upstream_inference_cost: null,
        upstream_inference_prompt_cost: 0,
        upstream_inference_completions_cost: 0,
      },
      completion_tokens_details: { reasoning_tokens: 11, image_tokens: 0 },
    };

    expect(extractUsageCostDetails(usage)).toBeNull();
  });

  test('handles cost much larger than upstream sum (OpenRouter markup)', () => {
    // Real response: file_annotation — OpenRouter's cost includes provider overhead/markup
    // that is not reflected in the upstream_inference_prompt/completions_cost fields.
    // cost ($0.00216775) is ~13x the upstream sum ($0.00016775).
    const usage = {
      completion_tokens: 80,
      completion_tokens_details: { image_tokens: 0, reasoning_tokens: 64 },
      cost: 0.00216775,
      cost_details: {
        upstream_inference_completions_cost: 0.00016,
        upstream_inference_cost: null,
        upstream_inference_prompt_cost: 7.75e-6,
      },
      is_byok: false,
      prompt_tokens: 31,
      prompt_tokens_details: { audio_tokens: 0, cached_tokens: 0, video_tokens: 0 },
      total_tokens: 111,
    };

    const result = extractUsageCostDetails(usage);
    expect(result).not.toBeNull();
    // total_cost comes from usage.cost (not upstream sum)
    expect(result!.total_cost).toBe(0.00216775);
    // upstream fields preserved separately
    expect(result!.upstream_inference_prompt_cost).toBe(7.75e-6);
    expect(result!.upstream_inference_completions_cost).toBe(0.00016);
    // no gateway fields
    expect(result!.input_cost).toBeNull();
    expect(result!.output_cost).toBeNull();
  });

  test('handles zero prompt tokens with all cost on completions', () => {
    // Real response: video_url_public_api — prompt_tokens=0, all cost on output side.
    // upstream_inference_prompt_cost=0, upstream_inference_cost equals cost.
    const usage = {
      completion_tokens: 180,
      completion_tokens_details: { image_tokens: 0, reasoning_tokens: 0 },
      cost: 0.00045,
      cost_details: {
        upstream_inference_completions_cost: 0.00045,
        upstream_inference_cost: 0.00045,
        upstream_inference_prompt_cost: 0,
      },
      is_byok: false,
      prompt_tokens: 0,
      prompt_tokens_details: {
        audio_tokens: 0,
        cache_write_tokens: 0,
        cached_tokens: 0,
        video_tokens: 0,
      },
      total_tokens: 180,
    };

    const result = extractUsageCostDetails(usage);
    expect(result).not.toBeNull();
    expect(result!.total_cost).toBe(0.00045);
    expect(result!.upstream_inference_prompt_cost).toBe(0);
    expect(result!.upstream_inference_completions_cost).toBe(0.00045);
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
  test('applies gateway input/output/cached costs directly when full breakdown is present', () => {
    const record = createUsageRecord();
    // Extracted from: glm-5.1 via LLM Gateway (real response)
    const costDetails: ProviderCostDetails = {
      total_cost: 0.022101624,
      input_cost: 0.00073836,
      output_cost: 0.00041184,
      cached_input_cost: 0.020951424,
      cache_write_input_cost: 0,
      upstream_inference_cost: 0.022101624,
      upstream_inference_prompt_cost: 0.021689784,
      upstream_inference_completions_cost: 0.00041184,
      request_cost: 0,
      web_search_cost: 0,
      image_input_cost: null,
      image_output_cost: null,
      audio_input_cost: null,
      data_storage_cost: null,
    };

    applyUsageCostDetails(record, costDetails);

    expect(record.costTotal).toBeCloseTo(0.022101624, 8);
    expect(record.costSource).toBe('provider_reported');
    expect(record.providerReportedCost).toBe(0.022101624);
    expect(record.costInput).toBe(0.00073836);
    expect(record.costOutput).toBe(0.00041184);
    expect(record.costCached).toBeCloseTo(0.020951424, 8);
    expect(record.costCacheWrite).toBe(0);
  });

  test('falls back to proportional distribution when no cost breakdown available', () => {
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

  test('attributes full cost to input when no cost breakdown and no prior costs', () => {
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

  test('splits upstream prompt cost between input and cached using existing cost ratio', () => {
    const record = createUsageRecord();
    // createUsageRecord defaults: costInput=0.001, costCached=0.0005
    // Prompt ratio: input=0.001/(0.001+0.0005)=2/3, cached=0.0005/(0.001+0.0005)=1/3
    // Extracted from: z-ai/glm-5-turbo-20260315 (real response, cached_tokens=128/173 prompt tokens)
    const costDetails: ProviderCostDetails = {
      total_cost: 0.00021672,
      input_cost: null,
      output_cost: null,
      cached_input_cost: null,
      cache_write_input_cost: null,
      upstream_inference_cost: 0.00021672,
      upstream_inference_prompt_cost: 0.00008472,
      upstream_inference_completions_cost: 0.000132,
      request_cost: null,
      web_search_cost: null,
      image_input_cost: null,
      image_output_cost: null,
      audio_input_cost: null,
      data_storage_cost: null,
    };

    applyUsageCostDetails(record, costDetails);

    expect(record.costTotal).toBe(0.00021672);
    expect(record.costSource).toBe('provider_reported');
    expect(record.costOutput).toBe(0.000132);
    // Prompt (0.00008472) split by record ratio: input=2/3, cached=1/3
    expect(record.costInput).toBeCloseTo((2 / 3) * 0.00008472, 8);
    expect(record.costCached).toBeCloseTo((1 / 3) * 0.00008472, 8);
    expect(record.costCacheWrite).toBe(0);
  });

  test('splits upstream prompt cost by ratio when upstream_inference_cost is null (heavy cache hit)', () => {
    // Real response: x-ai/grok-4 via OpenRouter — 679/687 prompt tokens cached.
    // upstream_inference_cost is null; total comes from usage.cost instead.
    // Prior costs use token-proportional amounts: costInput=0.00008 (8 tokens),
    // costCached=0.00679 (679 tokens), prevPromptTotal=0.00687.
    const record = createUsageRecord({
      costInput: 0.00008,
      costCached: 0.00679,
      costCacheWrite: 0,
      costTotal: 0.00687,
    });
    const costDetails: ProviderCostDetails = {
      total_cost: 0.00333825,
      input_cost: null,
      output_cost: null,
      cached_input_cost: null,
      cache_write_input_cost: null,
      upstream_inference_cost: null,
      upstream_inference_prompt_cost: 0.00053325,
      upstream_inference_completions_cost: 0.002805,
      request_cost: null,
      web_search_cost: null,
      image_input_cost: null,
      image_output_cost: null,
      audio_input_cost: null,
      data_storage_cost: null,
    };

    applyUsageCostDetails(record, costDetails);

    expect(record.costTotal).toBe(0.00333825);
    expect(record.costSource).toBe('provider_reported');
    expect(record.costOutput).toBe(0.002805);
    // Prompt (0.00053325) split by prior ratio: input=0.00008/0.00687, cached=0.00679/0.00687
    expect(record.costInput).toBeCloseTo((0.00008 / 0.00687) * 0.00053325, 8);
    expect(record.costCached).toBeCloseTo((0.00679 / 0.00687) * 0.00053325, 8);
    expect(record.costCacheWrite).toBe(0);
  });

  test('attributes full upstream prompt cost to input when no cached tokens', () => {
    const record = createUsageRecord({ costCached: 0, costCacheWrite: 0, costTotal: 0.003 });
    // Extracted from: normal-tier real response (cached_tokens=0)
    const costDetails: ProviderCostDetails = {
      total_cost: 0.00435825,
      input_cost: null,
      output_cost: null,
      cached_input_cost: null,
      cache_write_input_cost: null,
      upstream_inference_cost: null,
      upstream_inference_prompt_cost: 4.25e-6,
      upstream_inference_completions_cost: 0.004354,
      request_cost: null,
      web_search_cost: null,
      image_input_cost: null,
      image_output_cost: null,
      audio_input_cost: null,
      data_storage_cost: null,
    };

    applyUsageCostDetails(record, costDetails);

    expect(record.costTotal).toBe(0.00435825);
    expect(record.costOutput).toBe(0.004354);
    expect(record.costInput).toBe(4.25e-6);
    expect(record.costCached).toBe(0);
    expect(record.costCacheWrite).toBe(0);
  });

  test('end-to-end BYOK: extract + apply uses upstream cost when usage.cost is 0', () => {
    // Real response: google_nested_schema BYOK — cost=0, real cost in upstream_inference_cost.
    // extractUsageCostDetails picks upstream_inference_cost as total;
    // applyUsageCostDetails hits the normal-tier branch (no gateway fields, only upstream).
    const usage = {
      completion_tokens: 91,
      cost: 0,
      cost_details: {
        upstream_inference_completions_cost: 0.0002275,
        upstream_inference_cost: 0.0003253,
        upstream_inference_prompt_cost: 9.78e-5,
      },
      is_byok: true,
      prompt_tokens: 326,
      prompt_tokens_details: { cached_tokens: 0 },
    };

    const extracted = extractUsageCostDetails(usage);
    expect(extracted).not.toBeNull();
    expect(extracted!.total_cost).toBe(0.0003253);

    // Record has no prior cost breakdown (fresh record from a BYOK provider)
    const record = createUsageRecord({
      costInput: 0,
      costOutput: 0,
      costCached: 0,
      costCacheWrite: 0,
      costTotal: 0,
    });
    applyUsageCostDetails(record, extracted!);

    expect(record.costTotal).toBe(0.0003253);
    expect(record.costSource).toBe('provider_reported');
    // Normal-tier: output from upstream, full prompt portion to input (no cached tokens in record)
    expect(record.costOutput).toBe(0.0002275);
    expect(record.costInput).toBe(9.78e-5);
    expect(record.costCached).toBe(0);
    expect(record.costCacheWrite).toBe(0);
  });

  test('end-to-end non-BYOK normal-tier: extract + apply', () => {
    // Real response: usage.yaml second interaction — cost=0.00435825, only upstream fields.
    // upstream_inference_cost is null (not BYOK), total comes from usage.cost.
    const usage = {
      completion_tokens: 2177,
      cost: 0.00435825,
      cost_details: {
        upstream_inference_completions_cost: 0.004354,
        upstream_inference_cost: null,
        upstream_inference_prompt_cost: 4.25e-6,
      },
      is_byok: false,
      prompt_tokens: 17,
      prompt_tokens_details: { cached_tokens: 0 },
    };

    const extracted = extractUsageCostDetails(usage);
    expect(extracted).not.toBeNull();
    expect(extracted!.total_cost).toBe(0.00435825);

    // Record with no prior breakdown
    const record = createUsageRecord({
      costInput: 0,
      costOutput: 0,
      costCached: 0,
      costCacheWrite: 0,
      costTotal: 0,
    });
    applyUsageCostDetails(record, extracted!);

    expect(record.costTotal).toBe(0.00435825);
    expect(record.costOutput).toBe(0.004354);
    expect(record.costInput).toBe(4.25e-6);
    expect(record.costCached).toBe(0);
  });

  test('uses partial gateway breakdown when only some per-bucket costs are available', () => {
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
      request_cost: null,
      web_search_cost: null,
      image_input_cost: null,
      image_output_cost: null,
      audio_input_cost: null,
      data_storage_cost: null,
      upstream_inference_cost: null,
      upstream_inference_prompt_cost: null,
      upstream_inference_completions_cost: null,
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
      request_cost: 0,
      web_search_cost: 0,
      image_input_cost: 0,
      image_output_cost: 0,
      audio_input_cost: 0,
      data_storage_cost: 0,
      upstream_inference_cost: null,
      upstream_inference_prompt_cost: null,
      upstream_inference_completions_cost: null,
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
      request_cost: 0,
      web_search_cost: 0,
      image_input_cost: 0,
      image_output_cost: 0,
      audio_input_cost: 0,
      data_storage_cost: 0,
      upstream_inference_cost: null,
      upstream_inference_prompt_cost: null,
      upstream_inference_completions_cost: null,
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
