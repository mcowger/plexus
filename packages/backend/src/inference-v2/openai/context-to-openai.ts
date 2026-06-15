/**
 * T2.2 — Outbound serialiser: pi-ai AssistantMessage / AssistantMessageEvent → OpenAI wire format.
 *
 * Handles:
 *  - Text and thinking/reasoning (→ reasoning_content)
 *  - Tool calls with 0-based tool_calls array index (distinct from content-block index)
 *  - Usage field mapping from pi-ai Usage → OpenAI usage object
 *  - Stop-reason mapping (stop/length/toolUse/error/aborted → OpenAI finish_reason strings)
 *  - Error surfacing: stopReason === 'error' → surfaces errorMessage as content
 *  - chunkToSSE: formats a chunk as `data: {...}\n\n`
 *  - SSE_DONE: the terminal `data: [DONE]\n\n` frame
 */

import type {
  AssistantMessage,
  AssistantMessageEvent,
  Usage,
  TextContent,
  ThinkingContent,
  ToolCall,
} from '@earendil-works/pi-ai';

// ─── OpenAI response types ────────────────────────────────────────────────────

export interface OpenAIUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  prompt_tokens_details?: {
    cached_tokens?: number;
  };
  completion_tokens_details?: {
    reasoning_tokens?: number;
  };
}

export interface OpenAIMessage {
  role: 'assistant';
  content: string | null;
  reasoning_content?: string | null;
  tool_calls?: OpenAIToolCall[];
}

export interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface OpenAIChoice {
  index: number;
  message: OpenAIMessage;
  finish_reason: string | null;
}

export interface OpenAIChatCompletion {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: OpenAIChoice[];
  usage: OpenAIUsage;
}

// ─── Streaming chunk types ────────────────────────────────────────────────────

export interface OpenAIDelta {
  role?: 'assistant';
  content?: string | null;
  reasoning_content?: string | null;
  tool_calls?: {
    index: number;
    id?: string;
    type?: 'function';
    function?: {
      name?: string;
      arguments?: string;
    };
  }[];
}

export interface OpenAIChunkChoice {
  index: number;
  delta: OpenAIDelta;
  finish_reason: string | null;
}

export interface OpenAIChatChunk {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: OpenAIChunkChoice[];
  usage?: OpenAIUsage | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SSE_DONE = 'data: [DONE]\n\n';

function mapStopReason(reason: string | undefined): string {
  switch (reason) {
    case 'stop':
      return 'stop';
    case 'length':
      return 'length';
    case 'toolUse':
      return 'tool_calls';
    case 'error':
    case 'aborted':
      return 'stop';
    default:
      return 'stop';
  }
}

function mapUsage(usage: Usage): OpenAIUsage {
  return {
    prompt_tokens: usage.input,
    completion_tokens: usage.output,
    total_tokens: usage.totalTokens,
    prompt_tokens_details: usage.cacheRead > 0 ? { cached_tokens: usage.cacheRead } : undefined,
    completion_tokens_details: undefined,
  };
}

function extractTextAndThinking(message: AssistantMessage): {
  text: string;
  thinking: string | null;
} {
  let text = '';
  let thinking: string | null = null;

  for (const block of message.content) {
    if (block.type === 'text') {
      text += (block as TextContent).text;
    } else if (block.type === 'thinking') {
      thinking = (thinking ?? '') + (block as ThinkingContent).thinking;
    }
    // toolCall blocks are handled separately
  }

  return { text, thinking };
}

function extractToolCalls(message: AssistantMessage): OpenAIToolCall[] {
  const result: OpenAIToolCall[] = [];

  for (const block of message.content) {
    if (block.type === 'toolCall') {
      const tc = block as ToolCall;
      result.push({
        id: tc.id,
        type: 'function',
        function: {
          name: tc.name,
          arguments: JSON.stringify(tc.arguments ?? {}),
        },
      });
    }
  }

  return result;
}

// ─── Non-streaming: AssistantMessage → OpenAIChatCompletion ──────────────────

export function messageToCompletion(
  message: AssistantMessage,
  modelAlias: string,
  completionId?: string
): OpenAIChatCompletion {
  const id = completionId ?? `chatcmpl-${Date.now()}`;
  const created = Math.floor(Date.now() / 1000);

  // When stopReason is 'error', surface errorMessage as content
  if (message.stopReason === 'error' || message.stopReason === 'aborted') {
    return {
      id,
      object: 'chat.completion',
      created,
      model: modelAlias,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: message.errorMessage ?? 'An upstream error occurred.',
          },
          finish_reason: 'stop',
        },
      ],
      usage: mapUsage(message.usage),
    };
  }

  const { text, thinking } = extractTextAndThinking(message);
  const toolCalls = extractToolCalls(message);

  const openAiMessage: OpenAIMessage = {
    role: 'assistant',
    content: text || null,
    ...(thinking != null ? { reasoning_content: thinking } : {}),
    ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
  };

  return {
    id,
    object: 'chat.completion',
    created,
    model: modelAlias,
    choices: [
      {
        index: 0,
        message: openAiMessage,
        finish_reason: mapStopReason(message.stopReason),
      },
    ],
    usage: mapUsage(message.usage),
  };
}

// ─── Streaming: AssistantMessageEvent → OpenAIChatChunk ──────────────────────

/**
 * Maintains per-stream state needed to correctly emit tool-call index and role.
 */
export interface ChunkSerialiserState {
  id: string;
  model: string;
  /** 0-based tool_calls array index (not content-block index) */
  toolCallArrayIndex: number;
  /** Whether we have already emitted the role delta */
  sentRole: boolean;
}

export function makeChunkSerialiserState(model: string): ChunkSerialiserState {
  return {
    id: `chatcmpl-${Date.now()}`,
    model,
    toolCallArrayIndex: -1,
    sentRole: false,
  };
}

/**
 * Convert one AssistantMessageEvent to zero or more OpenAIChatChunk objects.
 * Returns an empty array for event types that don't produce client frames
 * (e.g. `start`).
 */
export function eventToChunks(
  event: AssistantMessageEvent,
  state: ChunkSerialiserState
): OpenAIChatChunk[] {
  const created = Math.floor(Date.now() / 1000);

  const baseChunk = (delta: OpenAIDelta, finishReason: string | null = null): OpenAIChatChunk => ({
    id: state.id,
    object: 'chat.completion.chunk',
    created,
    model: state.model,
    choices: [
      {
        index: 0,
        delta,
        finish_reason: finishReason,
      },
    ],
  });

  switch (event.type) {
    case 'start': {
      // First chunk — emit role
      state.sentRole = true;
      return [baseChunk({ role: 'assistant', content: '' })];
    }

    case 'text_delta': {
      const delta: OpenAIDelta = { content: event.delta };
      return [baseChunk(delta)];
    }

    case 'thinking_delta': {
      const delta: OpenAIDelta = { reasoning_content: event.delta };
      return [baseChunk(delta)];
    }

    case 'toolcall_start': {
      // Increment the 0-based tool_calls array index when a new tool call begins
      state.toolCallArrayIndex++;
      const partial = event.partial.content[event.contentIndex];
      const tcPartial = partial?.type === 'toolCall' ? (partial as ToolCall) : null;
      const delta: OpenAIDelta = {
        tool_calls: [
          {
            index: state.toolCallArrayIndex,
            id: tcPartial?.id ?? '',
            type: 'function',
            function: {
              name: tcPartial?.name ?? '',
              arguments: '',
            },
          },
        ],
      };
      return [baseChunk(delta)];
    }

    case 'toolcall_delta': {
      const delta: OpenAIDelta = {
        tool_calls: [
          {
            index: state.toolCallArrayIndex,
            function: { arguments: event.delta },
          },
        ],
      };
      return [baseChunk(delta)];
    }

    case 'toolcall_end': {
      // No extra chunk needed — arguments already accumulated via deltas
      return [];
    }

    case 'done': {
      const usageChunk: OpenAIChatChunk = {
        ...baseChunk({}, mapStopReason(event.reason)),
        usage: mapUsage(event.message.usage),
      };
      return [usageChunk];
    }

    case 'error': {
      // Surface errorMessage as a content chunk then a stop chunk
      const errMsg = event.error.errorMessage ?? 'Upstream error';
      return [baseChunk({ content: errMsg }, 'stop')];
    }

    // text_start, text_end, thinking_start, thinking_end produce no client frames
    default:
      return [];
  }
}

/**
 * Serialize an OpenAIChatChunk to an SSE frame: `data: {...}\n\n`
 */
export function chunkToSSE(chunk: OpenAIChatChunk): string {
  return `data: ${JSON.stringify(chunk)}\n\n`;
}

export { SSE_DONE };
