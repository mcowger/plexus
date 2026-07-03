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
  | { type: 'thinking'; thinking: string; signature?: string }
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

/** Full `message_start.message.usage` shape, including the nested cache_creation split. */
function buildStartUsage(u: Usage | undefined) {
  const cacheWrite = u?.cacheWrite ?? 0;
  const cacheWrite1h = u?.cacheWrite1h ?? 0;
  const cacheWrite5m = Math.max(0, cacheWrite - cacheWrite1h);
  return {
    input_tokens: u?.input ?? 0,
    output_tokens: u?.output ?? 0,
    cache_read_input_tokens: u?.cacheRead ?? 0,
    cache_creation_input_tokens: cacheWrite,
    cache_creation: {
      ephemeral_5m_input_tokens: cacheWrite5m,
      ephemeral_1h_input_tokens: cacheWrite1h,
    },
  };
}

/** Full `message_delta.usage` shape, including input/cache tokens and thinking-token breakdown. */
function buildDeltaUsage(u: Usage) {
  const usage: Record<string, unknown> = {
    input_tokens: u.input,
    output_tokens: u.output,
    cache_read_input_tokens: u.cacheRead,
    cache_creation_input_tokens: u.cacheWrite,
  };
  if (u.reasoning != null) {
    usage.output_tokens_details = { thinking_tokens: u.reasoning };
  }
  return usage;
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
      const tb = block as ThinkingContent;
      thinkingBlocks.push({
        type: 'thinking',
        thinking: tb.thinking,
        ...(tb.thinkingSignature ? { signature: tb.thinkingSignature } : {}),
      });
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
  /** Index into the pi-ai partial message's `content` array for the active block */
  activeContentIndex: number | null;
  /** tool_call id of the active tool_use block */
  activeToolId: string | null;
  sentStart: boolean;
  /** True after the 'start' event, until message_start has actually been flushed */
  pendingStart: boolean;
}

export function makeAnthropicChunkSerialiserState(model: string): AnthropicChunkSerialiserState {
  return {
    messageId: makeMessageId(),
    model,
    nextBlockIndex: 0,
    activeBlockType: null,
    activeBlockIndex: null,
    activeContentIndex: null,
    activeToolId: null,
    sentStart: false,
    pendingStart: false,
  };
}

/** Encode one SSE event as `event: <name>\ndata: <json>\n\n` */
function sseEvent(name: string, data: unknown): string {
  return `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * pi-ai emits its 'start' event before reading any bytes from the upstream
 * response, so `usage` is always zero at that point even though Anthropic's
 * own message_start carries real input/cache-read token counts. Real usage
 * only lands in `output.usage` once the upstream message_start SSE has been
 * processed, which happens synchronously before the *next* pi-ai event is
 * emitted. So we defer sending our message_start until that next event,
 * using its usage snapshot.
 */
function usageFromEvent(event: AssistantMessageEvent): Usage | undefined {
  if (event.type === 'done') return event.message.usage;
  if (event.type === 'error') return event.error.usage;
  if ('partial' in event) return event.partial.usage;
  return undefined;
}

/** The assistant message's content array, regardless of which event shape carries it. */
function contentFromEvent(event: AssistantMessageEvent): AssistantMessage['content'] | undefined {
  if (event.type === 'done') return event.message.content;
  if (event.type === 'error') return event.error.content;
  if ('partial' in event) return event.partial.content;
  return undefined;
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

  /** Flush the deferred message_start (+ ping) using the best usage snapshot available. */
  const ensureStarted = () => {
    if (!state.pendingStart) return;
    state.pendingStart = false;
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
          usage: buildStartUsage(usageFromEvent(event)),
        },
      })
    );
    frames.push(sseEvent('ping', { type: 'ping' }));
  };

  const closeCurrentBlock = () => {
    if (state.activeBlockType !== null && state.activeBlockIndex !== null) {
      if (state.activeBlockType === 'thinking' && state.activeContentIndex !== null) {
        const content = contentFromEvent(event);
        const block = content?.[state.activeContentIndex];
        const signature =
          block?.type === 'thinking' ? (block as ThinkingContent).thinkingSignature : undefined;
        if (signature) {
          frames.push(
            sseEvent('content_block_delta', {
              type: 'content_block_delta',
              index: state.activeBlockIndex,
              delta: { type: 'signature_delta', signature },
            })
          );
        }
      }
      frames.push(
        sseEvent('content_block_stop', {
          type: 'content_block_stop',
          index: state.activeBlockIndex,
        })
      );
      state.activeBlockType = null;
      state.activeBlockIndex = null;
      state.activeContentIndex = null;
      state.activeToolId = null;
    }
  };

  const openBlock = (
    type: 'text' | 'thinking' | 'tool_use',
    extra?: { id?: string; name?: string; contentIndex?: number }
  ) => {
    closeCurrentBlock();
    const index = state.nextBlockIndex++;
    state.activeBlockIndex = index;
    state.activeBlockType = type;
    state.activeContentIndex = extra?.contentIndex ?? null;

    let content_block: Record<string, unknown>;
    if (type === 'text') {
      content_block = { type: 'text', text: '' };
    } else if (type === 'thinking') {
      content_block = { type: 'thinking', thinking: '', signature: '' };
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
      // Real usage isn't available yet (pi-ai emits 'start' before reading any
      // upstream bytes) — defer message_start until the next event, which by
      // then has the upstream message_start's usage merged into `partial.usage`.
      state.sentStart = true;
      state.pendingStart = true;
      break;
    }

    case 'thinking_start': {
      ensureStarted();
      openBlock('thinking', { contentIndex: event.contentIndex });
      break;
    }

    case 'thinking_delta': {
      ensureStarted();
      if (state.activeBlockType !== 'thinking') {
        openBlock('thinking', { contentIndex: event.contentIndex });
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
      // The block (and its signature_delta) is closed on the next different
      // block or on done — see closeCurrentBlock.
      break;
    }

    case 'text_start': {
      ensureStarted();
      openBlock('text');
      break;
    }

    case 'text_delta': {
      ensureStarted();
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
      ensureStarted();
      // Get tool info from the partial message at contentIndex
      const partialBlock = event.partial.content[event.contentIndex];
      const tc = partialBlock?.type === 'toolCall' ? (partialBlock as ToolCall) : null;
      openBlock('tool_use', { id: tc?.id ?? '', name: tc?.name ?? '' });
      break;
    }

    case 'toolcall_delta': {
      ensureStarted();
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
      ensureStarted();
      closeCurrentBlock();
      frames.push(
        sseEvent('message_delta', {
          type: 'message_delta',
          delta: {
            stop_reason: mapStopReason(event.reason),
            stop_sequence: null,
          },
          usage: buildDeltaUsage(event.message.usage),
        })
      );
      frames.push(sseEvent('message_stop', { type: 'message_stop' }));
      break;
    }

    case 'error': {
      ensureStarted();
      closeCurrentBlock();
      frames.push(
        sseEvent('message_delta', {
          type: 'message_delta',
          delta: { stop_reason: 'error', stop_sequence: null },
          usage: buildDeltaUsage(event.error.usage),
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
