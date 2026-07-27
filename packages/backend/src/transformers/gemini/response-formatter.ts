import { Part } from '@google/genai';
import { UnifiedChatResponse } from '../../types/unified';
import { composeContentWithImageMarkdown } from '../image-rendering';

/**
 * Formats a unified response back to Gemini's format for returning to clients.
 *
 * Key transformations:
 * - Reconstructs Gemini parts (text, thought, functionCall)
 * - Handles thought signatures
 * - Formats usage metadata
 * - Detects toolUse finish reason when tool calls are present
 */
export async function formatGeminiResponse(response: UnifiedChatResponse): Promise<any> {
  const parts: Part[] = [];

  if (response.reasoning_content) {
    const part: any = { text: response.reasoning_content, thought: true };
    if (response.thinking?.signature) part.thoughtSignature = response.thinking.signature;
    parts.push(part);
  }

  // Gemini-format clients see image_generation_call output as size-guarded
  // markdown composed after the authored text (see
  // transformers/image-rendering.ts) — unified `content` itself stays pure.
  const textContent = composeContentWithImageMarkdown(
    response.content,
    response.image_generation_calls
  );
  if (textContent) parts.push({ text: textContent });

  if (response.tool_calls) {
    response.tool_calls.forEach((tc, index) => {
      const part: any = {
        functionCall: {
          name: tc.function.name,
          args: JSON.parse(tc.function.arguments),
        },
      };

      // Check for signature in the tool call itself (preferred) or fall back to global thinking signature
      const sig = (tc as any).thinking?.signature || (tc as any).thought_signature;
      if (sig) {
        part.thoughtSignature = sig;
      } else if (index === 0 && response.thinking?.signature && !response.reasoning_content) {
        part.thoughtSignature = response.thinking.signature;
      }

      parts.push(part);
    });
  }

  // Gemini always uses 'STOP' as finish reason (TOOL_USE is not valid in Gemini)
  const finishReason = 'STOP';

  const result: any = {
    candidates: [{ content: { role: 'model', parts }, finishReason, index: 0 }],
    usageMetadata: response.usage
      ? {
          promptTokenCount: response.usage.input_tokens + (response.usage.cached_tokens || 0),
          candidatesTokenCount: response.usage.output_tokens,
          totalTokenCount: response.usage.total_tokens,
          thoughtsTokenCount: response.usage.reasoning_tokens,
          cachedContentTokenCount: response.usage.cached_tokens,
        }
      : undefined,
    modelVersion: response.model,
  };

  if (response.id) result.responseId = response.id;

  return result;
}
