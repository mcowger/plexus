/**
 * T3.2 — Outbound serialiser: pi-ai AssistantMessage / AssistantMessageEvent
 * → Anthropic messages wire format.
 *
 * Non-streaming response shape:
 *   { id, type:"message", role:"assistant", model, content:[...], stop_reason,
 *     stop_sequence:null, usage }
 *   Content order is mandated by Anthropic: thinking blocks → text → tool_use.
 *
 * Streaming SSE event sequence (Anthropic protocol):
 *   message_start → [content_block_start → content_block_delta... → content_block_stop]* →
 *   message_delta → message_stop
 *
 * Lazy content_block_start: the start event fires just before the first delta
 * of each block (not eagerly at stream start).
 *
 * Each tool call is a separate content_block with type "tool_use".
 * Each text run and each thinking run are also separate content_blocks.
 * Block index is a monotonically increasing counter across all block types.
 */

import type {
  AssistantMessage,
  AssistantMessageEvent,
  Usage,
  TextContent,
  ThinkingContent,
  ToolCall,
} from '@earendil-works/pi-ai';

// ─── Anthropic wire types ─────────────────────────────────────────────────────

export interface AnthropicUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

export type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> };

export interface AnthropicMessage {
  id: string;
  type: 'message';
  role: 'assistant';
  model: string;
  content: AnthropicContentBlock[];
  stop_reason: string | null;
  stop_sequence: null;
  usage: AnthropicUsage;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mapStopReason(reason: string): string {
  switch (reason) {
    case 'stop':
      return 'end_turn';
    case 'toolUse':
      return 'tool_use';
    case 'length':
      return 'max_tokens';
    case 'error':
    case 'aborted':
      return 'end_turn';
    default:
      return 'end_turn';
  }
}

function mapUsage(u: Usage): AnthropicUsage {
  return {
    input_tokens: u.input,
    output_tokens: u.output,
    cache_read_input_tokens: u.cacheRead > 0 ? u.cacheRead : undefined,
    cache_creation_input_tokens: u.cacheWrite > 0 ? u.cacheWrite : undefined,
  };
}

function makeMessageId(): string {
  return `msg_${Date.now().toString(36)}`;
}

// ─── Non-streaming serialiser ─────────────────────────────────────────────────

export function messageToAnthropicResponse(
  message: AssistantMessage,
  modelAlias: string,
  messageId?: string
): AnthropicMessage {
  const id = messageId ?? makeMessageId();

  // Error / aborted: surface errorMessage as a text block
  if (message.stopReason === 'error' || message.stopReason === 'aborted') {
    return {
      id,
      type: 'message',
      role: 'assistant',
      model: modelAlias,
      content: [{ type: 'text', text: message.errorMessage ?? 'An upstream error occurred.' }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: mapUsage(message.usage),
    };
  }

  // Build content in Anthropic order: thinking → text → tool_use
  const thinkingBlocks: AnthropicContentBlock[] = [];
  const textBlocks: AnthropicContentBlock[] = [];
  const toolBlocks: AnthropicContentBlock[] = [];

  for (const block of message.content) {
    if (block.type === 'thinking') {
      thinkingBlocks.push({ type: 'thinking', thinking: (block as ThinkingContent).thinking });
    } else if (block.type === 'text') {
      textBlocks.push({ type: 'text', text: (block as TextContent).text });
    } else if (block.type === 'toolCall') {
      const tc = block as ToolCall;
      toolBlocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.arguments ?? {} });
    }
  }

  return {
    id,
    type: 'message',
    role: 'assistant',
    model: modelAlias,
    content: [...thinkingBlocks, ...textBlocks, ...toolBlocks],
    stop_reason: mapStopReason(message.stopReason),
    stop_sequence: null,
    usage: mapUsage(message.usage),
  };
}

// ─── Streaming serialiser ─────────────────────────────────────────────────────

/**
 * Mutable state threaded through `eventToAnthropicSSE` calls for one stream.
 */
export interface AnthropicChunkSerialiserState {
  messageId: string;
  model: string;
  /** Next block index to assign */
  nextBlockIndex: number;
  /** Type of the currently open content_block, or null */
  activeBlockType: 'text' | 'thinking' | 'tool_use' | null;
  /** Index of the currently open content_block */
  activeBlockIndex: number | null;
  /** tool_call id of the active tool_use block */
  activeToolId: string | null;
  sentStart: boolean;
}

export function makeAnthropicChunkSerialiserState(model: string): AnthropicChunkSerialiserState {
  return {
    messageId: makeMessageId(),
    model,
    nextBlockIndex: 0,
    activeBlockType: null,
    activeBlockIndex: null,
    activeToolId: null,
    sentStart: false,
  };
}

/** Encode one SSE event as `event: <name>\ndata: <json>\n\n` */
function sseEvent(name: string, data: unknown): string {
  return `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * Convert one AssistantMessageEvent to Anthropic SSE frames.
 * Returns an array of SSE strings (may be empty for some event types).
 */
export function eventToAnthropicSSE(
  event: AssistantMessageEvent,
  state: AnthropicChunkSerialiserState
): string[] {
  const frames: string[] = [];

  // ── Helpers local to this call ───────────────────────────────────────────
  const closeCurrentBlock = () => {
    if (state.activeBlockType !== null && state.activeBlockIndex !== null) {
      frames.push(
        sseEvent('content_block_stop', {
          type: 'content_block_stop',
          index: state.activeBlockIndex,
        })
      );
      state.activeBlockType = null;
      state.activeBlockIndex = null;
      state.activeToolId = null;
    }
  };

  const openBlock = (
    type: 'text' | 'thinking' | 'tool_use',
    extra?: { id?: string; name?: string }
  ) => {
    closeCurrentBlock();
    const index = state.nextBlockIndex++;
    state.activeBlockIndex = index;
    state.activeBlockType = type;

    let content_block: Record<string, unknown>;
    if (type === 'text') {
      content_block = { type: 'text', text: '' };
    } else if (type === 'thinking') {
      content_block = { type: 'thinking', thinking: '' };
    } else {
      // tool_use
      state.activeToolId = extra?.id ?? null;
      content_block = { type: 'tool_use', id: extra?.id ?? '', name: extra?.name ?? '', input: {} };
    }

    frames.push(
      sseEvent('content_block_start', {
        type: 'content_block_start',
        index,
        content_block,
      })
    );
  };

  // ── Event dispatch ────────────────────────────────────────────────────────

  switch (event.type) {
    case 'start': {
      // message_start with empty content and initial usage (all zeros)
      state.sentStart = true;
      const usage = event.partial.usage;
      frames.push(
        sseEvent('message_start', {
          type: 'message_start',
          message: {
            id: state.messageId,
            type: 'message',
            role: 'assistant',
            model: state.model,
            content: [],
            stop_reason: null,
            stop_sequence: null,
            usage: {
              input_tokens: usage?.input ?? 0,
              output_tokens: usage?.output ?? 0,
              cache_read_input_tokens: usage?.cacheRead ?? 0,
              cache_creation_input_tokens: usage?.cacheWrite ?? 0,
            },
          },
        })
      );
      // Emit an initial ping-style empty delta so clients know the stream started
      frames.push(sseEvent('ping', { type: 'ping' }));
      break;
    }

    case 'thinking_start': {
      openBlock('thinking');
      break;
    }

    case 'thinking_delta': {
      if (state.activeBlockType !== 'thinking') {
        openBlock('thinking');
      }
      frames.push(
        sseEvent('content_block_delta', {
          type: 'content_block_delta',
          index: state.activeBlockIndex,
          delta: { type: 'thinking_delta', thinking: event.delta },
        })
      );
      break;
    }

    case 'thinking_end': {
      // The block will be closed on the next different block or on done
      break;
    }

    case 'text_start': {
      openBlock('text');
      break;
    }

    case 'text_delta': {
      if (state.activeBlockType !== 'text') {
        openBlock('text');
      }
      frames.push(
        sseEvent('content_block_delta', {
          type: 'content_block_delta',
          index: state.activeBlockIndex,
          delta: { type: 'text_delta', text: event.delta },
        })
      );
      break;
    }

    case 'text_end': {
      // Closed lazily
      break;
    }

    case 'toolcall_start': {
      // Get tool info from the partial message at contentIndex
      const partialBlock = event.partial.content[event.contentIndex];
      const tc = partialBlock?.type === 'toolCall' ? (partialBlock as ToolCall) : null;
      openBlock('tool_use', { id: tc?.id ?? '', name: tc?.name ?? '' });
      break;
    }

    case 'toolcall_delta': {
      if (state.activeBlockType !== 'tool_use') {
        // Shouldn't happen, but open defensively
        openBlock('tool_use');
      }
      frames.push(
        sseEvent('content_block_delta', {
          type: 'content_block_delta',
          index: state.activeBlockIndex,
          delta: { type: 'input_json_delta', partial_json: event.delta },
        })
      );
      break;
    }

    case 'toolcall_end': {
      // Closed lazily
      break;
    }

    case 'done': {
      closeCurrentBlock();
      const finalUsage = event.message.usage;
      frames.push(
        sseEvent('message_delta', {
          type: 'message_delta',
          delta: {
            stop_reason: mapStopReason(event.reason),
            stop_sequence: null,
          },
          usage: {
            output_tokens: finalUsage.output,
          },
        })
      );
      frames.push(sseEvent('message_stop', { type: 'message_stop' }));
      break;
    }

    case 'error': {
      closeCurrentBlock();
      frames.push(
        sseEvent('message_delta', {
          type: 'message_delta',
          delta: { stop_reason: 'error', stop_sequence: null },
          usage: { output_tokens: 0 },
        })
      );
      frames.push(sseEvent('message_stop', { type: 'message_stop' }));
      break;
    }

    default:
      // text_start, text_end, thinking_start, thinking_end, toolcall_end
      // already handled above or intentionally produce no frames
      break;
  }

  return frames;
}

/** Terminal frame — Anthropic streams don't use `data: [DONE]` */
export const ANTHROPIC_STREAM_END = '';
