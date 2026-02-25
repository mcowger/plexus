import { Part } from '@google/genai';
import { UnifiedChatResponse } from '../../types/unified';

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

  if (response.content) parts.push({ text: response.content });

  if (response.tool_calls) {
    response.tool_calls.forEach((tc, index) => {
      const part: any = {
        functionCall: {
          name: tc.function.name,
          args: JSON.parse(tc.function.arguments),
        },
      };
      if (index === 0 && response.thinking?.signature && !response.reasoning_content) {
        part.thoughtSignature = response.thinking.signature;
      }
      parts.push(part);
    });
  }

  // Determine finish reason: if there are tool calls, use 'TOOL_USE' instead of 'STOP'
  const hasToolCalls = response.tool_calls && response.tool_calls.length > 0;
  const finishReason = hasToolCalls ? 'TOOL_USE' : 'STOP';

  return {
    candidates: [{ content: { role: 'model', parts }, finishReason, index: 0 }],
    usageMetadata: response.usage
      ? {
          promptTokenCount: response.usage.input_tokens,
          candidatesTokenCount: response.usage.output_tokens,
          totalTokenCount: response.usage.total_tokens,
          thoughtsTokenCount: response.usage.reasoning_tokens,
        }
      : undefined,
    modelVersion: response.model,
  };
}
