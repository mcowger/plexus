import type {
  Context,
  UserMessage,
  AssistantMessage,
  ToolResultMessage,
  AssistantMessageEvent,
  Tool as PiAiTool,
  Usage,
} from '@mariozechner/pi-ai';
import { Type } from '@sinclair/typebox';
import type {
  UnifiedChatRequest,
  UnifiedChatResponse,
  UnifiedChatStreamChunk,
  UnifiedMessage,
  UnifiedTool,
  MessageContent,
  UnifiedUsage,
} from '../../types/unified';
export function unifiedToContext(
  request: UnifiedChatRequest,
  provider?: string,
  modelId?: string,
  api?: string
): Context {
  const context: Context = {
    messages: [],
    tools: request.tools
      ? request.tools
          .filter((t) => t.function)
          .map((tool) => {
            try {
              return unifiedToolToPiAi(tool);
            } catch (err) {
              // Fall back to raw schema so the request doesn't fail entirely
              return {
                name: tool.function!.name,
                description: tool.function!.description || '',
                parameters: tool.function!.parametersJsonSchema || tool.function!.parameters || {},
              } as PiAiTool;
            }
          })
      : undefined,
  };

  // Resolve provider/model/api for thought-signature replay.
  // Pi-ai only keeps thought signatures when the replayed message comes from the
  // same provider+api+model as the current target — otherwise Gemini 3 degrades tool
  // calls in history to plain text, confusing the model on subsequent turns.
  const replayProvider = provider ?? (request.metadata as any)?.plexus_metadata?.oauthProvider;
  const replayModel = modelId ?? request.model;
  const replayApi = api;

  // Handle Gemini-style systemInstruction (stored separately from messages)
  if (request.systemInstruction) {
    const content = extractTextContent(request.systemInstruction.content);
    if (content) {
      context.systemPrompt = content;
    }
  }

  for (const msg of request.messages) {
    if (msg.role === 'system') {
      const content = extractTextContent(msg.content);
      if (content) {
        context.systemPrompt = content;
      }
      continue;
    }

    if (msg.role === 'user') {
      context.messages.push(unifiedMessageToUserMessage(msg));
    } else if (msg.role === 'assistant') {
      context.messages.push(
        unifiedMessageToAssistantMessage(msg, replayProvider, replayModel, replayApi)
      );
    } else if (msg.role === 'tool') {
      context.messages.push(unifiedMessageToToolResult(msg));
    }
  }

  return context;
}

function unifiedMessageToUserMessage(msg: UnifiedMessage): UserMessage {
  if (typeof msg.content === 'string') {
    return {
      role: 'user',
      content: msg.content,
      timestamp: Date.now(),
    };
  }

  const content = (msg.content || []).map((block) => {
    if (block.type === 'text') {
      return { type: 'text' as const, text: block.text };
    }
    if (block.type === 'image_url') {
      const url = block.image_url.url;
      const isBase64 = url.startsWith('data:');

      if (isBase64) {
        const [header = '', data = ''] = url.split(',');
        const mimeMatch = header.match(/data:(.*?);base64/);
        const mimeType = mimeMatch ? mimeMatch[1] : 'image/png';

        return {
          type: 'image' as const,
          data,
          mimeType,
        };
      }

      throw new Error('OAuth providers require base64-encoded images, not URLs');
    }

    throw new Error(`Unsupported content type: ${(block as any).type}`);
  });

  return {
    role: 'user',
    content,
    timestamp: Date.now(),
  } as UserMessage;
}

function unifiedMessageToAssistantMessage(
  msg: UnifiedMessage,
  provider?: string,
  model?: string,
  api?: string
): AssistantMessage {
  const content: any[] = [];

  // Thinking must come before tool_use blocks (Anthropic API requirement)
  if (msg.thinking) {
    content.push({
      type: 'thinking',
      thinking: msg.thinking.content,
      thinkingSignature: msg.thinking.signature,
    } as any);
  }

  if (typeof msg.content === 'string' && msg.content) {
    content.push({ type: 'text', text: msg.content });
  } else if (Array.isArray(msg.content)) {
    for (const block of msg.content) {
      if (block.type === 'text') {
        content.push({ type: 'text', text: block.text });
      }
    }
  }

  if (msg.tool_calls && msg.tool_calls.length > 0) {
    for (const toolCall of msg.tool_calls) {
      const block: any = {
        type: 'toolCall',
        id: toolCall.id,
        name: toolCall.function.name,
        arguments: JSON.parse(toolCall.function.arguments),
      };
      if (toolCall.thought_signature) {
        block.thoughtSignature = toolCall.thought_signature;
      }
      content.push(block);
    }
  }

  return {
    role: 'assistant',
    content,
    api: api ?? 'openai-completions',
    provider: provider ?? 'unknown',
    model: model ?? 'unknown',
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'stop',
    timestamp: Date.now(),
  } as AssistantMessage;
}

function unifiedMessageToToolResult(msg: UnifiedMessage): ToolResultMessage {
  const content: any[] = [];

  if (typeof msg.content === 'string') {
    content.push({ type: 'text', text: msg.content } as any);
  } else if (Array.isArray(msg.content)) {
    for (const block of msg.content) {
      if (block.type === 'text') {
        content.push({ type: 'text', text: block.text } as any);
      } else if (block.type === 'image_url') {
        const url = block.image_url.url;
        if (url.startsWith('data:')) {
          const [header = '', data = ''] = url.split(',');
          const mimeMatch = header.match(/data:(.*?);base64/);
          const mimeType = mimeMatch ? mimeMatch[1] : 'image/png';
          content.push({ type: 'image', data, mimeType } as any);
        }
      }
    }
  }

  return {
    role: 'toolResult',
    toolCallId: msg.tool_call_id!,
    toolName: msg.name || 'unknown',
    content,
    isError: false,
    timestamp: Date.now(),
  } as ToolResultMessage;
}

/**
 * Convert a raw JSON Schema node into a proper TypeBox object.
 *
 * Gemini 3 models follow TypeBox-style schemas (with `anyOf`+`const` for enums,
 * `required` before `properties`) more reliably than raw JSON Schema (with `enum`
 * arrays). This recursive converter ensures tool parameter schemas match the format
 * that pi-coding-agent uses successfully.
 */
function jsonSchemaToTypeBox(schema: any): any {
  if (!schema || typeof schema !== 'object') return Type.Any();

  const opts: Record<string, any> = {};
  if (schema.description) opts.description = schema.description;

  // Handle enum → Type.Union(Type.Literal(...))
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    const literals = schema.enum.map((v: any) => Type.Literal(v));
    return literals.length === 1 ? { ...literals[0], ...opts } : Type.Union(literals, opts);
  }

  // Handle anyOf / oneOf passthrough (already in the right format)
  if (Array.isArray(schema.anyOf)) {
    return { anyOf: schema.anyOf.map(jsonSchemaToTypeBox), ...opts };
  }
  if (Array.isArray(schema.oneOf)) {
    return { oneOf: schema.oneOf.map(jsonSchemaToTypeBox), ...opts };
  }

  switch (schema.type) {
    case 'object': {
      const props: Record<string, any> = {};
      if (schema.properties) {
        for (const [key, val] of Object.entries(schema.properties)) {
          props[key] = jsonSchemaToTypeBox(val);
        }
      }
      const obj = Type.Object(props, opts);
      // TypeBox sets required to all keys by default; override with the schema's required
      if (Array.isArray(schema.required)) {
        obj.required = schema.required;
      } else {
        delete obj.required;
      }
      if (schema.additionalProperties !== undefined) {
        obj.additionalProperties = schema.additionalProperties;
      }
      return obj;
    }
    case 'array': {
      const items = schema.items ? jsonSchemaToTypeBox(schema.items) : Type.Any();
      return Type.Array(items, opts);
    }
    case 'string':
      return Type.String(opts);
    case 'number':
      return Type.Number(opts);
    case 'integer':
      return Type.Integer(opts);
    case 'boolean':
      return Type.Boolean(opts);
    default:
      // Fallback: wrap as-is for unknown/complex schemas
      return Type.Unsafe(schema);
  }
}

function unifiedToolToPiAi(tool: UnifiedTool): PiAiTool {
  if (!tool.function) {
    // Skip tools without function declarations (e.g., Google built-in tools)
    throw new Error(`Tool is missing function declaration: ${tool.type}`);
  }

  // Convert the raw JSON Schema into proper TypeBox objects so that Gemini 3
  // sees the `anyOf`+`const` enum pattern and `required`-before-`properties`
  // ordering that it follows more reliably.
  const rawSchema = tool.function.parametersJsonSchema || tool.function.parameters || {};

  const parameters = jsonSchemaToTypeBox({
    type: 'object',
    ...rawSchema,
  });

  return {
    name: tool.function.name,
    description: tool.function.description || '',
    parameters,
  } as PiAiTool;
}

export function piAiMessageToUnified(
  message: AssistantMessage,
  provider: string,
  model: string
): UnifiedChatResponse {
  const stripProxyPrefix = (name?: string) => {
    if (!name || provider !== 'anthropic') return name;
    return name.startsWith('proxy_') ? name.slice('proxy_'.length) : name;
  };

  let textContent: string | null = null;
  let thinkingContent: string | null = null;
  const toolCalls: any[] = [];

  if (typeof (message as any).content === 'string') {
    textContent = (message as any).content;
  } else {
    for (const block of message.content as any[]) {
      if (block.type === 'text') {
        textContent = (textContent || '') + block.text;
      } else if (block.type === 'thinking') {
        thinkingContent = (thinkingContent || '') + block.thinking;
      } else if (block.type === 'toolCall') {
        const { callId } = parseToolCallIds((block as any).id);
        const thoughtSignature = (block as any).thoughtSignature;
        toolCalls.push({
          id: callId || block.id,
          type: 'function',
          function: {
            name: stripProxyPrefix(block.name) || block.name,
            arguments: JSON.stringify(block.arguments),
          },
          ...(thoughtSignature ? { thinking: { signature: thoughtSignature } } : {}),
        });
      }
    }
  }

  const usage = piAiUsageToUnified(message.usage);

  return {
    id: `oauth-${Date.now()}`,
    model,
    created: Math.floor(message.timestamp / 1000),
    content: textContent,
    reasoning_content: thinkingContent,
    thinking: thinkingContent ? { content: thinkingContent } : undefined,
    tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
    usage,
    plexus: {
      provider,
      model,
      apiType: 'oauth',
    },
    finishReason: mapStopReason(message.stopReason),
  };
}

export function piAiEventToChunk(
  event: AssistantMessageEvent,
  model: string,
  provider?: string
): UnifiedChatStreamChunk | null {
  const stripProxyPrefix = (name?: string) => {
    if (!name || provider !== 'anthropic') return name;
    return name.startsWith('proxy_') ? name.slice('proxy_'.length) : name;
  };

  const baseChunk = {
    id: `oauth-${Date.now()}`,
    model,
    created: Math.floor(Date.now() / 1000),
    delta: {},
    finish_reason: null,
    usage: undefined,
  };

  switch (event.type) {
    case 'start':
      return {
        ...baseChunk,
        delta: { role: 'assistant' },
      };
    case 'text_delta':
      return {
        ...baseChunk,
        delta: { content: event.delta },
      };
    case 'thinking_delta':
      return {
        ...baseChunk,
        delta: {
          reasoning_content: event.delta,
          thinking: { content: event.delta },
        },
      };
    case 'toolcall_start':
      // Gemini doesn't need start events with empty args which cause parsing errors in formatter
      return null;
    case 'toolcall_delta': {
      const toolCall = event.partial?.content?.[event.contentIndex];
      if (toolCall && toolCall.type === 'toolCall') {
        const { callId } = parseToolCallIds((toolCall as any).id);
        const thoughtSignature = (toolCall as any).thoughtSignature;

        return {
          ...baseChunk,
          delta: {
            tool_calls: [
              {
                index: event.contentIndex,
                id: callId || (toolCall as any).id,
                type: 'function',
                function: {
                  name: stripProxyPrefix((toolCall as any).name),
                  arguments: event.delta,
                },
              },
            ],
            ...(thoughtSignature
              ? {
                  thinking: {
                    signature: thoughtSignature,
                  },
                }
              : {}),
          },
        };
      }
      return null;
    }
    case 'toolcall_end':
      return null;
    case 'done':
      return {
        ...baseChunk,
        finish_reason: mapStopReason(event.reason),
        usage: piAiUsageToUnified(event.message.usage),
      };
    case 'error':
      const errorMessage = extractPiAiErrorMessage(event.error);
      return {
        ...baseChunk,
        delta: {
          content: errorMessage || 'OAuth provider error',
        },
        finish_reason: event.reason === 'aborted' ? 'aborted' : 'error',
        usage: piAiUsageToUnified(event.error.usage),
      };
    case 'text_start':
    case 'text_end':
    case 'thinking_start':
    case 'thinking_end':
      return null;
    default:
      return null;
  }
}

function extractPiAiErrorMessage(error: any): string | undefined {
  if (!error) return undefined;
  if (typeof error === 'string') return error;
  if (typeof error.message === 'string' && error.message.trim()) return error.message;
  if (typeof error.error === 'string' && error.error.trim()) return error.error;

  // Some providers nest error details under an `error` object.
  if (typeof error.error === 'object' && error.error) {
    if (typeof error.error.message === 'string' && error.error.message.trim()) {
      return error.error.message;
    }
  }

  return undefined;
}

function piAiUsageToUnified(usage: Usage): UnifiedUsage {
  return {
    input_tokens: usage.input,
    output_tokens: usage.output,
    total_tokens: usage.totalTokens,
    reasoning_tokens: 0,
    cached_tokens: usage.cacheRead,
    cache_creation_tokens: usage.cacheWrite,
  };
}

function mapStopReason(reason: string): string {
  switch (reason) {
    case 'stop':
      return 'stop';
    case 'length':
      return 'length';
    case 'toolUse':
      return 'stop';
    case 'error':
      return 'error';
    case 'aborted':
      return 'aborted';
    default:
      return 'stop';
  }
}

function parseToolCallIds(rawId?: string): { callId?: string; functionCallId?: string } {
  if (!rawId) return {};
  const [callId, functionCallId] = rawId.split('|');
  if (!functionCallId) {
    return { callId };
  }
  return { callId, functionCallId };
}

function extractTextContent(content: string | null | MessageContent[]): string | null {
  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    const textBlocks = content.filter((block) => block.type === 'text');
    return textBlocks.map((block) => (block as any).text).join('');
  }

  return null;
}
