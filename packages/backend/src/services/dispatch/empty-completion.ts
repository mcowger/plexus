import type { UnifiedChatResponse, UnifiedChatStreamChunk } from '../../types/unified';

/**
 * T5 — Empty-completion detection.
 *
 * Plexus never used to inspect completion content: an upstream 200 whose
 * transformed completion has zero user-visible output (no text, no tool
 * calls, no reasoning, no images, no citations) was returned to the client
 * as a successful empty turn. Clients like LobeHub (`ModelEmptyCompletion`)
 * and KiloCode treat that as a hard error.
 *
 * This module is a small, pure, unit-testable core: given a set of
 * "did any visible output show up" signals, decide whether the completion
 * counts as empty. It mirrors the spirit of LobeChat's
 * `isEmptyModelCompletion` — a completion is empty only when NONE of the
 * visible-output categories are present. Grounding/citation-only responses
 * are treated as non-empty as long as at least one annotation/citation is
 * present.
 *
 * Two call sites feed this:
 *   - `standard-attempt-request.ts` (non-streaming): a fully-materialized
 *     `UnifiedChatResponse` is available, so `isEmptyUnifiedResponse` reads
 *     signals straight off it.
 *   - `response-handler.ts` (streaming): the response is consumed
 *     incrementally, so `createStreamVisibilityTracker`/`observeStreamChunk`
 *     accumulate presence flags (never the actual text — see the
 *     buffering-for-retry note in response-handler.ts) as unified stream
 *     chunks pass through, and `isStreamEmpty` makes the same decision once
 *     the stream ends.
 */

/** Reason string used for the non-streaming failover path (attempt-history reason, log messages). */
export const EMPTY_COMPLETION_REASON = 'Empty completion (no visible output)';

/**
 * Presence signals used to decide whether a completion produced any
 * user-visible output. Each flag/count is truthy when that category of
 * output was present anywhere in the completion (a single non-streaming
 * response, or accumulated across an entire stream).
 */
export interface CompletionVisibilitySignals {
  hasText?: boolean;
  hasReasoning?: boolean;
  toolCallCount?: number;
  annotationCount?: number;
  imageCount?: number;
}

/**
 * Pure decision function — no I/O, no side effects. A completion is
 * "empty" only when none of the visible-output signals are present.
 */
export function isEmptyCompletion(signals: CompletionVisibilitySignals): boolean {
  return !(
    signals.hasText ||
    signals.hasReasoning ||
    (signals.toolCallCount ?? 0) > 0 ||
    (signals.annotationCount ?? 0) > 0 ||
    (signals.imageCount ?? 0) > 0
  );
}

/** True when `value` is a string containing at least one non-whitespace character. */
function hasVisibleText(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Shape read from a fully-materialized non-streaming response. Widened
 * (rather than `UnifiedChatResponse` verbatim) so forward-compatible fields
 * not yet on the unified type — e.g. a future `images` array for multimodal
 * chat output — are picked up defensively without requiring a type change
 * here. No current transformer populates the `images` array (Responses image
 * output travels on the typed `image_generation_calls` carry — see
 * countTypedImageGenerationCalls below), so the `images`-array contribution
 * is exercised directly by the unit tests rather than via a real transformer
 * fixture.
 */
type VisibilityCheckableResponse = Pick<
  UnifiedChatResponse,
  | 'content'
  | 'reasoning_content'
  | 'thinking'
  | 'tool_calls'
  | 'annotations'
  | 'finishReason'
  | 'image_generation_calls'
> & { images?: unknown[] | null; rawResponse?: unknown };

/**
 * Counts typed `image_generation_calls` entries with a non-empty base64
 * `result` on the unified response (see UnifiedImageGenerationCall in
 * types/unified.ts). This is the PRIMARY image signal on the transformed
 * (non-bypass) path: unified `content` stays PURE authored text (image
 * markdown is composed per client format by the renderers, never baked into
 * content — see transformers/image-rendering.ts), so an image-only
 * completion has no text and this typed count is what proves the model
 * produced visible output. Without it, image-only completions would be
 * misclassified as empty and needlessly failed over.
 */
function countTypedImageGenerationCalls(
  imageGenerationCalls: UnifiedChatResponse['image_generation_calls']
): number {
  if (!Array.isArray(imageGenerationCalls)) return 0;
  return imageGenerationCalls.filter(
    (imageCall) => typeof imageCall?.result === 'string' && imageCall.result.length > 0
  ).length;
}

/**
 * Counts `image_generation_call` built-in-tool-call output items
 * (types/responses.ts `ResponsesBuiltInToolCallItem`) on a raw (pre-transform)
 * Responses API body. This raw count covers what the typed carry above
 * cannot see: the bypass-transformation path (`rawResponse` is populated by
 * dispatcher.ts's `handleNonStreamingResponse`, the ORIGINAL body available
 * at the empty-completion call seam) and result-less items (an
 * `image_generation_call` without a base64 `result` gets no typed carry but
 * still proves the model produced output).
 */
function countRawImageGenerationCalls(rawResponse: unknown): number {
  const output = (rawResponse as { output?: unknown })?.output;
  if (!Array.isArray(output)) return 0;
  return output.filter((item: any) => item?.type === 'image_generation_call').length;
}

/** Extracts visibility signals from a fully-materialized non-streaming response. */
export function getResponseVisibilitySignals(
  response: VisibilityCheckableResponse
): CompletionVisibilitySignals {
  return {
    hasText: hasVisibleText(response.content),
    hasReasoning:
      hasVisibleText(response.reasoning_content) || hasVisibleText(response.thinking?.content),
    toolCallCount: response.tool_calls?.length ?? 0,
    annotationCount: response.annotations?.length ?? 0,
    imageCount:
      countTypedImageGenerationCalls(response.image_generation_calls) +
      (Array.isArray(response.images) ? response.images.length : 0) +
      countRawImageGenerationCalls(response.rawResponse),
  };
}

/**
 * Finish reasons that represent a NORMAL, retryable-if-empty completion —
 * the model simply produced no visible output on an otherwise-ordinary
 * turn. Absent/null covers responses (and transformers) that don't set a
 * finish reason at all — the pre-existing "truly empty" case, which must
 * stay retryable.
 */
function isRetryableEmptyFinishReason(finishReason: string | null | undefined): boolean {
  return finishReason == null || finishReason === 'stop' || finishReason === 'end_turn';
}

/**
 * Convenience wrapper for the non-streaming dispatch seam
 * (standard-attempt-request.ts). A completion is only "empty" (and thus
 * retryable via failover) when BOTH:
 *   - none of the visible-output signals are present, AND
 *   - the finish reason is a normal one (absent/null/'stop'/'end_turn').
 * Any other finish reason (content_filter, refusal, length, error, etc.) is
 * a TERMINAL, provider-chosen outcome: the provider deliberately ended the
 * turn for a reason unrelated to "the model produced nothing", so treating
 * it as an empty-completion failover would silently route around a
 * safety/terminal decision (e.g. resending a content-filtered prompt to a
 * different provider) instead of relaying it to the client as intended.
 */
export function isEmptyUnifiedResponse(response: VisibilityCheckableResponse): boolean {
  if (!isRetryableEmptyFinishReason(response.finishReason)) return false;
  return isEmptyCompletion(getResponseVisibilitySignals(response));
}

/**
 * Mutable per-stream accumulator for the streaming seam. Tracks only
 * PRESENCE (booleans/counts) — it never holds accumulated text, so it
 * cannot be used to reconstruct or retry the response (streaming can't
 * fail over anyway; headers are already sent by the time this runs).
 */
export interface StreamVisibilityTracker {
  hasText: boolean;
  hasReasoning: boolean;
  toolCallCount: number;
  annotationCount: number;
  imageCount: number;
}

export function createStreamVisibilityTracker(): StreamVisibilityTracker {
  return {
    hasText: false,
    hasReasoning: false,
    toolCallCount: 0,
    annotationCount: 0,
    imageCount: 0,
  };
}

/**
 * Observes a single unified stream chunk, updating the tracker in place.
 * Only inspects `delta.content` / `delta.tool_calls` / `delta.reasoning_content`
 * / `delta.thinking` (plus a defensive, forward-compatible `annotations`/
 * `images` check — no current transformer streams either) — it never
 * stores the actual delta text anywhere.
 */
export function observeStreamChunk(
  tracker: StreamVisibilityTracker,
  chunk: Pick<UnifiedChatStreamChunk, 'delta'> & {
    annotations?: unknown[] | null;
    images?: unknown[] | null;
  }
): void {
  const delta = chunk?.delta;
  if (!delta) return;

  if (hasVisibleText(delta.content)) tracker.hasText = true;
  if (hasVisibleText(delta.reasoning_content) || hasVisibleText(delta.thinking?.content)) {
    tracker.hasReasoning = true;
  }
  if (Array.isArray(delta.tool_calls) && delta.tool_calls.length > 0) {
    // Exact count doesn't matter — isEmptyCompletion only checks for > 0 —
    // so over-counting across multiple arg-delta chunks for the same tool
    // call is harmless.
    tracker.toolCallCount += delta.tool_calls.length;
  }
  if (Array.isArray(chunk.annotations) && chunk.annotations.length > 0) {
    tracker.annotationCount += chunk.annotations.length;
  }
  if (Array.isArray(chunk.images) && chunk.images.length > 0) {
    tracker.imageCount += chunk.images.length;
  }
}

/** Convenience wrapper for the streaming observability seam (response-handler.ts). */
export function isStreamEmpty(tracker: StreamVisibilityTracker): boolean {
  return isEmptyCompletion(tracker);
}
