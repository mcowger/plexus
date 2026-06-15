/**
 * T4.2 — Outbound serialiser: pi-ai AssistantMessage / AssistantMessageEvent
 * → OpenAI Responses API wire format.
 *
 * Non-streaming response shape:
 *   { id, object:"response", status:"completed", model, output:[...], usage:{...} }
 *
 *   output items (matching ResponsesTransformer.formatResponse order):
 *     reasoning → { type:"reasoning", id, status:"completed", content:[{type:"reasoning_text"}], summary:[{type:"summary_text"}] }
 *     text      → { type:"message",   id, status:"completed", role:"assistant", content:[{type:"output_text", text}] }
 *     tool_use  → { type:"function_call", id, status:"completed", call_id, name, arguments }
 *
 * Streaming event sequence (mirrors ResponsesTransformer.formatStream):
 *   response.created → response.in_progress →
 *   [response.output_item.added → response.content_part.added → response.output_text.delta* →
 *    response.output_text.done → response.content_part.done → response.output_item.done]  (text)
 *   [response.output_item.added → response.function_call_arguments.delta* →
 *    response.output_item.done]  (tool call)
 *   [response.reasoning_text.delta* → response.reasoning_text.done → response.output_item.done] (thinking)
 *   response.completed
 */

import type {
  AssistantMessage,
  AssistantMessageEvent,
  Usage,
  TextContent,
  ThinkingContent,
  ToolCall,
} from '@earendil-works/pi-ai';

// ─── ID generators (match ResponsesTransformer style) ────────────────────────

function generateResponseId(): string {
  return `resp_${Date.now().toString(36)}${Math.random().toString(36).substring(2, 15)}`;
}

function generateItemId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).substring(2, 15)}`;
}

// ─── Responses usage shape ────────────────────────────────────────────────────

function mapUsage(u: Usage): Record<string, unknown> {
  return {
    input_tokens: u.input + u.cacheRead + u.cacheWrite,
    input_tokens_details: { cached_tokens: u.cacheRead },
    output_tokens: u.output,
    output_tokens_details: { reasoning_tokens: 0 },
    total_tokens: u.totalTokens,
  };
}

// ─── Non-streaming serialiser ─────────────────────────────────────────────────

export function messageToResponsesObject(
  message: AssistantMessage,
  modelAlias: string,
  responseId?: string,
  wantsSummary?: boolean
): Record<string, unknown> {
  const id = responseId ?? generateResponseId();
  const createdAt = Math.floor(Date.now() / 1000);
  const output: Record<string, unknown>[] = [];

  // Error / aborted
  if (message.stopReason === 'error' || message.stopReason === 'aborted') {
    output.push({
      type: 'message',
      id: generateItemId('msg'),
      status: 'completed',
      role: 'assistant',
      content: [
        {
          type: 'output_text',
          text: message.errorMessage ?? 'An upstream error occurred.',
          annotations: [],
        },
      ],
    });
    return {
      id,
      object: 'response',
      created_at: createdAt,
      completed_at: createdAt,
      status: 'completed',
      model: modelAlias,
      output,
      usage: mapUsage(message.usage),
    };
  }

  // Collect blocks by type
  let thinkingText = '';
  let textContent = '';
  const toolCalls: ToolCall[] = [];

  for (const block of message.content) {
    if (block.type === 'thinking') thinkingText += (block as ThinkingContent).thinking;
    else if (block.type === 'text') textContent += (block as TextContent).text;
    else if (block.type === 'toolCall') toolCalls.push(block as ToolCall);
  }

  // Reasoning item (if summary requested and thinking present)
  if (thinkingText && wantsSummary) {
    output.push({
      type: 'reasoning',
      id: generateItemId('rs'),
      status: 'completed',
      content: [{ type: 'reasoning_text', text: thinkingText }],
      summary: [{ type: 'summary_text', text: thinkingText }],
    });
  }

  // Tool calls
  for (const tc of toolCalls) {
    output.push({
      type: 'function_call',
      id: generateItemId('fc'),
      status: 'completed',
      call_id: tc.id,
      name: tc.name,
      arguments: JSON.stringify(tc.arguments ?? {}),
    });
  }

  // Text message
  output.push({
    type: 'message',
    id: generateItemId('msg'),
    status: 'completed',
    role: 'assistant',
    content: [{ type: 'output_text', text: textContent, annotations: [] }],
  });

  return {
    id,
    object: 'response',
    created_at: createdAt,
    completed_at: createdAt,
    status: 'completed',
    model: modelAlias,
    output,
    usage: mapUsage(message.usage),
  };
}

// ─── Streaming serialiser ─────────────────────────────────────────────────────

export interface ResponsesChunkSerialiserState {
  responseId: string;
  model: string;
  createdAt: number;
  sequenceNumber: number;
  // Text item tracking
  messageItemId: string | null;
  messageOutputIndex: number | null;
  messagePartAdded: boolean;
  messageText: string;
  // Thinking / reasoning tracking
  reasoningItemId: string | null;
  reasoningOutputIndex: number | null;
  reasoningText: string;
  // Tool call tracking (map by toolCallArrayIndex → output info)
  toolItemIds: Map<number, string>;
  toolOutputIndices: Map<number, number>;
  toolCallIds: Map<number, string>;
  toolNames: Map<number, string>;
  toolArgs: Map<number, string>;
  toolCallArrayIndex: number;
  // Output index counter
  nextOutputIndex: number;
  // Lifecycle flags
  sentCreated: boolean;
  sentInProgress: boolean;
}

export function makeResponsesChunkSerialiserState(model: string): ResponsesChunkSerialiserState {
  return {
    responseId: generateResponseId(),
    model,
    createdAt: Math.floor(Date.now() / 1000),
    sequenceNumber: 0,
    messageItemId: null,
    messageOutputIndex: null,
    messagePartAdded: false,
    messageText: '',
    reasoningItemId: null,
    reasoningOutputIndex: null,
    reasoningText: '',
    toolItemIds: new Map(),
    toolOutputIndices: new Map(),
    toolCallIds: new Map(),
    toolNames: new Map(),
    toolArgs: new Map(),
    toolCallArrayIndex: -1,
    nextOutputIndex: 0,
    sentCreated: false,
    sentInProgress: false,
  };
}

function sseEvent(type: string, data: Record<string, unknown>, seq: number): string {
  return `event: ${type}\ndata: ${JSON.stringify({ ...data, type, sequence_number: seq })}\n\n`;
}

function reserveOutputIndex(state: ResponsesChunkSerialiserState): number {
  return state.nextOutputIndex++;
}

function ensureCreated(state: ResponsesChunkSerialiserState): string[] {
  if (state.sentCreated) return [];
  state.sentCreated = true;
  return [
    sseEvent(
      'response.created',
      {
        response: {
          id: state.responseId,
          object: 'response',
          created_at: state.createdAt,
          status: 'in_progress',
          model: state.model,
          output: [],
        },
      },
      state.sequenceNumber++
    ),
  ];
}

function ensureInProgress(state: ResponsesChunkSerialiserState): string[] {
  if (state.sentInProgress) return [];
  state.sentInProgress = true;
  return [
    sseEvent(
      'response.in_progress',
      {
        response: {
          id: state.responseId,
          object: 'response',
          created_at: state.createdAt,
          status: 'in_progress',
          model: state.model,
          output: [],
        },
      },
      state.sequenceNumber++
    ),
  ];
}

function ensureMessageItem(state: ResponsesChunkSerialiserState): string[] {
  if (state.messageItemId !== null) return [];
  state.messageOutputIndex = reserveOutputIndex(state);
  state.messageItemId = generateItemId('msg');
  const frames: string[] = [];
  frames.push(
    sseEvent(
      'response.output_item.added',
      {
        output_index: state.messageOutputIndex,
        item: {
          id: state.messageItemId,
          type: 'message',
          status: 'in_progress',
          role: 'assistant',
          content: [],
        },
      },
      state.sequenceNumber++
    )
  );
  if (!state.messagePartAdded) {
    frames.push(
      sseEvent(
        'response.content_part.added',
        {
          output_index: state.messageOutputIndex,
          item_id: state.messageItemId,
          content_index: 0,
          part: { type: 'output_text', annotations: [], logprobs: [], text: '' },
        },
        state.sequenceNumber++
      )
    );
    state.messagePartAdded = true;
  }
  return frames;
}

function ensureReasoningItem(state: ResponsesChunkSerialiserState): string[] {
  if (state.reasoningItemId !== null) return [];
  state.reasoningOutputIndex = reserveOutputIndex(state);
  state.reasoningItemId = generateItemId('rs');
  return [
    sseEvent(
      'response.output_item.added',
      {
        output_index: state.reasoningOutputIndex,
        item: {
          id: state.reasoningItemId,
          type: 'reasoning',
          status: 'in_progress',
          content: [],
          summary: [],
        },
      },
      state.sequenceNumber++
    ),
  ];
}

function ensureToolItem(
  state: ResponsesChunkSerialiserState,
  tcIdx: number,
  tc: ToolCall | null
): string[] {
  if (state.toolOutputIndices.has(tcIdx)) return [];
  const outputIndex = reserveOutputIndex(state);
  const callId = tc?.id ?? generateItemId('call');
  const itemId = generateItemId('fc');
  const name = tc?.name ?? '';
  state.toolOutputIndices.set(tcIdx, outputIndex);
  state.toolCallIds.set(tcIdx, callId);
  state.toolItemIds.set(tcIdx, itemId);
  state.toolNames.set(tcIdx, name);
  state.toolArgs.set(tcIdx, '');
  return [
    sseEvent(
      'response.output_item.added',
      {
        output_index: outputIndex,
        item: {
          id: itemId,
          type: 'function_call',
          status: 'in_progress',
          call_id: callId,
          name,
          arguments: '',
        },
      },
      state.sequenceNumber++
    ),
  ];
}

/**
 * Convert one AssistantMessageEvent to Responses SSE frames.
 */
export function eventToResponsesSSE(
  event: AssistantMessageEvent,
  state: ResponsesChunkSerialiserState
): string[] {
  const frames: string[] = [];

  switch (event.type) {
    case 'start': {
      frames.push(...ensureCreated(state));
      frames.push(...ensureInProgress(state));
      break;
    }

    case 'thinking_delta': {
      frames.push(...ensureCreated(state));
      frames.push(...ensureInProgress(state));
      frames.push(...ensureReasoningItem(state));
      state.reasoningText += event.delta;
      frames.push(
        sseEvent(
          'response.reasoning_text.delta',
          {
            output_index: state.reasoningOutputIndex as number,
            item_id: state.reasoningItemId,
            content_index: 0,
            delta: event.delta,
          },
          state.sequenceNumber++
        )
      );
      break;
    }

    case 'text_delta': {
      frames.push(...ensureCreated(state));
      frames.push(...ensureInProgress(state));
      frames.push(...ensureMessageItem(state));
      state.messageText += event.delta;
      frames.push(
        sseEvent(
          'response.output_text.delta',
          {
            output_index: state.messageOutputIndex as number,
            item_id: state.messageItemId,
            content_index: 0,
            delta: event.delta,
            logprobs: [],
          },
          state.sequenceNumber++
        )
      );
      break;
    }

    case 'toolcall_start': {
      frames.push(...ensureCreated(state));
      frames.push(...ensureInProgress(state));
      state.toolCallArrayIndex++;
      const idx = state.toolCallArrayIndex;
      const partial = event.partial.content[event.contentIndex];
      const tc = partial?.type === 'toolCall' ? (partial as ToolCall) : null;
      frames.push(...ensureToolItem(state, idx, tc));
      break;
    }

    case 'toolcall_delta': {
      const idx = state.toolCallArrayIndex;
      const prevArgs = state.toolArgs.get(idx) ?? '';
      state.toolArgs.set(idx, prevArgs + event.delta);
      frames.push(
        sseEvent(
          'response.function_call_arguments.delta',
          {
            output_index: state.toolOutputIndices.get(idx) as number,
            item_id: state.toolItemIds.get(idx),
            delta: event.delta,
          },
          state.sequenceNumber++
        )
      );
      break;
    }

    case 'done': {
      // Finalize reasoning item
      if (state.reasoningItemId !== null && state.reasoningOutputIndex !== null) {
        frames.push(
          sseEvent(
            'response.reasoning_text.done',
            {
              output_index: state.reasoningOutputIndex,
              item_id: state.reasoningItemId,
              content_index: 0,
              text: state.reasoningText,
            },
            state.sequenceNumber++
          )
        );
        frames.push(
          sseEvent(
            'response.output_item.done',
            {
              output_index: state.reasoningOutputIndex,
              item: {
                id: state.reasoningItemId,
                type: 'reasoning',
                status: 'completed',
                content: state.reasoningText
                  ? [{ type: 'reasoning_text', text: state.reasoningText }]
                  : [],
                summary: [],
              },
            },
            state.sequenceNumber++
          )
        );
      }

      // Finalize message item
      if (state.messageItemId !== null && state.messageOutputIndex !== null) {
        frames.push(
          sseEvent(
            'response.output_text.done',
            {
              output_index: state.messageOutputIndex,
              item_id: state.messageItemId,
              content_index: 0,
              logprobs: [],
              text: state.messageText,
            },
            state.sequenceNumber++
          )
        );
        frames.push(
          sseEvent(
            'response.content_part.done',
            {
              output_index: state.messageOutputIndex,
              item_id: state.messageItemId,
              content_index: 0,
              part: {
                type: 'output_text',
                annotations: [],
                logprobs: [],
                text: state.messageText,
              },
            },
            state.sequenceNumber++
          )
        );
        frames.push(
          sseEvent(
            'response.output_item.done',
            {
              output_index: state.messageOutputIndex,
              item: {
                id: state.messageItemId,
                type: 'message',
                status: 'completed',
                role: 'assistant',
                content: [
                  {
                    type: 'output_text',
                    annotations: [],
                    logprobs: [],
                    text: state.messageText,
                  },
                ],
              },
            },
            state.sequenceNumber++
          )
        );
      }

      // Finalize tool items
      for (const [idx, outputIndex] of state.toolOutputIndices.entries()) {
        const args = state.toolArgs.get(idx) ?? '';
        const name = state.toolNames.get(idx) ?? '';
        const callId = state.toolCallIds.get(idx) ?? '';
        const itemId = state.toolItemIds.get(idx) ?? '';
        frames.push(
          sseEvent(
            'response.output_item.done',
            {
              output_index: outputIndex,
              item: {
                id: itemId,
                type: 'function_call',
                status: 'completed',
                call_id: callId,
                name,
                arguments: args,
              },
            },
            state.sequenceNumber++
          )
        );
      }

      // response.completed
      const usage = event.message.usage;
      frames.push(
        sseEvent(
          'response.completed',
          {
            response: {
              id: state.responseId,
              object: 'response',
              created_at: state.createdAt,
              status: 'completed',
              model: state.model,
              output: [], // clients reconstruct from item.done events
              usage: mapUsage(usage),
            },
          },
          state.sequenceNumber++
        )
      );
      break;
    }

    case 'error': {
      // Emit a minimal completed event with error
      frames.push(
        sseEvent(
          'response.completed',
          {
            response: {
              id: state.responseId,
              object: 'response',
              created_at: state.createdAt,
              status: 'failed',
              model: state.model,
              output: [],
              error: {
                type: 'api_error',
                message: event.error.errorMessage ?? 'Upstream error',
              },
            },
          },
          state.sequenceNumber++
        )
      );
      break;
    }

    // text_start, text_end, thinking_start, thinking_end, toolcall_end — no frames
    default:
      break;
  }

  return frames;
}
