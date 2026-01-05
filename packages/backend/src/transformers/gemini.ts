import { Transformer } from "../types/transformer";
import {
  UnifiedChatRequest,
  UnifiedChatResponse,
  UnifiedMessage,
  MessageContent,
} from "../types/unified";
import { logger } from "../utils/logger";
import { Content, Part, Tool, FunctionDeclaration } from "@google/genai";
import { extractGeminiUsage } from "./usage-extractors";
import { createParser, EventSourceMessage } from 'eventsource-parser';
import { encode } from 'eventsource-encoder';

/**
 * GeminiTransformer
 * 
 * Handles transformation between Google Gemini's GenerateContent API and the internal Unified format.
 * Maps Gemini's part-based content system (text, inlineData, functionCall) to Unified messages.
 */
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

export class GeminiTransformer implements Transformer {
  name = "gemini";
  defaultEndpoint = "/v1beta/models/:modelAndAction";

  /**
   * getEndpoint
   * Dynamically constructs the Gemini API URL based on whether streaming is requested.
   */
  getEndpoint(request: UnifiedChatRequest): string {
    const action = request.stream
      ? "streamGenerateContent?alt=sse"
      : "generateContent";
    let model = request.model;
    if (!model.startsWith("models/") && !model.startsWith("tunedModels/")) {
      model = `models/${model}`;
    }
    return `/v1beta/${model}:${action}`;
  }

  /**
   * parseRequest (Client -> Unified)
   * Maps Gemini's complex structure (contents array, generationConfig) to Unified format.
   */
  async parseRequest(input: any): Promise<UnifiedChatRequest> {
    const contents: Content[] = input.contents || [];
    const tools: any[] = input.tools || [];
    const model: string = input.model || "";
    const generationConfig = input.generationConfig || {};

    const unifiedChatRequest: UnifiedChatRequest = {
      messages: [],
      model,
      max_tokens: generationConfig.maxOutputTokens,
      temperature: generationConfig.temperature,
      stream: false, 
      tool_choice: undefined,
    };

    if (input.stream) {
      unifiedChatRequest.stream = true;
    }

    // Map response format
    if (generationConfig.responseMimeType === "application/json") {
      unifiedChatRequest.response_format = {
        type: generationConfig.responseJsonSchema
          ? "json_schema"
          : "json_object",
        json_schema: generationConfig.responseJsonSchema,
      };
    }

    // Map thinking config
    if (generationConfig.thinkingConfig) {
      unifiedChatRequest.reasoning = {
        enabled: generationConfig.thinkingConfig.includeThoughts,
        max_tokens: generationConfig.thinkingConfig.thinkingBudget,
      };
    }

    // Map Gemini Contents to Unified Messages
    if (Array.isArray(contents)) {
      contents.forEach((content) => {
        const role =
          content.role === "model"
            ? "assistant"
            : "user"; 

        if (content.parts) {
          const message: UnifiedMessage = {
            role: role as "user" | "assistant" | "system",
            content: [],
          };

          const contentParts: MessageContent[] = [];
          
          content.parts.forEach((part) => {
            if (part.text) {
              // @ts-ignore - Check for internal 'thought' flag used by some Gemini versions
              if (part.thought) {
                if (!message.thinking) message.thinking = { content: "" };
                message.thinking.content += part.text;
                // @ts-ignore
                if (part.thoughtSignature) {
                  message.thinking.signature = part.thoughtSignature;
                }
              } else {
                contentParts.push({ type: "text", text: part.text });
              }
            } else if (part.inlineData) {
              contentParts.push({
                type: "image_url",
                image_url: {
                  url: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`,
                },
                media_type: part.inlineData.mimeType,
              });
            } else if (part.fileData) {
              contentParts.push({
                type: "image_url",
                image_url: {
                  url: part.fileData.fileUri || "",
                },
                media_type: part.fileData.mimeType,
              });
            } else if (part.functionCall) {
              if (!message.tool_calls) message.tool_calls = [];
              message.tool_calls.push({
                id: part.functionCall.name || "call_" + Math.random().toString(36).substring(7),
                type: "function",
                function: {
                  name: part.functionCall.name || "unknown",
                  arguments: JSON.stringify(part.functionCall.args),
                },
              });
            }
          });

          // Simplify content structure if it's just text
          const firstPart = contentParts[0];
          if (contentParts.length === 1 && firstPart?.type === "text") {
            message.content = firstPart.text;
          } else if (contentParts.length > 0) {
            message.content = contentParts;
          } else {
            message.content = null;
          }

          // Handle Gemini's functionResponse (mapping to 'tool' role)
          const functionResponses = content.parts.filter(p => p.functionResponse);
          if (functionResponses.length > 0) {
            functionResponses.forEach((fr) => {
              unifiedChatRequest.messages.push({
                role: "tool",
                content: JSON.stringify(fr.functionResponse?.response),
                tool_call_id: fr.functionResponse?.name || "unknown_tool",
                name: fr.functionResponse?.name,
              });
            });
            if (contentParts.length > 0) unifiedChatRequest.messages.push(message);
          } else {
            unifiedChatRequest.messages.push(message);
          }
        }
      });
    }

    return unifiedChatRequest;
  }

  /**
   * transformRequest (Unified -> Provider)
   */
  async transformRequest(request: UnifiedChatRequest): Promise<GenerateContentRequest> {
    const contents: Content[] = [];
    const tools: Tool[] = [];

    for (const msg of request.messages) {
      let role = "";
      const parts: Part[] = [];

      if (msg.role === "system") {
        role = "user";
        parts.push({ text: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content) });
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
          msg.content.forEach((c) => {
            if (c.type === "text") {
              parts.push({ text: c.text });
            } else if (c.type === "image_url") {
              if (c.image_url.url.startsWith("data:")) {
                const [meta, data] = c.image_url.url.split(",");
                parts.push({ inlineData: { mimeType: "image/jpeg", data: data || "" } });
              } else {
                parts.push({ fileData: { mimeType: c.media_type || "image/jpeg", fileUri: c.image_url.url } });
              }
            }
          });
        }

        if (msg.tool_calls) {
          msg.tool_calls.forEach((tc, index) => {
            const part: any = { functionCall: { name: tc.function.name, args: JSON.parse(tc.function.arguments) } };
            if (index === 0 && msg.thinking?.signature) part.thoughtSignature = msg.thinking.signature;
            parts.push(part);
          });
        }
      } else if (msg.role === "tool") {
        role = "user";
        parts.push({
          functionResponse: {
            name: msg.name || msg.tool_call_id || "unknown_tool",
            response: { content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content) },
          },
        });
      }

      if (role && parts.length > 0) contents.push({ role, parts });
    }

    // Transform Unified tools to Gemini function declarations
    if (request.tools && request.tools.length > 0) {
      tools.push({ functionDeclarations: request.tools.map(t => ({
        name: t.function.name,
        description: t.function.description,
        parameters: t.function.parameters as any,
      })) });
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

  /**
   * transformResponse (Provider -> Unified)
   */
  async transformResponse(response: any): Promise<UnifiedChatResponse> {
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
          id: part.functionCall.name || "call_" + Math.random().toString(36).substring(7),
          type: "function",
          function: { name: part.functionCall.name, arguments: JSON.stringify(part.functionCall.args) },
        });
      }
      if (part.thoughtSignature) thoughtSignature = part.thoughtSignature;
    });

    const usage = response.usageMetadata ? {
      input_tokens: response.usageMetadata.promptTokenCount || 0,
      output_tokens: response.usageMetadata.candidatesTokenCount || 0,
      total_tokens: response.usageMetadata.totalTokenCount || 0,
      reasoning_tokens: response.usageMetadata.thoughtsTokenCount || 0,
      cached_tokens: response.usageMetadata.cachedContentTokenCount || 0,
      cache_creation_tokens: 0,
    } : undefined;

    return {
      id: response.responseId || "gemini-" + Date.now(),
      model: response.modelVersion || "gemini-model",
      content: content || null,
      reasoning_content: reasoning_content || null,
      thinking: thoughtSignature ? { content: reasoning_content, signature: thoughtSignature } : undefined,
      tool_calls: tool_calls.length > 0 ? tool_calls : undefined,
      usage,
    };
  }

  /**
   * formatResponse (Unified -> Client)
   */
  async formatResponse(response: UnifiedChatResponse): Promise<any> {
    const parts: Part[] = [];
    if (response.reasoning_content) {
      const part: any = { text: response.reasoning_content, thought: true };
      if (response.thinking?.signature) part.thoughtSignature = response.thinking.signature;
      parts.push(part);
    }
    if (response.content) parts.push({ text: response.content });
    if (response.tool_calls) {
      response.tool_calls.forEach((tc, index) => {
        const part: any = { functionCall: { name: tc.function.name, args: JSON.parse(tc.function.arguments) } };
        if (index === 0 && response.thinking?.signature && !response.reasoning_content) {
          part.thoughtSignature = response.thinking.signature;
        }
        parts.push(part);
      });
    }

    return {
      candidates: [{ content: { role: "model", parts }, finishReason: "STOP", index: 0 }],
      usageMetadata: response.usage ? {
        promptTokenCount: response.usage.input_tokens,
        candidatesTokenCount: response.usage.output_tokens,
        totalTokenCount: response.usage.total_tokens,
        thoughtsTokenCount: response.usage.reasoning_tokens,
      } : undefined,
      modelVersion: response.model,
    };
  }

  /**
   * transformStream (Provider Stream -> Unified Stream)
   * Robustly parses Gemini's SSE format using eventsource-parser.
   */
  transformStream(stream: ReadableStream): ReadableStream {
    const decoder = new TextDecoder();
    let parser: any;

    const transformer = new TransformStream({
      start(controller) {
          parser = createParser({
              onEvent: (event: EventSourceMessage) => {
                  if (event.data === '[DONE]') return;
                  try {
                      const data = JSON.parse(event.data);
                      const candidate = data.candidates?.[0];
                      if (!candidate) return;

                      const parts = candidate.content?.parts || [];

                      for (const part of parts) {
                          if (part.text) {
                              const chunk = {
                                  id: data.responseId,
                                  model: data.modelVersion,
                                  delta: {
                                      role: "assistant",
                                      reasoning_content: part.thought ? part.text : undefined,
                                      content: part.thought ? undefined : part.text,
                                  },
                              };
                              logger.silly(`Gemini Transformer: Enqueueing unified chunk (text)`, chunk);
                              controller.enqueue(chunk);
                          }
                          if (part.functionCall) {
                              const chunk = {
                                  id: data.responseId,
                                  model: data.modelVersion,
                                  delta: {
                                      role: "assistant",
                                      tool_calls: [{
                                          id: part.functionCall.name,
                                          type: "function",
                                          function: { name: part.functionCall.name, arguments: JSON.stringify(part.functionCall.args) },
                                      }],
                                  },
                              };
                              logger.silly(`Gemini Transformer: Enqueueing unified chunk (tool)`, chunk);
                              controller.enqueue(chunk);
                          }
                      }

                      if (candidate.finishReason) {
                          const chunk = {
                              id: data.responseId,
                              model: data.modelVersion,
                              finish_reason: candidate.finishReason.toLowerCase(),
                              usage: data.usageMetadata ? {
                                  input_tokens: data.usageMetadata.promptTokenCount,
                                  output_tokens: data.usageMetadata.candidatesTokenCount,
                                  total_tokens: data.usageMetadata.totalTokenCount,
                                  reasoning_tokens: data.usageMetadata.thoughtsTokenCount,
                                  cached_tokens: data.usageMetadata.cachedContentTokenCount,
                              } : undefined,
                          };
                          logger.silly(`Gemini Transformer: Enqueueing unified chunk (finish)`, chunk);
                          controller.enqueue(chunk);
                      }

                  } catch (e) {
                      logger.error("Error parsing Gemini stream chunk", e);
                  }
              }
          });
      },
      transform(chunk, controller) {
        const text = typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
        parser.feed(text);
      },
    });

    return stream.pipeThrough(transformer);
  }

  /**
   * formatStream (Unified Stream -> Client Stream)
   */
  formatStream(stream: ReadableStream): ReadableStream {
    const encoder = new TextEncoder();

    const transformer = new TransformStream({
      transform(chunk: any, controller) {
        const parts: Part[] = [];
        if (chunk.delta?.content) parts.push({ text: chunk.delta.content });
        if (chunk.delta?.reasoning_content) parts.push({ text: chunk.delta.reasoning_content, thought: true } as any);
        if (chunk.delta?.tool_calls) {
          chunk.delta.tool_calls.forEach((tc: any) => {
            parts.push({ functionCall: { name: tc.function.name, args: JSON.parse(tc.function.arguments || "{}") } });
          });
        }

        if (parts.length > 0 || chunk.finish_reason) {
          const geminiChunk = {
            candidates: [{ content: { role: "model", parts }, finishReason: chunk.finish_reason?.toUpperCase() || null, index: 0 }],
            usageMetadata: chunk.usage ? {
              promptTokenCount: chunk.usage.input_tokens,
              candidatesTokenCount: chunk.usage.output_tokens,
              totalTokenCount: chunk.usage.total_tokens,
              thoughtsTokenCount: chunk.usage.reasoning_tokens,
            } : undefined,
          };
          const sseMessage = encode({ data: JSON.stringify(geminiChunk) });
          controller.enqueue(encoder.encode(sseMessage));
        }
      },
    });

    return stream.pipeThrough(transformer);
  }

  extractUsage(input: string) {
    return extractGeminiUsage(input);
  }
}
