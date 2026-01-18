import { UnifiedChatRequest } from "../../types/unified";
import { convertUnifiedToolsToAnthropic } from "./tool-mapper";

/**
 * Transforms a Unified request into Anthropic API format.
 *
 * Key transformations:
 * - System message extraction
 * - Message role normalization (tool -> user)
 * - Tool call reconstruction from unified format
 * - Message merging (consecutive messages with same role)
 */
export async function buildAnthropicRequest(
  request: UnifiedChatRequest
): Promise<any> {
  let system: string | undefined;
  const messages: any[] = [];

  for (const msg of request.messages) {
    if (msg.role === "system") {
      system =
        typeof msg.content === "string"
          ? msg.content
          : JSON.stringify(msg.content);
    } else if (msg.role === "user" || msg.role === "assistant") {
      const content: any[] = [];

      if (msg.thinking) {
        content.push({
          type: "thinking",
          thinking: msg.thinking.content,
          signature: msg.thinking.signature,
        });
   }

      if (msg.content) {
        if (typeof msg.content === "string") {
          content.push({ type: "text", text: msg.content });
        } else if (Array.isArray(msg.content)) {
          for (const part of msg.content) {
            if (part.type === "text") {
       content.push({ type: "text", text: part.text });
            } else if (part.type === "image_url") {
          content.push({
                type: "image",
                source: {
              type: "base64",
                  media_type: part.media_type || "image/jpeg",
                  data: "",
                },
              });
        }
          }
        }
      }

      if (msg.role === "assistant" && msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          content.push({
            type: "tool_use",
         id: tc.id,
            name: tc.function.name,
            input: JSON.parse(tc.function.arguments),
          });
        }
      }

      messages.push({ role: msg.role, content });
    } else if (msg.role === "tool") {
      messages.push({
        role: "user",
        content: [
          {
          type: "tool_result",
            tool_use_id: msg.tool_call_id,
       content:
              typeof msg.content === "string"
         ? msg.content
              : JSON.stringify(msg.content),
          },
        ],
      });
    }
  }

  // Merge consecutive messages of the same role
  // This is required by Anthropic API: can't have consecutive user or assistant messages
  const mergedMessages: any[] = [];
  for (const msg of messages) {
    if (mergedMessages.length > 0) {
      const last = mergedMessages[mergedMessages.length - 1];
      if (last.role === msg.role) {
        last.content.push(...msg.content);
        continue;
      }
    }
    mergedMessages.push(msg);
  }

  const payload: any = {
    model: request.model,
    messages: mergedMessages,
    system: system,
    max_tokens: request.max_tokens || 4096,
    temperature: request.temperature,
    stream: request.stream,
    tools: request.tools
      ? convertUnifiedToolsToAnthropic(request.tools)
      : undefined,
  };

  return payload;
}
