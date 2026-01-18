import { UnifiedChatResponse } from "../../types/unified";

/**
 * Transforms a Gemini API response into unified format.
 *
 * Key transformations:
 * - Extracts text and reasoning content from parts
 * - Reconstructs tool calls
 * - Handles thought signatures
 * - Normalizes usage metadata
 */
export async function transformGeminiResponse(
  response: any
): Promise<UnifiedChatResponse> {
  const candidate = response.candidates?.[0];
  const parts = candidate?.content?.parts || [];

  let content = "";
  let reasoning_content = "";
  const tool_calls: any[] = [];
  let thoughtSignature: string | undefined;

  parts.forEach((part: any) => {
    if (part.text) {
      if (part.thought === true) reasoning_content += part.text;
      else content += part.text;
    }
    if (part.functionCall) {
      tool_calls.push({
        id:
          part.functionCall.name ||
          "call_" + Math.random().toString(36).substring(7),
        type: "function",
        function: {
          name: part.functionCall.name,
          arguments: JSON.stringify(part.functionCall.args),
        },
      });
    }
    if (part.thoughtSignature) thoughtSignature = part.thoughtSignature;
  });

  const usage = response.usageMetadata
    ? {
        input_tokens: response.usageMetadata.promptTokenCount || 0,
        output_tokens: response.usageMetadata.candidatesTokenCount || 0,
        total_tokens: response.usageMetadata.totalTokenCount || 0,
        reasoning_tokens: response.usageMetadata.thoughtsTokenCount || 0,
        cached_tokens: response.usageMetadata.cachedContentTokenCount || 0,
        cache_creation_tokens: 0,
      }
    : undefined;

  return {
    id: response.responseId || "gemini-" + Date.now(),
    model: response.modelVersion || "gemini-model",
    content: content || null,
    reasoning_content: reasoning_content || null,
    thinking: thoughtSignature
      ? { content: reasoning_content, signature: thoughtSignature }
      : undefined,
    tool_calls: tool_calls.length > 0 ? tool_calls : undefined,
    usage,
  };
}
