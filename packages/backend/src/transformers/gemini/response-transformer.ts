import { UnifiedChatResponse } from '../../types/unified';
import { logger } from '../../utils/logger';
import { isValidThoughtSignature } from './utils';
import { normalizeGeminiUsage } from '../../utils/usage-normalizer';

/**
 * Transforms a Gemini API response into unified format.
 *
 * Key transformations:
 * - Extracts text and reasoning content from parts
 * - Reconstructs tool calls
 * - Handles thought signatures
 * - Normalizes usage metadata
 */
export async function transformGeminiResponse(response: any): Promise<UnifiedChatResponse> {
  const candidate = response.candidates?.[0];
  const parts = candidate?.content?.parts || [];

  let content = '';
  let reasoning_content = '';
  const tool_calls: any[] = [];
  let thoughtSignature: string | undefined;

  parts.forEach((part: any) => {
    if (part.text) {
      if (part.thought === true) reasoning_content += part.text;
      else content += part.text;
    }
    if (part.functionCall) {
      tool_calls.push({
        id: part.functionCall.name || 'call_' + Math.random().toString(36).substring(7),
        type: 'function',
        function: {
          name: part.functionCall.name,
          arguments: JSON.stringify(part.functionCall.args),
        },
      });
    }
    // Gap 6: Validate thought signatures for base64 format
    if (part.thoughtSignature) {
      if (isValidThoughtSignature(part.thoughtSignature)) {
        thoughtSignature = part.thoughtSignature;
      } else {
        logger.warn(
          `[gemini] Invalid thought signature detected in response, stripping. Signature length: ${part.thoughtSignature.length}`
        );
        // Don't assign invalid signature - strip it
      }
    }
  });

  const usage = response.usageMetadata ? normalizeGeminiUsage(response.usageMetadata) : undefined;

  const rawFinishReason = candidate?.finishReason?.toLowerCase() || null;
  const finishReason = tool_calls.length > 0 && rawFinishReason === 'stop' ? 'tool_calls' : rawFinishReason;

  return {
    id: response.responseId || 'gemini-' + Date.now(),
    model: response.modelVersion || 'gemini-model',
    content: content || null,
    reasoning_content: reasoning_content || null,
    thinking: thoughtSignature
      ? { content: reasoning_content, signature: thoughtSignature }
      : undefined,
    tool_calls: tool_calls.length > 0 ? tool_calls : undefined,
    finishReason,
    usage,
  };
}
