import type {
  Context,
  UserMessage,
  AssistantMessage,
  ToolResultMessage,
  AssistantMessageEvent,
  Tool as PiAiTool,
  Usage
} from '@mariozechner/pi-ai';
import { Type } from '@sinclair/typebox';
import type {
  UnifiedChatRequest,
  UnifiedChatResponse,
  UnifiedChatStreamChunk,
  UnifiedMessage,
  UnifiedTool,
  MessageContent,
  UnifiedUsage
} from '../../types/unified';

export function unifiedToContext(request: UnifiedChatRequest): Context {
  const context: Context = {
    messages: [],
    tools: request.tools ? request.tools.map(unifiedToolToPiAi) : undefined
  };

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
      context.messages.push(unifiedMessageToAssistantMessage(msg));
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
      timestamp: Date.now()
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
          mimeType
        };
      }

      throw new Error('OAuth providers require base64-encoded images, not URLs');
    }

    throw new Error(`Unsupported content type: ${(block as any).type}`);
  });

  return {
    role: 'user',
    content,
    timestamp: Date.now()
  } as UserMessage;
}

function unifiedMessageToAssistantMessage(msg: UnifiedMessage): AssistantMessage {
  const content: any[] = [];

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
      content.push({
        type: 'toolCall',
        id: toolCall.id,
        name: toolCall.function.name,
        arguments: JSON.parse(toolCall.function.arguments)
      } as any);
    }
  }

  if (msg.thinking) {
    content.push({
      type: 'thinking',
      thinking: msg.thinking.content,
      thinkingSignature: msg.thinking.signature
    } as any);
  }

  return {
    role: 'assistant',
    content,
    api: 'openai-completions',
    provider: 'unknown',
    model: 'unknown',
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
    },
    stopReason: 'stop',
    timestamp: Date.now()
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
    timestamp: Date.now()
  } as ToolResultMessage;
}

function unifiedToolToPiAi(tool: UnifiedTool): PiAiTool {
  const parameters = Type.Object(
    Object.fromEntries(
      Object.entries(tool.function.parameters.properties || {}).map(
        ([key, value]: [string, any]) => [
          key,
          Type.Any({ description: value.description })
        ]
      )
    ),
    {
      additionalProperties: tool.function.parameters.additionalProperties ?? false
    }
  );

  return {
    name: tool.function.name,
    description: tool.function.description || '',
    parameters
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
        toolCalls.push({
          id: callId || block.id,
          type: 'function',
          function: {
            name: stripProxyPrefix(block.name) || block.name,
            arguments: JSON.stringify(block.arguments)
          }
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
      apiType: 'oauth'
    },
    finishReason: mapStopReason(message.stopReason)
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
    usage: undefined
  };

  switch (event.type) {
    case 'start':
      return {
        ...baseChunk,
        delta: { role: 'assistant' }
      };
    case 'text_delta':
      return {
        ...baseChunk,
        delta: { content: event.delta }
      };
    case 'thinking_delta':
      return {
        ...baseChunk,
        delta: {
          reasoning_content: event.delta,
          thinking: { content: event.delta }
        }
      };
    case 'toolcall_start':
      {
        const toolCall = event.partial?.content?.[event.contentIndex];
        const { callId } = parseToolCallIds((toolCall as any)?.id);
        return {
          ...baseChunk,
          delta: {
            tool_calls: [
              {
                index: event.contentIndex,
                id: callId || '',
                type: 'function',
                function: {
                  name: stripProxyPrefix((toolCall as any)?.name) || '',
                  arguments: ''
                }
              }
            ]
          }
        };
      }
    case 'toolcall_delta': {
      const toolCall = event.partial?.content?.[event.contentIndex];
      if (toolCall && toolCall.type === 'toolCall') {
        const { callId } = parseToolCallIds((toolCall as any).id);
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
                  arguments: event.delta
                }
              }
            ]
          }
        };
      }
      return null;
    }
    case 'toolcall_end':
      {
        const { callId } = parseToolCallIds(event.toolCall.id);
        return {
          ...baseChunk,
          delta: {
            tool_calls: [
              {
                index: event.contentIndex,
                id: callId || event.toolCall.id,
                type: 'function',
                function: {
                  name: stripProxyPrefix(event.toolCall.name),
                  arguments: JSON.stringify(event.toolCall.arguments)
                }
              }
            ]
          }
        };
      }
    case 'done':
      return {
        ...baseChunk,
        finish_reason: mapStopReason(event.reason),
        usage: piAiUsageToUnified(event.message.usage)
      };
    case 'error':
      return {
        ...baseChunk,
        finish_reason: event.reason === 'aborted' ? 'aborted' : 'error',
        usage: piAiUsageToUnified(event.error.usage)
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

function piAiUsageToUnified(usage: Usage): UnifiedUsage {
  return {
    input_tokens: usage.input,
    output_tokens: usage.output,
    total_tokens: usage.totalTokens,
    reasoning_tokens: 0,
    cached_tokens: usage.cacheRead,
    cache_creation_tokens: usage.cacheWrite
  };
}

function mapStopReason(reason: string): string {
  switch (reason) {
    case 'stop':
      return 'stop';
    case 'length':
      return 'length';
    case 'toolUse':
      return 'tool_calls';
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
