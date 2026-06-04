/**
 * Beta inference path — outbound conversion.
 *
 * Serializes pi-ai AssistantMessage / AssistantMessageEvent back into the OpenAI
 * chat-completions wire format. This is the ONE outbound boundary conversion
 * pi-ai does not provide (pi-ai handles Context → provider wire-format; callers
 * consume the AssistantMessage result).
 *
 * Mirrors piAiMessageToUnified / piAiEventToChunk in type-mappers.ts but emits
 * OpenAI JSON directly rather than going through UnifiedChatResponse.
 */
import type { AssistantMessage, AssistantMessageEvent, Usage } from '@earendil-works/pi-ai';

/** Lean OpenAI chat.completion response (non-streaming). */
export interface OpenAIChatCompletion {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: 'assistant';
      content: string | null;
      reasoning_content?: string | null;
      tool_calls?: Array<{
        id: string;
        type: 'function';
        function: { name: string; arguments: string };
      }>;
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    prompt_tokens_details?: { cached_tokens: number };
    completion_tokens_details?: { reasoning_tokens: number };
  };
}

/** Lean OpenAI chat.completion.chunk (streaming delta). */
export interface OpenAIChatChunk {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role?: 'assistant';
      content?: string;
      reasoning_content?: string;
      tool_calls?: Array<{
        index: number;
        id?: string;
        type?: 'function';
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

function mapStopReason(reason?: string): string {
  switch (reason) {
    case 'toolUse':
      return 'tool_calls';
    case 'length':
      return 'length';
    case 'error':
      return 'error';
    case 'aborted':
      return 'aborted';
    default:
      return 'stop';
  }
}

function parseToolCallIds(rawId: string): string {
  // pi-ai may encode IDs as "callId|functionCallId"; take the first segment.
  return rawId.split('|')[0] ?? rawId;
}

function buildUsage(usage: Usage) {
  return {
    prompt_tokens: usage.input,
    completion_tokens: usage.output,
    total_tokens: usage.totalTokens,
    ...(usage.cacheRead > 0 ? { prompt_tokens_details: { cached_tokens: usage.cacheRead } } : {}),
  };
}

function makeId(prefix: string): string {
  return `${prefix}-${Date.now()}`;
}

/**
 * Convert a completed pi-ai AssistantMessage into an OpenAI chat.completion.
 */
export function assistantMessageToOpenAIResponse(
  message: AssistantMessage,
  model: string
): OpenAIChatCompletion {
  let text: string | null = null;
  let reasoning: string | null = null;
  const toolCalls: OpenAIChatCompletion['choices'][0]['message']['tool_calls'] = [];

  // Surface provider error message when the stop reason indicates failure
  if (message.stopReason === 'error' && message.errorMessage) {
    text = message.errorMessage;
  }

  for (const block of message.content) {
    if (block.type === 'text') {
      text = (text ?? '') + block.text;
    } else if (block.type === 'thinking') {
      reasoning = (reasoning ?? '') + block.thinking;
    } else if (block.type === 'toolCall') {
      toolCalls.push({
        id: parseToolCallIds(block.id),
        type: 'function',
        function: {
          name: block.name,
          arguments: JSON.stringify(block.arguments),
        },
      });
    }
  }

  return {
    id: message.responseId ?? makeId('chatcmpl'),
    object: 'chat.completion',
    created: Math.floor(message.timestamp / 1000),
    model: message.responseModel ?? model,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: text,
          ...(reasoning != null ? { reasoning_content: reasoning } : {}),
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        },
        finish_reason: mapStopReason(message.stopReason),
      },
    ],
    usage: buildUsage(message.usage),
  };
}

/**
 * Convert a single pi-ai streaming event into an OpenAI chat.completion.chunk,
 * or null for event types that produce no chunk (text_start, text_end, etc.).
 */
export function assistantEventToOpenAIChunk(
  event: AssistantMessageEvent,
  model: string
): OpenAIChatChunk | null {
  const base: Omit<OpenAIChatChunk, 'choices'> = {
    id: makeId('chatcmpl'),
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model,
  };

  switch (event.type) {
    case 'start':
      return {
        ...base,
        choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }],
      };

    case 'text_delta':
      return {
        ...base,
        choices: [{ index: 0, delta: { content: event.delta }, finish_reason: null }],
      };

    case 'thinking_delta':
      return {
        ...base,
        choices: [{ index: 0, delta: { reasoning_content: event.delta }, finish_reason: null }],
      };

    case 'toolcall_delta': {
      const content = event.partial?.content ?? [];
      const block = content[event.contentIndex];
      if (!block || block.type !== 'toolCall') return null;

      // Compute the 0-based tool_calls array index (skip non-toolCall blocks).
      const toolCallIndex = content
        .slice(0, event.contentIndex)
        .filter((c) => c.type === 'toolCall').length;

      return {
        ...base,
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: toolCallIndex,
                  id: parseToolCallIds((block as any).id),
                  type: 'function',
                  function: { name: (block as any).name, arguments: event.delta },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      };
    }

    case 'done':
      return {
        ...base,
        choices: [{ index: 0, delta: {}, finish_reason: mapStopReason(event.reason) }],
        usage: buildUsage(event.message.usage),
      };

    case 'error': {
      const errMsg = event.error?.errorMessage ?? 'Upstream provider error';
      return {
        ...base,
        choices: [{ index: 0, delta: { content: errMsg }, finish_reason: 'error' }],
      };
    }

    // Ignored: text_start, text_end, thinking_start, thinking_end, toolcall_start, toolcall_end
    default:
      return null;
  }
}

/**
 * Encode an OpenAI chunk as an SSE frame (data: {...}\n\n).
 */
export function chunkToSSE(chunk: OpenAIChatChunk): string {
  return `data: ${JSON.stringify(chunk)}\n\n`;
}

export const SSE_DONE = 'data: [DONE]\n\n';
