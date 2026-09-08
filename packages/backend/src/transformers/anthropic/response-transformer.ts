import { UnifiedChatResponse } from '../../types/unified';
import { countTokens } from '../utils';
import { anthropicReasoningTokens } from '../../utils/usage-normalizer';

/**
 * Transforms an Anthropic API response into unified format.
 *
 * Key transformations:
 * - Combines text and reasoning content blocks
 * - Reconstructs tool calls in unified format
 * - Implements token imputation logic for thinking tokens
 * - Normalizes usage statistics
 */
export async function transformAnthropicResponse(response: any): Promise<UnifiedChatResponse> {
  const contentBlocks = response.content || [];
  let text = '';
  let reasoning = '';
  const toolCalls: any[] = [];

  for (const block of contentBlocks) {
    if (block.type === 'text') {
      text += block.text;
    } else if (block.type === 'thinking') {
      reasoning += block.thinking;
    } else if (block.type === 'tool_use') {
      toolCalls.push({
        id: block.id,
        type: 'function',
        function: {
          name: block.name,
          arguments: JSON.stringify(block.input),
        },
      });
    }
  }

  const inputTokens = response.usage?.input_tokens || 0;
  const cacheReadTokens = response.usage?.cache_read_input_tokens || 0;
  const cacheCreationTokens = response.usage?.cache_creation_input_tokens || 0;
  const totalOutputTokens = response.usage?.output_tokens || 0;

  // Anthropic input_tokens is already the uncached portion, but Plexus unified
  // usage expects input_tokens (uncached) and cached_tokens separately.
  // Gemini/OpenAI promptTokenCount includes cache, but Anthropic does NOT.

  let realOutputTokens = totalOutputTokens;
  let imputedThinkingTokens = 0;

  // Prefer the provider's own figure: Anthropic reports thinking under
  // `usage.output_tokens_details.thinking_tokens`. `output_tokens` already
  // includes it, so the visible-text share is the remainder.
  const reportedThinkingTokens = anthropicReasoningTokens(response.usage);
  if (reportedThinkingTokens > 0) {
    imputedThinkingTokens = Math.min(reportedThinkingTokens, totalOutputTokens);
    realOutputTokens = totalOutputTokens - imputedThinkingTokens;
  } else if (reasoning.length > 0) {
    // TOKEN IMPUTATION LOGIC (fallback for upstreams that return thinking
    // content without a thinking token count): estimate text tokens and
    // assume the remainder is reasoning.
    realOutputTokens = countTokens(text);
    imputedThinkingTokens = Math.max(0, totalOutputTokens - realOutputTokens);
  }

  return {
    id: response.id,
    model: response.model,
    content: text || null,
    reasoning_content: reasoning || null,
    tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
    finishReason: response.stop_reason || null,
    usage: {
      input_tokens: inputTokens,
      output_tokens: realOutputTokens,
      total_tokens: inputTokens + totalOutputTokens,
      reasoning_tokens: imputedThinkingTokens,
      cached_tokens: cacheReadTokens,
      cache_creation_tokens: cacheCreationTokens,
    },
  };
}
