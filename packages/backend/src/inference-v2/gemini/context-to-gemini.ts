/**
 * T5.2 — Outbound serialiser: pi-ai AssistantMessage / AssistantMessageEvent
 * → Gemini generateContent wire format.
 *
 * Non-streaming response:
 *   {
 *     candidates: [{ content: { role: "model", parts: [...] }, finishReason, index: 0 }],
 *     usageMetadata: { promptTokenCount, candidatesTokenCount, totalTokenCount, ... },
 *     modelVersion?,
 *     responseId?,
 *   }
 *   Parts order: thinking → text → functionCall  (mirrors response-formatter.ts)
 *   thinking parts have `thought: true`.
 *
 * Streaming — NDJSON (one JSON object per line, NOT SSE):
 *   - Each `text_delta` / `thinking_delta` event → one NDJSON line with a
 *     partial candidate containing the delta text.
 *   - Each `toolcall_start` event → one NDJSON line with a functionCall part.
 *   - The `done` event → one NDJSON line that includes usageMetadata.
 *   - All other event types produce no output.
 *
 * The NDJSON format is what the real Gemini API returns for streamGenerateContent.
 * Each line is `JSON.stringify(geminiChunk) + "\n"`.
 *
 * Finish reason mapping:
 *   stop / length / toolUse → "STOP" (Gemini does not use TOOL_CALLS as a
 *   finish reason — tool calls always end with STOP).
 *   error / aborted → "OTHER".
 */

import type {
  AssistantMessage,
  AssistantMessageEvent,
  Usage,
  TextContent,
  ThinkingContent,
  ToolCall,
} from '@earendil-works/pi-ai';

// ─── Gemini wire types ────────────────────────────────────────────────────────

export type GeminiPart =
  | { text: string; thought?: true }
  | { functionCall: { name: string; args: Record<string, unknown> } };

export interface GeminiCandidate {
  content: { role: 'model'; parts: GeminiPart[] };
  finishReason: string | null;
  index: number;
}

export interface GeminiUsageMetadata {
  promptTokenCount: number;
  candidatesTokenCount: number;
  totalTokenCount: number;
  thoughtsTokenCount?: number;
  cachedContentTokenCount?: number;
}

export interface GeminiResponse {
  candidates: GeminiCandidate[];
  usageMetadata?: GeminiUsageMetadata;
  modelVersion?: string;
  responseId?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mapFinishReason(reason: string | undefined): string {
  switch (reason) {
    case 'stop':
    case 'length':
    case 'toolUse':
      return 'STOP';
    case 'error':
    case 'aborted':
      return 'OTHER';
    default:
      return 'STOP';
  }
}

function mapUsage(usage: Usage): GeminiUsageMetadata {
  return {
    promptTokenCount: usage.input + (usage.cacheRead ?? 0),
    candidatesTokenCount: usage.output,
    totalTokenCount: usage.totalTokens,
    ...(usage.cacheRead > 0 ? { cachedContentTokenCount: usage.cacheRead } : {}),
  };
}

function buildParts(message: AssistantMessage): GeminiPart[] {
  const parts: GeminiPart[] = [];

  for (const block of message.content) {
    if (block.type === 'thinking') {
      const tc = block as ThinkingContent;
      parts.push({ text: tc.thinking, thought: true });
    } else if (block.type === 'text') {
      const tc = block as TextContent;
      if (tc.text) parts.push({ text: tc.text });
    } else if (block.type === 'toolCall') {
      const tc = block as ToolCall;
      parts.push({
        functionCall: {
          name: tc.name,
          args: tc.arguments ?? {},
        },
      });
    }
  }

  return parts;
}

// ─── Non-streaming: AssistantMessage → GeminiResponse ────────────────────────

export function messageToGeminiResponse(
  message: AssistantMessage,
  modelAlias: string
): GeminiResponse {
  const parts = buildParts(message);

  // If there are no parts (e.g. error), produce an empty text part to keep the
  // candidate structure valid.
  if (parts.length === 0) {
    const errText =
      message.stopReason === 'error' || message.stopReason === 'aborted'
        ? (message.errorMessage ?? '')
        : '';
    parts.push({ text: errText });
  }

  return {
    candidates: [
      {
        content: { role: 'model', parts },
        finishReason: mapFinishReason(message.stopReason),
        index: 0,
      },
    ],
    usageMetadata: mapUsage(message.usage),
    modelVersion: modelAlias || undefined,
  };
}

// ─── Streaming: AssistantMessageEvent → NDJSON line ──────────────────────────

/**
 * State needed across events to track the accumulated tool-call argument string
 * (pi-ai emits toolcall_delta events for arguments, but Gemini wants the full
 * args object on the functionCall part at toolcall_start — so we buffer until
 * toolcall_end and emit then).
 */
export interface GeminiChunkSerialiserState {
  model: string;
  /** Accumulated args JSON string for the currently streaming tool call */
  pendingToolCallName: string | null;
  pendingToolCallArgs: string;
}

export function makeGeminiChunkSerialiserState(model: string): GeminiChunkSerialiserState {
  return { model, pendingToolCallName: null, pendingToolCallArgs: '' };
}

/**
 * Convert one AssistantMessageEvent to zero or more NDJSON line strings.
 * Each string is a complete JSON object followed by "\n".
 */
export function eventToGeminiNDJSON(
  event: AssistantMessageEvent,
  state: GeminiChunkSerialiserState
): string[] {
  function line(obj: GeminiResponse): string {
    return JSON.stringify(obj) + '\n';
  }

  function partialCandidate(
    parts: GeminiPart[],
    finishReason: string | null = null
  ): GeminiResponse {
    return {
      candidates: [
        {
          content: { role: 'model', parts },
          finishReason,
          index: 0,
        },
      ],
    };
  }

  switch (event.type) {
    case 'start':
      // No output — Gemini streaming doesn't have an explicit start event
      return [];

    case 'text_delta':
      return [line(partialCandidate([{ text: event.delta }]))];

    case 'thinking_delta':
      return [line(partialCandidate([{ text: event.delta, thought: true }]))];

    case 'toolcall_start': {
      // Capture the tool name from the partial; args accumulate via toolcall_delta
      const partial = event.partial.content[event.contentIndex];
      const tc = partial?.type === 'toolCall' ? (partial as ToolCall) : null;
      state.pendingToolCallName = tc?.name ?? '';
      state.pendingToolCallArgs = '';
      // Gemini emits the complete functionCall when args are known (at toolcall_end).
      // Emit nothing here — we'll emit on toolcall_end.
      return [];
    }

    case 'toolcall_delta': {
      state.pendingToolCallArgs += event.delta;
      return [];
    }

    case 'toolcall_end': {
      // Emit the complete functionCall part now that args are fully accumulated
      const name = state.pendingToolCallName ?? '';
      let args: Record<string, unknown> = {};
      if (state.pendingToolCallArgs.trim()) {
        try {
          args = JSON.parse(state.pendingToolCallArgs);
        } catch {
          args = {};
        }
      }
      state.pendingToolCallName = null;
      state.pendingToolCallArgs = '';
      return [line(partialCandidate([{ functionCall: { name, args } }]))];
    }

    case 'done': {
      // Final chunk — include finishReason and usageMetadata
      const hasToolCalls = event.message.content.some((b) => b.type === 'toolCall');
      const finishReason = hasToolCalls ? 'STOP' : mapFinishReason(event.reason);
      const finalChunk: GeminiResponse = {
        candidates: [
          {
            content: { role: 'model', parts: [] },
            finishReason,
            index: 0,
          },
        ],
        usageMetadata: mapUsage(event.message.usage),
        modelVersion: state.model || undefined,
      };
      return [line(finalChunk)];
    }

    case 'error': {
      // Surface error as a text part
      const errMsg = event.error.errorMessage ?? 'Upstream error';
      return [line(partialCandidate([{ text: errMsg }], 'OTHER'))];
    }

    // text_start, text_end, thinking_start, thinking_end → no output
    default:
      return [];
  }
}
