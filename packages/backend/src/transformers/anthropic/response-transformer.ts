import { UnifiedChatResponse } from "../../types/unified";
import { countTokens } from "../utils";

/**
 * Transforms an Anthropic API response into unified format.
 *
 * Key transformations:
 * - Combines text and reasoning content blocks
 * - Reconstructs tool calls in unified format
 * - Implements token imputation logic for thinking tokens
 * - Normalizes usage statistics
 */
export async function transformAnthropicResponse(
  response: any
): Promise<UnifiedChatResponse> {
  const contentBlocks = response.content || [];
  let text = "";
  let reasoning = "";
  const toolCalls: any[] = [];

  for (const block of contentBlocks) {
    if (block.type === "text") {
    text += block.text;
    } else if (block.type === "thinking") {
      reasoning += block.thinking;
    } else if (block.type === "tool_use") {
      toolCalls.push({
        id: block.id,
      type: "function",
        function: {
          name: block.name,
          arguments: JSON.stringify(block.input),
        },
      });
    }
  }

  const inputTokens = response.usage?.input_tokens || 0;
  const totalOutputTokens = response.usage?.output_tokens || 0;
  const cacheReadTokens = response.usage?.cache_read_input_tokens || 0;
  const cacheCreationTokens =
    response.usage?.cache_creation_input_tokens || 0;

  let realOutputTokens = totalOutputTokens;
  let imputedThinkingTokens = 0;

  // TOKEN IMPUTATION LOGIC:
  // If the provider doesn't explicitly return thinking tokens but has thinking content,
  // we estimate text tokens and assume the remainder is reasoning.
  if (reasoning.length > 0) {
    realOutputTokens = countTokens(text);
    imputedThinkingTokens = Math.max(0, totalOutputTokens - realOutputTokens);
  }

  return {
    id: response.id,
    model: response.model,
    content: text || null,
    reasoning_content: reasoning || null,
    tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
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
