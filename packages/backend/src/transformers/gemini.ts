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
  getEndpoint(request: UnifiedChatRequest): string {
    const action = request.stream
      ? "streamGenerateContent?alt=sse"
      : "generateContent";
    // Map model name: ensure it doesn't have 'models/' prefix if already there, or add it
    let model = request.model;
    if (!model.startsWith("models/") && !model.startsWith("tunedModels/")) {
      model = `models/${model}`;
    }
    return `/v1beta/${model}:${action}`;
  }

  // --- 1. Client (Gemini format) -> Unified ---
  async parseRequest(input: any): Promise<UnifiedChatRequest> {
    // Input is expected to be a Gemini GenerateContentRequest-like object
    const contents: Content[] = input.contents || [];
    const tools: any[] = input.tools || [];
    const model: string = input.model || "";
    const generationConfig = input.generationConfig || {};

    const unifiedChatRequest: UnifiedChatRequest = {
      messages: [],
      model,
      max_tokens: generationConfig.maxOutputTokens,
      temperature: generationConfig.temperature,
      stream: false, // Default, usually controlled by endpoint/header in Gemini but input might have it
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

    // Map Contents to Messages
    if (Array.isArray(contents)) {
      contents.forEach((content) => {
        const role =
          content.role === "model"
            ? "assistant"
            : content.role === "user"
            ? "user"
            : "user"; // Default to user

        if (content.parts) {
          const message: UnifiedMessage = {
            role: role as "user" | "assistant" | "system",
            content: [],
          };

          const contentParts: MessageContent[] = [];
          let textContent = "";

          content.parts.forEach((part) => {
            if (part.text) {
              // @ts-ignore - thought property exists on Part in newer SDK versions or raw JSON
              if (part.thought) {
                if (!message.thinking) message.thinking = { content: "" };
                message.thinking.content += part.text;
                // @ts-ignore - thoughtSignature
                if (part.thoughtSignature) {
                  message.thinking.signature = part.thoughtSignature;
                }
              } else {
                contentParts.push({ type: "text", text: part.text });
                textContent += part.text;
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
                id:
                  part.functionCall.name ||
                  "call_" + Math.random().toString(36).substring(7),
                type: "function",
                function: {
                  name: part.functionCall.name || "unknown",
                  arguments: JSON.stringify(part.functionCall.args),
                },
              });
              // Check for thoughtSignature on functionCall part
              // @ts-ignore - thoughtSignature
              if (part.thoughtSignature && !message.thinking?.signature) {
                if (!message.thinking) message.thinking = { content: "" }; // Content might be empty if just signature
                message.thinking.signature = part.thoughtSignature;
              }
            }
          });

          // Simplify content if just text
          const firstPart = contentParts[0];
          if (contentParts.length === 1 && firstPart?.type === "text") {
            message.content = firstPart.text;
          } else if (contentParts.length > 0) {
            message.content = contentParts;
          } else {
            message.content = null;
          }

          // Handle special case where role might need to be 'tool' for functionResponse
          const functionResponses = content.parts.filter(
            (p) => p.functionResponse
          );
          if (functionResponses.length > 0) {
            functionResponses.forEach((fr) => {
              unifiedChatRequest.messages.push({
                role: "tool",
                content: JSON.stringify(fr.functionResponse?.response),
                tool_call_id: fr.functionResponse?.name || "unknown_tool",
                name: fr.functionResponse?.name,
              });
            });
            // If there were other parts, we might need to push them as a separate user message
            if (contentParts.length > 0) {
              unifiedChatRequest.messages.push(message);
            }
          } else {
            unifiedChatRequest.messages.push(message);
          }
        }
      });
    }

    // Map Tools
    if (Array.isArray(tools)) {
      unifiedChatRequest.tools = [];
      tools.forEach((tool) => {
        const functions =
          tool.functionDeclarations || tool.function_declarations;
        if (functions) {
          functions.forEach((fd: any) => {
            unifiedChatRequest.tools!.push({
              type: "function",
              function: {
                name: fd.name || "unknown_function",
                description: fd.description,
                parameters: fd.parameters as any, // Schema types compatibility
              },
            });
          });
        }
      });
    }

    // Map Tool Config
    const toolConfig = input.toolConfig || input.tool_config;
    if (toolConfig) {
      const fcConfig =
        toolConfig.functionCallingConfig || toolConfig.function_calling_config;
      if (fcConfig) {
        const mode = fcConfig.mode;
        if (mode === "AUTO") unifiedChatRequest.tool_choice = "auto";
        else if (mode === "NONE") unifiedChatRequest.tool_choice = "none";
        else if (mode === "ANY") unifiedChatRequest.tool_choice = "required";
      }
    }

    return unifiedChatRequest;
  }

  // --- 2. Unified -> Provider (Gemini format) ---
  async transformRequest(
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
          // @ts-ignore - thought property
          parts.push({ text: msg.thinking.content, thought: true });
        }

        if (typeof msg.content === "string") {
          const part: any = { text: msg.content };
          // Attach signature to text part if present and no tool calls (or first part)
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
                let mimeType = "image/jpeg";
                if (meta) {
                  const metaParts = meta.split(":");
                  if (metaParts.length > 1) {
                    const typePart = metaParts[1];
                    if (typePart) {
                      mimeType = typePart.split(";")[0] || "image/jpeg";
                    }
                  }
                }
                parts.push({
                  inlineData: {
                    mimeType: mimeType,
                    data: data || "",
                  },
                });
              } else {
                parts.push({
                  fileData: {
                    mimeType: c.media_type || "image/jpeg", // Fallback
                    fileUri: c.image_url.url,
                  },
                });
              }
            }
          });
        }

        if (msg.tool_calls) {
          msg.tool_calls.forEach((tc, index) => {
            const part: any = {
              functionCall: {
                name: tc.function.name,
                args: JSON.parse(tc.function.arguments),
              },
            };
            // Attach signature to first function call if present
            if (index === 0 && msg.thinking?.signature) {
              part.thoughtSignature = msg.thinking.signature;
            }
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

      if (role && parts.length > 0) {
        contents.push({ role, parts });
      }
    }

    // Transform Tools
    if (request.tools && request.tools.length > 0) {
      const functionDeclarations: FunctionDeclaration[] = request.tools.map(
        (t) => ({
          name: t.function.name,
          description: t.function.description,
          parameters: t.function.parameters as any, // Schema compatibility
        })
      );

      tools.push({ functionDeclarations });
    }

    const req: GenerateContentRequest = {
      contents,
      tools: tools.length > 0 ? tools : undefined,
      generationConfig: {
        maxOutputTokens: request.max_tokens,
        temperature: request.temperature,
      },
    };

    // Transform Response Format (JSON/Schema)
    if (request.response_format) {
      if (
        request.response_format.type === "json_object" ||
        request.response_format.type === "json_schema"
      ) {
        req.generationConfig!.responseMimeType = "application/json";
        if (request.response_format.json_schema) {
          req.generationConfig!.responseJsonSchema =
            request.response_format.json_schema;
        }
      }
    }

    // Transform Thinking Config
    if (request.reasoning?.enabled) {
      if (!req.generationConfig!.thinkingConfig) {
        req.generationConfig!.thinkingConfig = {};
      }
      req.generationConfig!.thinkingConfig.includeThoughts = true;
      if (request.reasoning.max_tokens) {
        req.generationConfig!.thinkingConfig.thinkingBudget =
          request.reasoning.max_tokens;
      }
    }

    // Transform Tool Config
    if (request.tool_choice) {
      const toolConfig: any = { functionCallingConfig: {} };
      if (request.tool_choice === "auto") {
        toolConfig.functionCallingConfig.mode = "AUTO";
      } else if (request.tool_choice === "none") {
        toolConfig.functionCallingConfig.mode = "NONE";
      } else if (request.tool_choice === "required") {
        toolConfig.functionCallingConfig.mode = "ANY";
      } else if (
        typeof request.tool_choice === "object" &&
        request.tool_choice.type === "function"
      ) {
        toolConfig.functionCallingConfig.mode = "ANY";
        toolConfig.functionCallingConfig.allowedFunctionNames = [
          request.tool_choice.function.name,
        ];
      }

      if (toolConfig.functionCallingConfig.mode) {
        req.toolConfig = toolConfig;
      }
    }

    return req;
  }

  // --- 3. Provider (Gemini format) -> Unified ---
  async transformResponse(response: any): Promise<UnifiedChatResponse> {
    // response is expected to be the raw JSON body from Gemini API
    // It has structure { candidates: [...], usageMetadata: ... }

    const candidate = response.candidates?.[0];
    const parts = candidate?.content?.parts || [];

    let content = "";
    let reasoning_content = "";
    const tool_calls: any[] = [];
    let thoughtSignature: string | undefined;

    parts.forEach((part: any) => {
      if (part.text) {
        if (part.thought === true) {
          reasoning_content += part.text;
        } else {
          content += part.text;
        }
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

      // Capture signature
      if (part.thoughtSignature) {
        thoughtSignature = part.thoughtSignature;
      }
    });

    // Check for usage
    let text_tokens = 0;
    let image_tokens = 0;
    let audio_tokens = 0;

    if (response.usageMetadata?.promptTokensDetails) {
      response.usageMetadata.promptTokensDetails.forEach((detail: any) => {
        if (detail.modality === "TEXT") text_tokens += detail.tokenCount;
        if (detail.modality === "IMAGE") image_tokens += detail.tokenCount;
        if (detail.modality === "AUDIO") audio_tokens += detail.tokenCount;
      });
    }

    const promptTokenCount = response.usageMetadata?.promptTokenCount || 0;
    const candidatesTokenCount =
      response.usageMetadata?.candidatesTokenCount || 0;
    const totalTokenCount = response.usageMetadata?.totalTokenCount || 0;
    const thoughtsTokenCount = response.usageMetadata?.thoughtsTokenCount || 0;
    const cachedContentTokenCount =
      response.usageMetadata?.cachedContentTokenCount || 0;

    const usage = response.usageMetadata
      ? {
          input_tokens: promptTokenCount,
          output_tokens: candidatesTokenCount,
          total_tokens: totalTokenCount,
          reasoning_tokens: thoughtsTokenCount,
          cached_tokens: cachedContentTokenCount,
          cache_creation_tokens: 0,
        }
      : undefined;

    return {
      id: response.responseId || "gemini-" + Date.now(),
      model: response.modelVersion || "gemini-model",
      content: content || null,
      reasoning_content: reasoning_content || null,
      thinking: thoughtSignature
        ? {
            content: reasoning_content,
            signature: thoughtSignature,
          }
        : undefined,
      tool_calls: tool_calls.length > 0 ? tool_calls : undefined,
      usage,
    };
  }

  // --- 4. Unified -> Client (Gemini format) ---
  async formatResponse(response: UnifiedChatResponse): Promise<any> {
    // Convert Unified response back to Gemini JSON format
    const parts: Part[] = [];

    if (response.reasoning_content) {
      const part: any = { text: response.reasoning_content, thought: true };
      if (response.thinking?.signature) {
        part.thoughtSignature = response.thinking.signature;
      }
      parts.push(part);
    }

    if (response.content) {
      parts.push({ text: response.content });
    }

    if (response.tool_calls) {
      response.tool_calls.forEach((tc, index) => {
        const part: any = {
          functionCall: {
            name: tc.function.name,
            args: JSON.parse(tc.function.arguments),
          },
        };
        // If signature wasn't on reasoning part (e.g. absent), maybe attach to first tool call?
        // But usually it goes with thought part or first content part or first tool part.
        // If we already added it to reasoning part, don't duplicate?
        // The API seems to accept it on functionCall too.
        if (
          index === 0 &&
          response.thinking?.signature &&
          !response.reasoning_content
        ) {
          part.thoughtSignature = response.thinking.signature;
        }
        parts.push(part);
      });
    }

    return {
      candidates: [
        {
          content: {
            role: "model",
            parts,
          },
          finishReason: response.tool_calls ? "STOP" : "STOP", // Simplified
          index: 0,
        },
      ],
      usageMetadata: response.usage
        ? {
            promptTokenCount: response.usage.input_tokens,
            candidatesTokenCount: response.usage.output_tokens,
            totalTokenCount: response.usage.total_tokens,
            promptTokensDetails: [
              { modality: "TEXT", tokenCount: response.usage.input_tokens },
            ],
            thoughtsTokenCount: response.usage.reasoning_tokens,
          }
        : undefined,
      modelVersion: response.model,
    };
  }

  // --- 5. Provider Stream (Gemini SSE) -> Unified Stream ---
  transformStream(stream: ReadableStream): ReadableStream {
    const decoder = new TextDecoder();
    let buffer = "";

    // Use TransformStream for proper backpressure handling
    const transformer = new TransformStream({
      transform(chunk, controller) {
        const text =
          typeof chunk === "string"
            ? chunk
            : decoder.decode(chunk, { stream: true });
        buffer += text;
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmedLine = line.trim();
          if (!trimmedLine || !trimmedLine.startsWith("data:")) continue;

          const dataStr = trimmedLine.slice(5).trim();
          if (dataStr === "[DONE]") continue;

          try {
            const data = JSON.parse(dataStr);
            const candidate = data.candidates?.[0];
            if (!candidate) continue;

            const parts = candidate.content?.parts || [];

            // Handle parts
            for (const part of parts) {
              if (part.text) {
                if (part.thought) {
                  controller.enqueue({
                    id: data.responseId,
                    model: data.modelVersion,
                    delta: {
                      role: "assistant",
                      reasoning_content: part.text,
                    },
                  });
                } else {
                  controller.enqueue({
                    id: data.responseId,
                    model: data.modelVersion,
                    delta: {
                      role: "assistant",
                      content: part.text,
                    },
                  });
                }
              }

              if (part.functionCall) {
                controller.enqueue({
                  id: data.responseId,
                  model: data.modelVersion,
                  delta: {
                    role: "assistant",
                    tool_calls: [
                      {
                        id: part.functionCall.name,
                        type: "function",
                        function: {
                          name: part.functionCall.name,
                          arguments: JSON.stringify(part.functionCall.args),
                        },
                      },
                    ],
                  },
                });
              }
            }

            if (candidate.finishReason) {
              const promptTokenCount =
                data.usageMetadata?.promptTokenCount || 0;
              const candidatesTokenCount =
                data.usageMetadata?.candidatesTokenCount || 0;
              const totalTokenCount = data.usageMetadata?.totalTokenCount || 0;
              const thoughtsTokenCount =
                data.usageMetadata?.thoughtsTokenCount || 0;
              const cachedContentTokenCount =
                data.usageMetadata?.cachedContentTokenCount || 0;

              controller.enqueue({
                id: data.responseId,
                model: data.modelVersion,
                finish_reason: candidate.finishReason.toLowerCase(),
                usage: data.usageMetadata
                  ? {
                      input_tokens: promptTokenCount,
                      output_tokens: candidatesTokenCount,
                      total_tokens: totalTokenCount,
                      reasoning_tokens: thoughtsTokenCount,
                      cached_tokens: cachedContentTokenCount,
                      cache_creation_tokens: 0,
                    }
                  : undefined,
              });
            }
          } catch (e) {
            logger.error("Error parsing Gemini stream chunk", e);
          }
        }
      },
    });

    return stream.pipeThrough(transformer);
  }

  // --- 6. Unified Stream -> Client Stream (Gemini SSE) ---
  formatStream(stream: ReadableStream): ReadableStream {
    const encoder = new TextEncoder();

    // Use TransformStream for proper backpressure handling
    const transformer = new TransformStream({
      transform(chunk: any, controller) {
        const parts: Part[] = [];

        if (chunk.delta?.content) {
          parts.push({ text: chunk.delta.content });
        }
        if (chunk.delta?.reasoning_content) {
          parts.push({
            text: chunk.delta.reasoning_content,
            thought: true,
          } as any);
        }
        if (chunk.delta?.tool_calls) {
          chunk.delta.tool_calls.forEach((tc: any) => {
            parts.push({
              functionCall: {
                name: tc.function.name,
                args: JSON.parse(tc.function.arguments || "{}"),
              },
            });
          });
        }

        if (parts.length > 0 || chunk.finish_reason) {
          const geminiChunk = {
            candidates: [
              {
                content: {
                  role: "model",
                  parts,
                },
                finishReason: chunk.finish_reason?.toUpperCase() || null,
                index: 0,
              },
            ],
            usageMetadata: chunk.usage
              ? {
                  promptTokenCount: chunk.usage.input_tokens,
                  candidatesTokenCount: chunk.usage.output_tokens,
                  totalTokenCount: chunk.usage.total_tokens,
                  promptTokensDetails: [
                    { modality: "TEXT", tokenCount: chunk.usage.input_tokens },
                  ],
                  thoughtsTokenCount: chunk.usage.reasoning_tokens,
                }
              : undefined,
          };
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(geminiChunk)}\n\n`)
          );
        }
      },
    });

    return stream.pipeThrough(transformer);
  }

  // --- 7. Extract usage from raw SSE chunk ---
  extractUsage(input: string) {
    return extractGeminiUsage(input);
  }
}
