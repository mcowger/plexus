import { UnifiedUsage } from '../types/unified';

type UsageSubset = Pick<
  UnifiedUsage,
  | 'input_tokens'
  | 'output_tokens'
  | 'total_tokens'
  | 'reasoning_tokens'
  | 'cached_tokens'
  | 'cache_creation_tokens'
>;

const safeToken = (value: unknown): number => {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.floor(num));
};

const safeCost = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return null;
  return num;
};

export interface ProviderCostDetails {
  total_cost: number | null;
  input_cost: number | null;
  output_cost: number | null;
  cached_input_cost: number | null;
  cache_write_input_cost: number | null;
  upstream_inference_cost: number | null;
  upstream_inference_prompt_cost: number | null;
  upstream_inference_completions_cost: number | null;
  request_cost: number | null;
  web_search_cost: number | null;
  image_input_cost: number | null;
  image_output_cost: number | null;
  audio_input_cost: number | null;
  data_storage_cost: number | null;
}

export interface UsageWithCostDetails extends UsageSubset {
  provider_cost_details: ProviderCostDetails | null;
}

/**
 * Extract provider-reported cost details from the usage.cost_details block.
 * Some providers (e.g., openrouter-like proxies) include detailed cost
 * breakdowns directly in the usage object.
 */
export function extractUsageCostDetails(usage: any): ProviderCostDetails | null {
  const details = usage?.cost_details;
  if (!details || typeof details !== 'object') return null;

  // Determine total cost:
  // 1. cost_details.total_cost
  // 2. usage.cost or usage.estimated_cost (standard path)
  // 3. cost_details.upstream_inference_cost (OpenRouter quirk)
  let totalCost = safeCost(details.total_cost);

  const costFromUsage = safeCost(usage?.cost ?? usage?.estimated_cost);
  const upstreamInferenceCost = safeCost(details.upstream_inference_cost);

  if (totalCost === null) {
    // || not ?? — BYOK keys report usage.cost=0 (Plexus charges nothing), so a
    // falsy 0 should fall through to upstreamInferenceCost which carries the
    // actual provider cost.
    totalCost = costFromUsage || upstreamInferenceCost;
  }
  if (totalCost === null) return null;

  return {
    total_cost: totalCost,
    input_cost: safeCost(details.input_cost ?? details.upstream_inference_prompt_cost),
    output_cost: safeCost(details.output_cost ?? details.upstream_inference_completions_cost),
    cached_input_cost: safeCost(details.cached_input_cost),
    cache_write_input_cost: safeCost(details.cache_write_input_cost),
    upstream_inference_cost: safeCost(details.upstream_inference_cost),
    upstream_inference_prompt_cost: safeCost(details.upstream_inference_prompt_cost),
    upstream_inference_completions_cost: safeCost(details.upstream_inference_completions_cost),
    request_cost: safeCost(details.request_cost),
    web_search_cost: safeCost(details.web_search_cost),
    image_input_cost: safeCost(details.image_input_cost),
    image_output_cost: safeCost(details.image_output_cost),
    audio_input_cost: safeCost(details.audio_input_cost),
    data_storage_cost: safeCost(details.data_storage_cost),
  };
}

export function normalizeOpenAIChatUsage(usage: any): UsageSubset {
  const promptTokens = safeToken(usage?.prompt_tokens);
  const cachedTokens = safeToken(
    usage?.prompt_tokens_details?.cached_tokens ?? usage?.cached_tokens
  );
  const cacheWriteTokens = safeToken(usage?.prompt_tokens_details?.cache_write_tokens);
  const outputTokens = safeToken(usage?.completion_tokens);
  const reasoningTokens = safeToken(usage?.completion_tokens_details?.reasoning_tokens);

  // OpenAI chat prompt_tokens generally includes cached tokens, but guard for edge payloads.
  const inputTokens =
    cachedTokens > promptTokens ? promptTokens : Math.max(0, promptTokens - cachedTokens);

  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: safeToken(usage?.total_tokens) || inputTokens + cachedTokens + outputTokens,
    reasoning_tokens: reasoningTokens,
    cached_tokens: cachedTokens,
    cache_creation_tokens: cacheWriteTokens,
  };
}

export function normalizeOpenAIResponsesUsage(usage: any): UsageSubset {
  const reportedInputTokens = safeToken(usage?.input_tokens);
  const cachedTokens = safeToken(usage?.input_tokens_details?.cached_tokens);
  const outputTokens = safeToken(usage?.output_tokens);
  const reasoningTokens = safeToken(usage?.output_tokens_details?.reasoning_tokens);

  // Responses payloads may appear in two shapes depending on source:
  // - total input tokens with cached included
  // - uncached input tokens with cached reported separately
  const inputTokens =
    cachedTokens > reportedInputTokens
      ? reportedInputTokens
      : Math.max(0, reportedInputTokens - cachedTokens);

  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: safeToken(usage?.total_tokens) || inputTokens + cachedTokens + outputTokens,
    reasoning_tokens: reasoningTokens,
    cached_tokens: cachedTokens,
    cache_creation_tokens: 0,
  };
}

export function normalizeGeminiUsage(usageMetadata: any): UsageSubset {
  const promptTokens = safeToken(usageMetadata?.promptTokenCount);
  const cachedTokens = safeToken(usageMetadata?.cachedContentTokenCount);
  const outputTokens = safeToken(usageMetadata?.candidatesTokenCount);
  const reasoningTokens = safeToken(usageMetadata?.thoughtsTokenCount);
  const toolUsePromptTokens = safeToken(usageMetadata?.toolUsePromptTokenCount);

  // Vertex/Gemini promptTokenCount includes cached content when present.
  const inputTokens =
    cachedTokens > promptTokens ? promptTokens : Math.max(0, promptTokens - cachedTokens);

  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens:
      safeToken(usageMetadata?.totalTokenCount) ||
      promptTokens + outputTokens + toolUsePromptTokens + reasoningTokens,
    reasoning_tokens: reasoningTokens,
    cached_tokens: cachedTokens,
    cache_creation_tokens: 0,
  };
}

export function normalizeAnthropicUsage(usage: any): UsageSubset {
  const inputTokens = safeToken(usage?.input_tokens);
  const cachedTokens = safeToken(usage?.cache_read_input_tokens);
  const cacheCreationTokens = safeToken(usage?.cache_creation_input_tokens);
  const outputTokens = safeToken(usage?.output_tokens);

  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: inputTokens + cachedTokens + cacheCreationTokens + outputTokens,
    reasoning_tokens: 0,
    cached_tokens: cachedTokens,
    cache_creation_tokens: cacheCreationTokens,
  };
}

export function normalizeOAuthUsage(usage: any): UsageSubset {
  const inputTokens = safeToken(usage?.input ?? usage?.input_tokens);
  const outputTokens = safeToken(usage?.output ?? usage?.output_tokens);
  const cachedTokens = safeToken(usage?.cacheRead ?? usage?.cached_tokens);
  const cacheCreationTokens = safeToken(usage?.cacheWrite ?? usage?.cache_creation_tokens);

  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens:
      safeToken(usage?.totalTokens ?? usage?.total_tokens) ||
      inputTokens + cachedTokens + cacheCreationTokens + outputTokens,
    reasoning_tokens: safeToken(usage?.reasoning_tokens),
    cached_tokens: cachedTokens,
    cache_creation_tokens: cacheCreationTokens,
  };
}
