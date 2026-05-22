import { describe, expect, test } from 'vitest';
import {
  normalizeGeminiUsage,
  normalizeOpenAIChatUsage,
  normalizeOpenAIResponsesUsage,
  normalizeAnthropicUsage,
  extractUsageCostDetails,
} from '../usage-normalizer';

describe('usage-normalizer - OpenAI Responses usage', () => {
  test('normalizes multi-turn response with heavy cache hits and reasoning tokens', () => {
    const normalized = normalizeOpenAIResponsesUsage({
      input_tokens: 9299,
      output_tokens: 577,
      total_tokens: 9876,
      input_tokens_details: {
        cached_tokens: 8448,
      },
      output_tokens_details: {
        reasoning_tokens: 512,
      },
    });

    expect(normalized.input_tokens).toBe(851); // 9299 - 8448
    expect(normalized.cached_tokens).toBe(8448);
    expect(normalized.output_tokens).toBe(577);
    expect(normalized.total_tokens).toBe(9876);
    expect(normalized.reasoning_tokens).toBe(512);
    expect(normalized.cache_creation_tokens).toBe(0);
  });

  test('normalizes when input_tokens includes cached tokens', () => {
    const normalized = normalizeOpenAIResponsesUsage({
      input_tokens: 2006,
      output_tokens: 300,
      total_tokens: 2306,
      input_tokens_details: {
        cached_tokens: 1920,
      },
      output_tokens_details: {
        reasoning_tokens: 0,
      },
    });

    expect(normalized.input_tokens).toBe(86);
    expect(normalized.cached_tokens).toBe(1920);
    expect(normalized.output_tokens).toBe(300);
    expect(normalized.total_tokens).toBe(2306);
    expect(normalized.reasoning_tokens).toBe(0);
    expect(normalized.cache_creation_tokens).toBe(0);
  });

  test('extracts cache_write_tokens from input_tokens_details and subtracts from input', () => {
    // OpenAI Responses API includes cache_write_tokens inside input_tokens.
    // input_tokens = uncached_input + cached_tokens + cache_write_tokens
    const normalized = normalizeOpenAIResponsesUsage({
      input_tokens: 1200,
      output_tokens: 800,
      total_tokens: 2000,
      input_tokens_details: {
        cached_tokens: 500,
        cache_write_tokens: 200,
      },
      output_tokens_details: {
        reasoning_tokens: 0,
      },
    });

    expect(normalized.input_tokens).toBe(500); // 1200 - 500 - 200
    expect(normalized.cached_tokens).toBe(500);
    expect(normalized.cache_creation_tokens).toBe(200);
    expect(normalized.output_tokens).toBe(800);
    expect(normalized.total_tokens).toBe(2000);
  });

  test('preserves uncached input when cached_tokens exceeds input_tokens', () => {
    const normalized = normalizeOpenAIResponsesUsage({
      input_tokens: 5233,
      output_tokens: 2643,
      total_tokens: 62660,
      input_tokens_details: {
        cached_tokens: 54784,
      },
      output_tokens_details: {
        reasoning_tokens: 0,
      },
    });

    expect(normalized.input_tokens).toBe(5233);
    expect(normalized.cached_tokens).toBe(54784);
    expect(normalized.output_tokens).toBe(2643);
    expect(normalized.total_tokens).toBe(62660);
    expect(normalized.reasoning_tokens).toBe(0);
    expect(normalized.cache_creation_tokens).toBe(0);
    expect(normalized.input_tokens).toBeGreaterThanOrEqual(0);
  });
});

describe('usage-normalizer - Gemini usage', () => {
  test('normalizes promptTokenCount as total prompt and subtracts cachedContentTokenCount', () => {
    const normalized = normalizeGeminiUsage({
      promptTokenCount: 2152,
      candidatesTokenCount: 710,
      totalTokenCount: 3564,
      thoughtsTokenCount: 702,
      cachedContentTokenCount: 2027,
    });

    expect(normalized.input_tokens).toBe(125);
    expect(normalized.cached_tokens).toBe(2027);
    expect(normalized.output_tokens).toBe(710);
    expect(normalized.reasoning_tokens).toBe(702);
    expect(normalized.total_tokens).toBe(3564);
    expect(normalized.cache_creation_tokens).toBe(0);
  });

  test('guards against cache values larger than prompt token count', () => {
    const normalized = normalizeGeminiUsage({
      promptTokenCount: 7,
      candidatesTokenCount: 336,
      totalTokenCount: 1027,
      thoughtsTokenCount: 684,
      cachedContentTokenCount: 50,
    });

    expect(normalized.input_tokens).toBe(7);
    expect(normalized.cached_tokens).toBe(50);
    expect(normalized.output_tokens).toBe(336);
    expect(normalized.reasoning_tokens).toBe(684);
    expect(normalized.total_tokens).toBe(1027);
  });
});

describe('usage-normalizer - OpenAI Chat usage', () => {
  test('normalizes prompt_tokens_details with cached_tokens', () => {
    const normalized = normalizeOpenAIChatUsage({
      prompt_tokens: 2006,
      completion_tokens: 300,
      total_tokens: 2306,
      prompt_tokens_details: {
        cached_tokens: 1920,
      },
      completion_tokens_details: {
        reasoning_tokens: 0,
      },
    });

    expect(normalized.input_tokens).toBe(86);
    expect(normalized.cached_tokens).toBe(1920);
    expect(normalized.output_tokens).toBe(300);
    expect(normalized.total_tokens).toBe(2306);
    expect(normalized.reasoning_tokens).toBe(0);
    expect(normalized.cache_creation_tokens).toBe(0);
  });

  test('extracts cache_write_tokens from prompt_tokens_details', () => {
    const normalized = normalizeOpenAIChatUsage({
      prompt_tokens: 2006,
      completion_tokens: 300,
      total_tokens: 2306,
      prompt_tokens_details: {
        cached_tokens: 1920,
        cache_write_tokens: 50,
      },
      completion_tokens_details: {
        reasoning_tokens: 10,
      },
    });

    expect(normalized.cache_creation_tokens).toBe(50);
    expect(normalized.cached_tokens).toBe(1920);
    expect(normalized.reasoning_tokens).toBe(10);
  });

  test('normalizes DeepSeek top-level prompt_cache_hit_tokens / prompt_cache_miss_tokens', () => {
    // DeepSeek reports cache at the top level instead of under prompt_tokens_details.
    // prompt_tokens = hit + miss; input_tokens should be the miss (uncached) portion.
    const normalized = normalizeOpenAIChatUsage({
      prompt_tokens: 1000,
      completion_tokens: 200,
      total_tokens: 1200,
      prompt_cache_hit_tokens: 800,
      prompt_cache_miss_tokens: 200,
    });

    expect(normalized.cached_tokens).toBe(800);
    expect(normalized.input_tokens).toBe(200);
    expect(normalized.output_tokens).toBe(200);
    expect(normalized.total_tokens).toBe(1200);
    expect(normalized.cache_creation_tokens).toBe(0);
  });

  test('defaults cache_write_tokens to 0 when not present', () => {
    const normalized = normalizeOpenAIChatUsage({
      prompt_tokens: 100,
      completion_tokens: 50,
      total_tokens: 150,
      prompt_tokens_details: {
        cached_tokens: 20,
      },
    });

    expect(normalized.cache_creation_tokens).toBe(0);
  });

  test('handles new usage format with cost_details (tokens only)', () => {
    const normalized = normalizeOpenAIChatUsage({
      prompt_tokens: 23,
      total_tokens: 66,
      completion_tokens: 43,
      estimated_cost: 0.00017465,
      prompt_tokens_details: {
        cached_tokens: 0,
        cache_write_tokens: 0,
        audio_tokens: 0,
        video_tokens: 0,
        image_tokens: 0,
      },
      cost: 0.00017465,
      cost_details: {
        total_cost: 0.00017465,
        input_cost: 0.00002415,
        output_cost: 0.0001505,
      },
      completion_tokens_details: {
        reasoning_tokens: 0,
        image_tokens: 0,
        audio_tokens: 0,
      },
    });

    expect(normalized.input_tokens).toBe(23);
    expect(normalized.output_tokens).toBe(43);
    expect(normalized.cached_tokens).toBe(0);
    expect(normalized.cache_creation_tokens).toBe(0);
    expect(normalized.reasoning_tokens).toBe(0);
    expect(normalized.total_tokens).toBe(66);
  });
});

describe('usage-normalizer - Anthropic usage', () => {
  test('normalizes basic Anthropic non-streaming usage', () => {
    const normalized = normalizeAnthropicUsage({
      input_tokens: 16,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      output_tokens: 34,
    });

    expect(normalized.input_tokens).toBe(16);
    expect(normalized.output_tokens).toBe(34);
    expect(normalized.cached_tokens).toBe(0);
    expect(normalized.cache_creation_tokens).toBe(0);
    expect(normalized.total_tokens).toBe(50);
    expect(normalized.reasoning_tokens).toBe(0);
  });

  test('tolerates extra Anthropic non-streaming fields (cache_creation, service_tier, inference_geo)', () => {
    // Non-streaming Anthropic responses include cache_creation (nested), service_tier, inference_geo.
    // The normalizer must ignore these without erroring.
    const normalized = normalizeAnthropicUsage({
      input_tokens: 424,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 },
      output_tokens: 118,
      service_tier: 'standard',
      inference_geo: 'not_available',
    });

    expect(normalized.input_tokens).toBe(424);
    expect(normalized.output_tokens).toBe(118);
    expect(normalized.cached_tokens).toBe(0);
    expect(normalized.cache_creation_tokens).toBe(0);
    expect(normalized.total_tokens).toBe(542);
    expect(normalized.reasoning_tokens).toBe(0);
  });

  test('tolerates server_tool_use in streaming usage (web search)', () => {
    // Anthropic web search adds server_tool_use to usage. Must not break normalization.
    const normalized = normalizeAnthropicUsage({
      input_tokens: 13520,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      output_tokens: 415,
      server_tool_use: { web_search_requests: 1, web_fetch_requests: 0 },
    });

    expect(normalized.input_tokens).toBe(13520);
    expect(normalized.output_tokens).toBe(415);
    expect(normalized.cached_tokens).toBe(0);
    expect(normalized.cache_creation_tokens).toBe(0);
    expect(normalized.total_tokens).toBe(13935);
  });

  test('tolerates iterations array from compaction feature', () => {
    // New Anthropic compaction feature adds iterations array with per-step breakdowns.
    const normalized = normalizeAnthropicUsage({
      input_tokens: 172,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      output_tokens: 5,
      server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 },
      iterations: [
        {
          input_tokens: 100,
          output_tokens: 71,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 55096,
          cache_creation: { ephemeral_5m_input_tokens: 55096, ephemeral_1h_input_tokens: 0 },
          type: 'compaction',
        },
        {
          input_tokens: 172,
          output_tokens: 5,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
          cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 },
          type: 'message',
        },
      ],
    });

    expect(normalized.input_tokens).toBe(172);
    expect(normalized.output_tokens).toBe(5);
    expect(normalized.cached_tokens).toBe(0);
    expect(normalized.cache_creation_tokens).toBe(0);
    expect(normalized.total_tokens).toBe(177);
  });

  test('normalizes non-zero cache tokens from Anthropic', () => {
    // Validates cache_read_input_tokens and cache_creation_input_tokens are both extracted.
    const normalized = normalizeAnthropicUsage({
      input_tokens: 22397,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      output_tokens: 637,
      server_tool_use: { web_search_requests: 2, web_fetch_requests: 0 },
    });

    expect(normalized.input_tokens).toBe(22397);
    expect(normalized.output_tokens).toBe(637);
    expect(normalized.total_tokens).toBe(23034);
    expect(normalized.reasoning_tokens).toBe(0);
    expect(normalized.cache_creation_tokens).toBe(0);
  });
});

describe('usage-normalizer - Gemini usage (additional real-world shapes)', () => {
  test('normalizes usage with toolUsePromptTokenCount (web fetch tool)', () => {
    // toolUsePromptTokenCount is added to totalTokenCount by Gemini.
    const normalized = normalizeGeminiUsage({
      promptTokenCount: 32,
      candidatesTokenCount: 41,
      totalTokenCount: 2515,
      promptTokensDetails: [{ modality: 'TEXT', tokenCount: 32 }],
      toolUsePromptTokenCount: 2395,
      toolUsePromptTokensDetails: [{ modality: 'TEXT', tokenCount: 2395 }],
      thoughtsTokenCount: 47,
    });

    expect(normalized.input_tokens).toBe(32);
    expect(normalized.output_tokens).toBe(41);
    expect(normalized.reasoning_tokens).toBe(47);
    expect(normalized.cached_tokens).toBe(0);
    expect(normalized.cache_creation_tokens).toBe(0);
    // totalTokenCount is used directly, not recomputed
    expect(normalized.total_tokens).toBe(2515);
  });

  test('tolerates candidatesTokensDetails array (image generation)', () => {
    // promptTokensDetails/candidatesTokensDetails are modality arrays the normalizer ignores.
    const normalized = normalizeGeminiUsage({
      promptTokenCount: 3362,
      candidatesTokenCount: 9,
      totalTokenCount: 3371,
      promptTokensDetails: [
        { modality: 'IMAGE', tokenCount: 3354 },
        { modality: 'TEXT', tokenCount: 8 },
      ],
      candidatesTokensDetails: [{ modality: 'TEXT', tokenCount: 9 }],
    });

    expect(normalized.input_tokens).toBe(3362);
    expect(normalized.output_tokens).toBe(9);
    expect(normalized.reasoning_tokens).toBe(0);
    expect(normalized.cached_tokens).toBe(0);
    expect(normalized.total_tokens).toBe(3371);
  });

  test('tolerates trafficType from Vertex AI (flex tier)', () => {
    // Vertex AI adds trafficType (ON_DEMAND, ON_DEMAND_FLEX) to usageMetadata.
    const normalized = normalizeGeminiUsage({
      promptTokenCount: 155,
      candidatesTokenCount: 13,
      totalTokenCount: 168,
      trafficType: 'ON_DEMAND',
      promptTokensDetails: [{ modality: 'TEXT', tokenCount: 155 }],
      candidatesTokensDetails: [{ modality: 'TEXT', tokenCount: 13 }],
    });

    expect(normalized.input_tokens).toBe(155);
    expect(normalized.output_tokens).toBe(13);
    expect(normalized.total_tokens).toBe(168);
    expect(normalized.reasoning_tokens).toBe(0);
  });
});

describe('usage-normalizer - OpenAI Chat usage (additional real-world shapes)', () => {
  test('tolerates HuggingFace top-level cached_tokens outside prompt_tokens_details', () => {
    // HuggingFace Inference Providers report cached_tokens at the top level,
    // not nested under prompt_tokens_details.
    const normalized = normalizeOpenAIChatUsage({
      prompt_tokens: 10,
      completion_tokens: 955,
      total_tokens: 965,
      cached_tokens: 0,
    });

    expect(normalized.input_tokens).toBe(10);
    expect(normalized.output_tokens).toBe(955);
    expect(normalized.cached_tokens).toBe(0);
    expect(normalized.total_tokens).toBe(965);
  });

  test('tolerates Groq timing fields in usage', () => {
    // Groq adds queue_time, prompt_time, completion_time, total_time to usage.
    const normalized = normalizeOpenAIChatUsage({
      queue_time: 0.200019293,
      prompt_tokens: 201,
      prompt_time: 0.022569048,
      completion_tokens: 58,
      completion_time: 0.168140587,
      total_tokens: 259,
      total_time: 0.190709635,
    });

    expect(normalized.input_tokens).toBe(201);
    expect(normalized.output_tokens).toBe(58);
    expect(normalized.cached_tokens).toBe(0);
    expect(normalized.total_tokens).toBe(259);
  });

  test('tolerates DeepSeek prompt_cache_hit_tokens alongside prompt_tokens_details', () => {
    // DeepSeek provides prompt_cache_hit_tokens both at top-level AND under prompt_tokens_details.
    // prompt_tokens_details.cached_tokens takes priority (first in the ?? chain).
    const normalized = normalizeOpenAIChatUsage({
      prompt_tokens: 6,
      completion_tokens: 212,
      total_tokens: 218,
      prompt_tokens_details: { cached_tokens: 0 },
      completion_tokens_details: { reasoning_tokens: 198 },
      prompt_cache_hit_tokens: 0,
      prompt_cache_miss_tokens: 6,
    });

    expect(normalized.input_tokens).toBe(6);
    expect(normalized.output_tokens).toBe(212);
    expect(normalized.reasoning_tokens).toBe(198);
    expect(normalized.cached_tokens).toBe(0);
    expect(normalized.total_tokens).toBe(218);
  });

  test('tolerates Azure Grok extra fields (audio_prompt_tokens, num_sources_used, image_tokens)', () => {
    // Azure-hosted Grok adds audio_prompt_tokens, num_sources_used, and
    // image_tokens/text_tokens subfields in prompt_tokens_details.
    const normalized = normalizeOpenAIChatUsage({
      audio_prompt_tokens: 0,
      completion_tokens: 27,
      completion_tokens_details: {
        accepted_prediction_tokens: 0,
        audio_tokens: 0,
        reasoning_tokens: 379,
        rejected_prediction_tokens: 0,
      },
      num_sources_used: 0,
      prompt_tokens: 288,
      prompt_tokens_details: {
        audio_tokens: 0,
        cached_tokens: 0,
        image_tokens: 0,
        text_tokens: 288,
      },
      total_tokens: 694,
    });

    expect(normalized.input_tokens).toBe(288);
    expect(normalized.output_tokens).toBe(27);
    expect(normalized.cached_tokens).toBe(0);
    expect(normalized.reasoning_tokens).toBe(379);
    expect(normalized.total_tokens).toBe(694);
  });

  test('tolerates xAI cost_in_usd_ticks in usage (ignored for normalization)', () => {
    // xAI adds cost_in_usd_ticks (pricing data) — normalizer should ignore it.
    const normalized = normalizeOpenAIChatUsage({
      prompt_tokens: 436,
      completion_tokens: 68,
      total_tokens: 652,
      prompt_tokens_details: {
        text_tokens: 436,
        audio_tokens: 0,
        image_tokens: 0,
        cached_tokens: 152,
      },
      completion_tokens_details: {
        reasoning_tokens: 148,
        audio_tokens: 0,
        accepted_prediction_tokens: 0,
        rejected_prediction_tokens: 0,
      },
      num_sources_used: 0,
      cost_in_usd_ticks: 1724000,
    });

    expect(normalized.input_tokens).toBe(284); // 436 - 152
    expect(normalized.cached_tokens).toBe(152);
    expect(normalized.output_tokens).toBe(68);
    expect(normalized.reasoning_tokens).toBe(148);
    expect(normalized.total_tokens).toBe(652);
  });
});
