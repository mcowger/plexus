import { Transformer, UnifiedChatRequest, UnifiedChatResponse, UnifiedMessage, MessageContent, UnifiedUsage, ReconstructedChatResponse, ReconstructedMessagesResponse, AnthropicContentBlock, ImageOutput } from "./types";
import { logger } from "../utils/logger";
import { Content, Part, Tool } from "@google/genai";
import { createParser, EventSourceMessage } from "eventsource-parser";
import { encode } from "eventsource-encoder";

/**
 * GeminiTransformer
 *
 * Handles transformation between Google Gemini's GenerateContent API and the internal Unified format.
 * Maps Gemini's part-based content system (text, inlineData, functionCall) to Unified messages.
 */

/** Safety setting for Gemini API */
export interface SafetySetting {
  category: string;
  threshold: string;
}

/** Default permissive safety settings - all categories set to BLOCK_NONE */
const DEFAULT_SAFETY_SETTINGS: SafetySetting[] = [
  { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_CIVIC_INTEGRITY", threshold: "BLOCK_NONE" },
];

/** Constant for bypassing thought signature validation */
const SKIP_THOUGHT_SIGNATURE_VALIDATOR = "skip_thought_signature_validator";

/** Atomic counter for generating unique function call IDs */
let functionCallIdCounter = 0;

/**
 * Generates a unique function call ID
 * Format: {functionName}_{timestamp}_{counter}
 */
function generateFunctionCallId(functionName: string): string {
  const timestamp = Date.now();
  const counter = ++functionCallIdCounter;
  return `${functionName}_${timestamp}_${counter}`;
}

export interface GenerateContentRequest {
  contents: Content[];
  tools?: Tool[];
  toolConfig?: {
    functionCallingConfig?: {
      mode?: "AUTO" | "NONE" | "ANY";
      allowedFunctionNames?: string[];
    };
  };
  generationConfig?: {
    temperature?: number;
    maxOutputTokens?: number;
    topP?: number;
    topK?: number;
    stopSequences?: string[];
    responseMimeType?: string;
    responseJsonSchema?: any;
    responseModalities?: string[];
    thinkingConfig?: {
      includeThoughts?: boolean;
      thinkingBudget?: number;
    };
    imageConfig?: {
      aspectRatio?: string;
    };
    [key: string]: any;
  };
  systemInstruction?: Content;
  safetySettings?: SafetySetting[];
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
      top_p: generationConfig.topP,
      stop: generationConfig.stopSequences,
      stream: false,
      tool_choice: undefined,
    };

    if (input.stream) {
      unifiedChatRequest.stream = true;
    }

    // Map toolConfig to tool_choice
    if (input.toolConfig?.functionCallingConfig) {
      const fcc = input.toolConfig.functionCallingConfig;
      if (fcc.mode === "NONE") {
        unifiedChatRequest.tool_choice = "none";
      } else if (fcc.mode === "AUTO") {
        unifiedChatRequest.tool_choice = "auto";
      } else if (fcc.mode === "ANY") {
        // Check if specific function is targeted
        if (fcc.allowedFunctionNames?.length === 1) {
          unifiedChatRequest.tool_choice = {
            type: "function",
            function: { name: fcc.allowedFunctionNames[0] },
          };
        } else {
          unifiedChatRequest.tool_choice = "required";
        }
      }
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
        const role = content.role === "model" ? "assistant" : "user";

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
              const functionName = part.functionCall.name || "unknown";
              message.tool_calls.push({
                id: generateFunctionCallId(functionName),
                type: "function",
                function: {
                  name: functionName,
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
            if (contentParts.length > 0)
              unifiedChatRequest.messages.push(message);
          } else {
            unifiedChatRequest.messages.push(message);
          }
        }
      });
    }

    return unifiedChatRequest;
  }

  parseUsage(input: any): UnifiedUsage {
    if (!input) {
      return {
        input_tokens: 0,
        output_tokens: 0,
        total_tokens: 0,
      };
    }

    return {
      input_tokens: input.promptTokenCount || 0,
      output_tokens: input.candidatesTokenCount || 0,
      total_tokens: input.totalTokenCount || 0,
      reasoning_tokens: input.thoughtsTokenCount || 0,
      cache_read_tokens: input.cachedContentTokenCount || 0,
      cache_creation_tokens: 0,
    };
  }

  formatUsage(usage: UnifiedUsage): any {
    return {
      promptTokenCount: usage.input_tokens,
      candidatesTokenCount: usage.output_tokens,
      totalTokenCount: usage.total_tokens,
      thoughtsTokenCount: usage.reasoning_tokens,
      cachedContentTokenCount: usage.cache_read_tokens,
    };
  }

  /**
   * transformRequest (Unified -> Provider)
   */
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
                // Extract MIME type from data URL (format: data:mime/type;base64,...)
                const mimeTypeMatch = meta?.match(/^data:([^;]+)/);
                const mimeType = mimeTypeMatch?.[1] || c.media_type || "image/jpeg";
                const part: any = {
                  inlineData: { mimeType, data: data || "" },
                };
                // Skip thought signature validation for inline images
                part.thoughtSignature = SKIP_THOUGHT_SIGNATURE_VALIDATOR;
                parts.push(part);
              } else {
                const part: any = {
                  fileData: {
                    mimeType: c.media_type || "image/jpeg",
                    fileUri: c.image_url.url,
                  },
                };
                // Skip thought signature validation for file data
                part.thoughtSignature = SKIP_THOUGHT_SIGNATURE_VALIDATOR;
                parts.push(part);
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
            // Apply thought signature or skip validator for function calls
            if (index === 0 && msg.thinking?.signature) {
              part.thoughtSignature = msg.thinking.signature;
            } else {
              // Function calls without signatures should skip validation
              part.thoughtSignature = SKIP_THOUGHT_SIGNATURE_VALIDATOR;
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

      if (role && parts.length > 0) contents.push({ role, parts });
    }

    // Transform Unified tools to Gemini function declarations
    if (request.tools && request.tools.length > 0) {
      const functionDeclarations: Array<{
        name: string;
        description?: string;
        parameters?: any;
      }> = [];
      
      for (const t of request.tools) {
        // Handle Google Search tool passthrough
        if (t.function.name === "google_search" || t.function.name === "googleSearch") {
          tools.push({ googleSearch: {} } as any);
        } else {
          functionDeclarations.push({
            name: t.function.name,
            description: t.function.description,
            parameters: t.function.parameters as any,
          });
        }
      }
      
      if (functionDeclarations.length > 0) {
        tools.push({ functionDeclarations });
      }
    }

    // Log info for unsupported parameters
    if (request.presence_penalty !== undefined) {
      logger.info("Gemini does not support presence_penalty parameter, ignoring", {
        presence_penalty: request.presence_penalty,
      });
    }
    if (request.frequency_penalty !== undefined) {
      logger.info("Gemini does not support frequency_penalty parameter, ignoring", {
        frequency_penalty: request.frequency_penalty,
      });
    }

    const req: GenerateContentRequest = {
      contents,
      tools: tools.length > 0 ? tools : undefined,
      generationConfig: {
        maxOutputTokens: request.max_tokens,
        temperature: request.temperature,
        topP: request.top_p,
        stopSequences: request.stop
          ? Array.isArray(request.stop)
            ? request.stop
            : [request.stop]
          : undefined,
      },
    };

    // Map response_format to responseMimeType/responseJsonSchema
    if (request.response_format) {
      if (request.response_format.type === "json_object" || request.response_format.type === "json_schema") {
        req.generationConfig!.responseMimeType = "application/json";
        if (request.response_format.json_schema) {
          req.generationConfig!.responseJsonSchema = request.response_format.json_schema;
        }
      }
    }

    // Map reasoning config to thinkingConfig
    if (request.reasoning) {
      req.generationConfig!.thinkingConfig = {
        includeThoughts: request.reasoning.enabled,
        thinkingBudget: request.reasoning.max_tokens,
      };
    }

    // Map modalities to responseModalities
    if (request.modalities && request.modalities.length > 0) {
      req.generationConfig!.responseModalities = request.modalities.map(m => m.toUpperCase());
    }

    // Map image_config to imageConfig
    if (request.image_config?.aspect_ratio) {
      req.generationConfig!.imageConfig = {
        aspectRatio: request.image_config.aspect_ratio,
      };
      // Ensure IMAGE modality is included when aspect_ratio is set
      if (!req.generationConfig!.responseModalities) {
        req.generationConfig!.responseModalities = ["IMAGE", "TEXT"];
      }
    }

    // Map tool_choice to toolConfig
    if (request.tool_choice) {
      if (request.tool_choice === "none") {
        req.toolConfig = { functionCallingConfig: { mode: "NONE" } };
      } else if (request.tool_choice === "auto") {
        req.toolConfig = { functionCallingConfig: { mode: "AUTO" } };
      } else if (request.tool_choice === "required") {
        req.toolConfig = { functionCallingConfig: { mode: "ANY" } };
      } else if (typeof request.tool_choice === "object" && request.tool_choice.function?.name) {
        req.toolConfig = {
          functionCallingConfig: {
            mode: "ANY",
            allowedFunctionNames: [request.tool_choice.function.name],
          },
        };
      }
    }

    // Attach default safety settings
    req.safetySettings = DEFAULT_SAFETY_SETTINGS;

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
    const images: ImageOutput[] = [];
    let thoughtSignature: string | undefined;

    parts.forEach((part: any) => {
      if (part.text) {
        if (part.thought === true) reasoning_content += part.text;
        else content += part.text;
      }
      if (part.functionCall) {
        const functionName = part.functionCall.name || "unknown";
        tool_calls.push({
          id: generateFunctionCallId(functionName),
          type: "function",
          function: {
            name: functionName,
            arguments: JSON.stringify(part.functionCall.args),
          },
        });
      }
      // Handle image outputs from Gemini
      if (part.inlineData) {
        images.push({
          data: part.inlineData.data,
          mimeType: part.inlineData.mimeType || "image/png",
        });
      }
      if (part.thoughtSignature) thoughtSignature = part.thoughtSignature;
    });

    const usage = response.usageMetadata ? this.parseUsage(response.usageMetadata) : undefined;

    return {
      id: response.responseId || "gemini-" + Date.now(),
      model: response.modelVersion || "gemini-model",
      content: content || null,
      reasoning_content: reasoning_content || null,
      thinking: thoughtSignature
        ? { content: reasoning_content, signature: thoughtSignature }
        : undefined,
      images: images.length > 0 ? images : undefined,
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
      if (response.thinking?.signature)
        part.thoughtSignature = response.thinking.signature;
      parts.push(part);
    }
    if (response.content) parts.push({ text: response.content });
    // Include images in response
    if (response.images) {
      response.images.forEach((img) => {
        parts.push({
          inlineData: {
            mimeType: img.mimeType,
            data: img.data,
          },
        });
      });
    }
    if (response.tool_calls) {
      response.tool_calls.forEach((tc, index) => {
        const part: any = {
          functionCall: {
            name: tc.function.name,
            args: JSON.parse(tc.function.arguments),
          },
        };
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
        { content: { role: "model", parts }, finishReason: "STOP", index: 0 },
      ],
      usageMetadata: response.usage ? this.formatUsage(response.usage) : undefined,
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
    const self = this;

    const transformer = new TransformStream({
      start(controller) {
        parser = createParser({
          onEvent: (event: EventSourceMessage) => {
            if (event.data === "[DONE]") return;
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
                  logger.silly(
                    `Gemini Transformer: Enqueueing unified chunk (text)`,
                    chunk
                  );
                  controller.enqueue(chunk);
                }
                if (part.functionCall) {
                  const functionName = part.functionCall.name || "unknown";
                  const chunk = {
                    id: data.responseId,
                    model: data.modelVersion,
                    delta: {
                      role: "assistant",
                      tool_calls: [
                        {
                          id: generateFunctionCallId(functionName),
                          type: "function",
                          function: {
                            name: functionName,
                            arguments: JSON.stringify(part.functionCall.args),
                          },
                        },
                      ],
                    },
                  };
                  logger.silly(
                    `Gemini Transformer: Enqueueing unified chunk (tool)`,
                    chunk
                  );
                  controller.enqueue(chunk);
                }
              }

              if (candidate.finishReason) {
                const chunk = {
                  id: data.responseId,
                  model: data.modelVersion,
                  finish_reason: candidate.finishReason.toLowerCase(),
                  usage: data.usageMetadata ? self.parseUsage(data.usageMetadata) : undefined,
                };
                logger.silly(
                  `Gemini Transformer: Enqueueing unified chunk (finish)`,
                  chunk
                );
                controller.enqueue(chunk);
              }
            } catch (e) {
              logger.error("Error parsing Gemini stream chunk", { error: e });
            }
          },
        });
      },
      transform(chunk, controller) {
        const text =
          typeof chunk === "string"
            ? chunk
            : decoder.decode(chunk, { stream: true });
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
    const self = this;

    const transformer = new TransformStream({
      transform(chunk: any, controller) {
        const parts: Part[] = [];
        if (chunk.delta?.content) parts.push({ text: chunk.delta.content });
        if (chunk.delta?.reasoning_content)
          parts.push({
            text: chunk.delta.reasoning_content,
            thought: true,
          } as any);
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
                content: { role: "model", parts },
                finishReason: chunk.finish_reason?.toUpperCase() || null,
                index: 0,
              },
            ],
            usageMetadata: chunk.usage ? self.formatUsage(chunk.usage) : undefined,
          };
          const sseMessage = encode({ data: JSON.stringify(geminiChunk) });
          controller.enqueue(encoder.encode(sseMessage));
        }
      },
    });

    return stream.pipeThrough(transformer);
  }

  /**
   * Reconstructs a full JSON response body from a raw SSE string.
   * Parses Gemini's streaming format and accumulates content and tool calls
   * into a single response object.
   */
  reconstructResponseFromStream(rawSSE: string): ReconstructedChatResponse | null {
    const lines = rawSSE.split(/\r?\n/);

    let id = "";
    let model = "";
    let created = Math.floor(Date.now() / 1000);
    let accumulatedContent = "";
    let accumulatedReasoning = "";
    let finishReason: string | null = null;
    let usageMetadata: any = null;
    const toolCallsMap = new Map<string, any>();

    for (const line of lines) {
      // Skip comments (lines starting with ':'), empty lines, or [DONE] marker
      if (!line.startsWith("data: ") || line === "data: [DONE]") {
        continue;
      }

      // Remove "data: " prefix and parse JSON
      const jsonString = line.replace(/^data: /, "").trim();
      if (!jsonString) continue;

      try {
        const chunk: any = JSON.parse(jsonString);

        // Capture metadata from the first valid chunk
        if (!id && chunk.responseId) id = chunk.responseId;
        if (!model && chunk.modelVersion) model = chunk.modelVersion;

        const candidate = chunk.candidates?.[0];
        if (candidate) {
          const parts = candidate.content?.parts || [];

          // Accumulate content from parts
          for (const part of parts) {
        if (part.text) {
            if (part.thought === true) {
          accumulatedReasoning += part.text;
              } else {
                accumulatedContent += part.text;
          }
            }

            // Capture function calls
            if (part.functionCall) {
              const functionName = part.functionCall.name || "unknown";
              const callId = generateFunctionCallId(functionName);
              toolCallsMap.set(callId, {
                id: callId,
                type: "function",
                function: {
                  name: functionName,
                  arguments: JSON.stringify(part.functionCall.args || {}),
                },
              });
            }
          }

          // Capture finish reason
          if (candidate.finishReason) {
            finishReason = candidate.finishReason === "STOP"
           ? "stop"
              : candidate.finishReason === "MAX_TOKENS"
                ? "length"
                : candidate.finishReason.toLowerCase();
          }
        }

        // Capture usage
        if (chunk.usageMetadata) {
          usageMetadata = chunk.usageMetadata;
      }
      } catch {
        // Ignore parse errors for malformed chunks
      }
    }

    if (!id) return null;

    // Build the message object
    const message: any = {
      role: "assistant",
      content: accumulatedContent,
    };

    if (accumulatedReasoning) {
      message.reasoning_content = accumulatedReasoning;
    }

    // Add tool calls if any
    const toolCalls = Array.from(toolCallsMap.values());
    if (toolCalls.length > 0) {
      message.tool_calls = toolCalls;
    }

    return {
      id,
      model,
      object: "chat.completion",
      created,
      choices: [
        {
          index: 0,
          message,
      finish_reason: finishReason || "stop",
        },
      ],
      usage: usageMetadata,
    };
  }
}