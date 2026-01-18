import { UnifiedChatResponse } from "../../types/unified";

/**
 * Formats a unified response back to Anthropic's format for returning to clients.
 *
 * Key transformations:
 * - Reconstructs Anthropic content blocks (text, thinking, tool_use)
 * - Handles annotations/citations as synthetic tool calls
 * - Normalizes stop_reason based on content type
 * - Formats usage statistics for Anthropic format
 */
export async function formatAnthropicResponse(
  response: UnifiedChatResponse
): Promise<any> {
  const content: any[] = [];

  // Support Annotations/Citations
  // Convert them to synthetic server tool calls for Anthropic format
  if (response.annotations && response.annotations.length > 0) {
    const toolId = `srvtoolu_${Math.random().toString(36).substring(2, 11)}`;
    content.push({
      type: "server_tool_use",
      id: toolId,
      name: "web_search",
      input: { query: "" },
    });
   content.push({
    type: "web_search_tool_result",
      tool_use_id: toolId,
      content: response.annotations.map((a) => ({
        type: "web_search_result",
        url: a.url_citation?.url,
       title: a.url_citation?.title,
      })),
    });
  }

  if (response.reasoning_content) {
    content.push({
      type: "thinking",
      thinking: response.reasoning_content,
    });
  }

  if (response.content) {
    content.push({ type: "text", text: response.content });
  }

  if (response.tool_calls) {
    for (const toolCall of response.tool_calls) {
      let input = {};
      try {
        const argumentsStr = toolCall.function.arguments || "{}";
        input =
          typeof argumentsStr === "object"
            ? argumentsStr
            : JSON.parse(argumentsStr);
      } catch (e) {
        // Robust Tool Argument Parsing: Wrap in safe state if JSON fails
        input = { raw_arguments: toolCall.function.arguments };
      }
      content.push({
      type: "tool_use",
      id: toolCall.id,
        name: toolCall.function.name,
        input,
      });
    }
  }

  // Fix Stop Reason Mapping: Dynamically set stop_reason
  let stop_reason = "end_turn";
  if (response.tool_calls && response.tool_calls.length > 0) {
    stop_reason = "tool_use";
  }

  return {
    id: response.id,
    type: "message",
    role: "assistant",
    model: response.model,
    content,
    stop_reason,
   stop_sequence: null,
    usage: {
      // Usage Token Normalization: input_tokens = prompt_tokens - cached_tokens
      input_tokens:
        (response.usage?.input_tokens || 0) -
        (response.usage?.cached_tokens || 0),
      output_tokens: response.usage?.output_tokens || 0,
      thinkingTokens: response.usage?.reasoning_tokens || 0,
      cache_read_input_tokens: response.usage?.cached_tokens || 0,
      cache_creation_input_tokens: response.usage?.cache_creation_tokens || 0,
    },
  };
}
