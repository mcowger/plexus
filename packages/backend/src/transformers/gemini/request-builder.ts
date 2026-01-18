import { Content, Part, Tool } from "@google/genai";
import { UnifiedChatRequest } from "../../types/unified";
import { convertUnifiedPartsToGemini } from "./part-mapper";

export interface GenerateContentRequest {
  contents: Content[];
  tools?: Tool[];
  toolConfig?: any;
  generationConfig?: {
    temperature?: number;
    maxOutputTokens?: number;
    topP?: number;
    topK?: number;
    stopSequences?: string[];
    responseMimeType?: string;
    thinkingConfig?: {
      includeThoughts?: boolean;
      thinkingBudget?: number;
    };
    [key: string]: any;
  };
  systemInstruction?: Content;
  model?: string;
}

/**
 * Transforms a Unified request into Gemini API format.
 *
 * Key transformations:
 * - Message role normalization (assistant → model, system → user)
 * - Content conversion to Part-based format
 * - Thinking content mapping
 * - Tool call reconstruction
 * - Function response handling
 */
export async function buildGeminiRequest(
  request: UnifiedChatRequest
): Promise<GenerateContentRequest> {
  const contents: Content[] = [];
  const tools: Tool[] = [];

  for (const msg of request.messages) {
    let role = "";
    const parts: Part[] = [];

    if (msg.role === "system") {
      role = "user";
      parts.push({
        text:
          typeof msg.content === "string"
            ? msg.content
            : JSON.stringify(msg.content),
      });
    } else if (msg.role === "user" || msg.role === "assistant") {
      role = msg.role === "assistant" ? "model" : "user";

      if (msg.thinking?.content) {
        // @ts-ignore - Signal to Gemini that this is a thought part
        parts.push({ text: msg.thinking.content, thought: true });
      }

      if (typeof msg.content === "string") {
        const part: any = { text: msg.content };
        if (msg.thinking?.signature && !msg.tool_calls) {
          part.thoughtSignature = msg.thinking.signature;
        }
        parts.push(part);
      } else if (Array.isArray(msg.content)) {
        parts.push(...convertUnifiedPartsToGemini(msg.content));
      }

      if (msg.tool_calls) {
        msg.tool_calls.forEach((tc, index) => {
          const part: any = {
            functionCall: {
              name: tc.function.name,
              args: JSON.parse(tc.function.arguments),
            },
          };
          if (index === 0 && msg.thinking?.signature)
            part.thoughtSignature = msg.thinking.signature;
          parts.push(part);
        });
      }
    } else if (msg.role === "tool") {
      role = "user";
      parts.push({
        functionResponse: {
          name: msg.name || msg.tool_call_id || "unknown_tool",
          response: {
            content:
              typeof msg.content === "string"
                ? msg.content
                : JSON.stringify(msg.content),
          },
        },
      });
    }

    if (role && parts.length > 0) contents.push({ role, parts });
  }

  // Transform Unified tools to Gemini function declarations
  if (request.tools && request.tools.length > 0) {
    tools.push({
      functionDeclarations: request.tools.map((t) => ({
        name: t.function.name,
        description: t.function.description,
        parameters: t.function.parameters as any,
      })),
    });
  }

  const req: GenerateContentRequest = {
    contents,
    tools: tools.length > 0 ? tools : undefined,
    generationConfig: {
      maxOutputTokens: request.max_tokens,
      temperature: request.temperature,
    },
  };

  return req;
}
