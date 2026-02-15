import { UnifiedUsage } from '../types/unified';

type UsageSubset = Pick<UnifiedUsage, 'input_tokens' | 'output_tokens' | 'total_tokens' | 'reasoning_tokens' | 'cached_tokens' | 'cache_creation_tokens'>;

const safeToken = (value: unknown): number => {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.floor(num));
};

export function normalizeOpenAIChatUsage(usage: any): UsageSubset {
  const promptTokens = safeToken(usage?.prompt_tokens);
  const cachedTokens = safeToken(usage?.prompt_tokens_details?.cached_tokens ?? usage?.cached_tokens);
  const outputTokens = safeToken(usage?.completion_tokens);
  const reasoningTokens = safeToken(usage?.completion_tokens_details?.reasoning_tokens);

  // OpenAI chat prompt_tokens generally includes cached tokens, but guard for edge payloads.
  const inputTokens = cachedTokens > promptTokens
    ? promptTokens
    : Math.max(0, promptTokens - cachedTokens);

  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: safeToken(usage?.total_tokens) || inputTokens + cachedTokens + outputTokens,
    reasoning_tokens: reasoningTokens,
    cached_tokens: cachedTokens,
    cache_creation_tokens: 0,
  };
}

export function normalizeOpenAIResponsesUsage(usage: any): UsageSubset {
  const inputTokens = safeToken(usage?.input_tokens);
  const cachedTokens = safeToken(usage?.input_tokens_details?.cached_tokens);
  const outputTokens = safeToken(usage?.output_tokens);
  const reasoningTokens = safeToken(usage?.output_tokens_details?.reasoning_tokens);

  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: safeToken(usage?.total_tokens) || inputTokens + cachedTokens + outputTokens,
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
    total_tokens: safeToken(usage?.totalTokens ?? usage?.total_tokens) || inputTokens + cachedTokens + cacheCreationTokens + outputTokens,
    reasoning_tokens: safeToken(usage?.reasoning_tokens),
    cached_tokens: cachedTokens,
    cache_creation_tokens: cacheCreationTokens,
  };
}
