import { Content, Part, Tool } from '@google/genai';
import { UnifiedChatRequest, GoogleBuiltInToolType } from '../../types/unified';
import { convertUnifiedPartsToGemini } from './part-mapper';

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
      thinkingLevel?: string;
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
 * - systemInstruction handling (Gap 1)
 * - toolConfig handling (Gap 3)
 * - parametersJsonSchema support (Gap 4)
 * - Google built-in tools support (Gap 5)
 */
export async function buildGeminiRequest(
  request: UnifiedChatRequest
): Promise<GenerateContentRequest> {
  const contents: Content[] = [];
  const tools: Tool[] = [];

  // Gap 1: Handle systemInstruction - use explicit systemInstruction field if available
  let systemInstructionContent: Content | undefined;

  if (request.systemInstruction) {
    const sysMsg = request.systemInstruction;
    const sysParts: Part[] = [];

    if (typeof sysMsg.content === 'string') {
      sysParts.push({ text: sysMsg.content });
    } else if (Array.isArray(sysMsg.content)) {
      sysParts.push(...convertUnifiedPartsToGemini(sysMsg.content));
    }

    if (sysParts.length > 0) {
      systemInstructionContent = { role: 'system', parts: sysParts };
    }
  }

  for (const msg of request.messages) {
    let role = '';
    const parts: Part[] = [];

    // Skip system messages if we have explicit systemInstruction (Gap 1)
    if (msg.role === 'system' && request.systemInstruction) {
      continue;
    }

    if (msg.role === 'system') {
      role = 'user';
      parts.push({
        text: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
      });
    } else if (msg.role === 'user' || msg.role === 'assistant') {
      role = msg.role === 'assistant' ? 'model' : 'user';

      if (msg.thinking?.content) {
        // @ts-ignore - Signal to Gemini that this is a thought part
        parts.push({ text: msg.thinking.content, thought: true });
      }

      if (typeof msg.content === 'string') {
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
    } else if (msg.role === 'tool') {
      role = 'user';
      parts.push({
        functionResponse: {
          name: msg.name || msg.tool_call_id || 'unknown_tool',
          response: {
            content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
          },
        },
      });
    }

    if (role && parts.length > 0) contents.push({ role, parts });
  }

  // Gap 4 & 5: Transform Unified tools to Gemini function declarations or built-in tools
  if (request.tools && request.tools.length > 0) {
    const functionDeclarations = [];
    const googleSearches: any[] = [];
    const codeExecutions: any[] = [];
    const urlContexts: any[] = [];

    for (const t of request.tools) {
      if (t.type === 'function' && t.function) {
        // Gap 4: Prefer parametersJsonSchema if available, fallback to parameters
        const funcDecl: any = {
          name: t.function.name,
          description: t.function.description,
        };

        if (t.function.parametersJsonSchema) {
          funcDecl.parametersJsonSchema = t.function.parametersJsonSchema;
        } else if (t.function.parameters) {
          funcDecl.parameters = t.function.parameters;
        }

        functionDeclarations.push(funcDecl);
      } else if (
        t.type === 'googleSearch' ||
        // Coerce known cross-provider web search types to googleSearch so that
        // clients using Anthropic/OpenAI/OpenRouter web search tool formats are
        // transparently mapped to the Gemini built-in when routing to a Gemini provider.
        (t as any).type === 'web_search_20250305' ||
        (t as any).type === 'web_search' ||
        (t as any).type === 'openrouter:web_search'
      ) {
        // Gap 5: Google built-in tools (including cross-provider web search coercion)
        googleSearches.push({});
      } else if (t.type === 'codeExecution') {
        codeExecutions.push({});
      } else if (t.type === 'urlContext') {
        urlContexts.push({});
      }
    }

    if (functionDeclarations.length > 0) {
      tools.push({ functionDeclarations });
    }
    if (googleSearches.length > 0) {
      tools.push({ googleSearch: {} });
    }
    if (codeExecutions.length > 0) {
      tools.push({ codeExecution: {} });
    }
    if (urlContexts.length > 0) {
      tools.push({ urlContext: {} });
    }
  }

  // Gap 3: Handle toolConfig
  let toolConfig: any;
  if (request.toolConfig) {
    toolConfig = {
      functionCallingConfig: {
        mode: request.toolConfig.mode,
        ...(request.toolConfig.functionCallingPreference && {
          functionCallingPreference: request.toolConfig.functionCallingPreference,
        }),
      },
    };
  }

  const generationConfig: GenerateContentRequest['generationConfig'] = {
    maxOutputTokens: request.max_tokens,
    temperature: request.temperature,
  };

  // Pass through response format settings
  if (request.response_format) {
    if (
      request.response_format.type === 'json_object' ||
      request.response_format.type === 'json_schema'
    ) {
      generationConfig.responseMimeType = 'application/json';
      if (request.response_format.json_schema) {
        generationConfig.responseJsonSchema = request.response_format.json_schema;
      }
    }
  }

  // Pass through thinking config
  if (request.reasoning && request.reasoning.enabled !== false) {
    generationConfig.thinkingConfig = {
      includeThoughts: request.reasoning.enabled,
      thinkingBudget: request.reasoning.max_tokens,
      // Map unified effort back to Gemini's ThinkingLevel enum values (MINIMAL/LOW/MEDIUM/HIGH)
      thinkingLevel: request.reasoning.effort ? request.reasoning.effort.toUpperCase() : undefined,
    };
  }

  const req: GenerateContentRequest = {
    contents,
    tools: tools.length > 0 ? tools : undefined,
    systemInstruction: systemInstructionContent,
    toolConfig,
    generationConfig,
  };

  // For same-format (gemini -> gemini) requests that take the non-pass-through
  // path (e.g. adapter active, vision fallthrough), carry through Gemini-native
  // top-level fields that the unified schema does not model. The unified schema
  // intentionally abstracts away provider-specific options (safetySettings,
  // cachedContent, labels, etc.) so cross-format transforms don't drop them on
  // the floor when the client is talking the same API type as the upstream
  // provider. Only fields not already set by the explicit mapping above are
  // carried through, so the unified pipeline output is never overridden.
  if (request.incomingApiType?.toLowerCase() === 'gemini' && request.originalBody) {
    const passthroughFields = ['safetySettings', 'cachedContent', 'labels'];
    for (const field of passthroughFields) {
      if (request.originalBody[field] !== undefined && (req as any)[field] === undefined) {
        (req as any)[field] = request.originalBody[field];
      }
    }

    // Merge unmapped generationConfig keys (e.g. topP, topK, stopSequences,
    // responseLogprobs, logprobs) that the explicit mapping above didn't set.
    const originalGenConfig = request.originalBody.generationConfig;
    if (originalGenConfig && typeof originalGenConfig === 'object') {
      const mergedGenConfig: any = { ...originalGenConfig, ...req.generationConfig };
      req.generationConfig = mergedGenConfig;
    }
  }

  return req;
}
