import { describe, expect, it } from 'vitest';
import {
  createStreamVisibilityTracker,
  EMPTY_COMPLETION_REASON,
  getResponseVisibilitySignals,
  isEmptyCompletion,
  isEmptyUnifiedResponse,
  isStreamEmpty,
  observeStreamChunk,
  type StreamVisibilityTracker,
} from '../empty-completion';
import { ResponsesTransformer } from '../../../transformers/responses';
import type { UnifiedChatResponse } from '../../../types/unified';

// A bare, all-absent UnifiedChatResponse — the "truly empty" fixture shared
// by several tests below.
function emptyResponse(): UnifiedChatResponse {
  return {
    id: 'resp-1',
    model: 'model-1',
    content: null,
  };
}

describe('isEmptyCompletion (pure signal decision)', () => {
  it('text-only is non-empty', () => {
    expect(isEmptyCompletion({ hasText: true })).toBe(false);
  });

  it('tool-call-only is non-empty', () => {
    expect(isEmptyCompletion({ toolCallCount: 1 })).toBe(false);
  });

  it('reasoning-only is non-empty', () => {
    expect(isEmptyCompletion({ hasReasoning: true })).toBe(false);
  });

  it('image-only is non-empty', () => {
    expect(isEmptyCompletion({ imageCount: 1 })).toBe(false);
  });

  it('citations-only (annotation-only) is non-empty', () => {
    expect(isEmptyCompletion({ annotationCount: 1 })).toBe(false);
  });

  it('truly empty (no signals at all) is empty', () => {
    expect(isEmptyCompletion({})).toBe(true);
  });

  it('all-zero/false signals explicitly are still empty', () => {
    expect(
      isEmptyCompletion({
        hasText: false,
        hasReasoning: false,
        toolCallCount: 0,
        annotationCount: 0,
        imageCount: 0,
      })
    ).toBe(true);
  });
});

describe('getResponseVisibilitySignals / isEmptyUnifiedResponse (non-streaming adapter)', () => {
  it('text-only response is non-empty', () => {
    const response: UnifiedChatResponse = { ...emptyResponse(), content: 'Hello there' };
    expect(isEmptyUnifiedResponse(response)).toBe(false);
    expect(getResponseVisibilitySignals(response).hasText).toBe(true);
  });

  it('whitespace-only content is still treated as empty text', () => {
    const response: UnifiedChatResponse = { ...emptyResponse(), content: '   \n\t  ' };
    expect(isEmptyUnifiedResponse(response)).toBe(true);
  });

  it('tool-call-only response is non-empty', () => {
    const response: UnifiedChatResponse = {
      ...emptyResponse(),
      tool_calls: [
        { id: 'call_1', type: 'function', function: { name: 'lookup', arguments: '{}' } },
      ],
    };
    expect(isEmptyUnifiedResponse(response)).toBe(false);
  });

  it('reasoning-only (reasoning_content) response is non-empty', () => {
    const response: UnifiedChatResponse = {
      ...emptyResponse(),
      reasoning_content: 'thinking it through...',
    };
    expect(isEmptyUnifiedResponse(response)).toBe(false);
  });

  it('reasoning-only (thinking.content) response is non-empty', () => {
    const response: UnifiedChatResponse = {
      ...emptyResponse(),
      thinking: { content: 'pondering...' },
    };
    expect(isEmptyUnifiedResponse(response)).toBe(false);
  });

  it('image-only response is non-empty (forward-compatible `images` field)', () => {
    // UnifiedChatResponse has no `images` field today — no transformer
    // populates one — but the signals adapter reads it defensively so a
    // future multimodal chat-output field is picked up without code changes
    // here. Cast to exercise that path directly.
    const response = {
      ...emptyResponse(),
      images: [{ data: 'base64...' }],
    } as UnifiedChatResponse & {
      images: unknown[];
    };
    expect(isEmptyUnifiedResponse(response)).toBe(false);
  });

  it('citations-only (annotations) response is non-empty', () => {
    const response: UnifiedChatResponse = {
      ...emptyResponse(),
      annotations: [
        {
          type: 'url_citation',
          url_citation: {
            url: 'https://example.com',
            title: 'Example',
            content: 'snippet',
            start_index: 0,
            end_index: 10,
          },
        },
      ],
    };
    expect(isEmptyUnifiedResponse(response)).toBe(false);
  });

  it('truly empty response (no text/tool-calls/reasoning/images/annotations) is empty', () => {
    expect(isEmptyUnifiedResponse(emptyResponse())).toBe(true);
  });

  it('empty string content, empty tool_calls array, and empty annotations array are still empty', () => {
    const response: UnifiedChatResponse = {
      ...emptyResponse(),
      content: '',
      tool_calls: [],
      annotations: [],
    };
    expect(isEmptyUnifiedResponse(response)).toBe(true);
  });
});

describe('isEmptyUnifiedResponse — terminal finish reasons are never retryable-empty', () => {
  // A `content_filter` (or other terminal) response with null content is a
  // deliberate provider/safety decision, NOT "the model produced nothing on
  // an ordinary turn" — classifying it as empty routes the request around
  // that decision via failover to a different provider instead of relaying
  // it to the client, which is exactly the bug this guards against.
  it('content_filter finish reason with no visible output is NOT empty (no failover)', () => {
    const response: UnifiedChatResponse = {
      ...emptyResponse(),
      content: null,
      finishReason: 'content_filter',
    };
    expect(isEmptyUnifiedResponse(response)).toBe(false);
  });

  it('length finish reason with no visible output is NOT empty', () => {
    const response: UnifiedChatResponse = {
      ...emptyResponse(),
      content: null,
      finishReason: 'length',
    };
    expect(isEmptyUnifiedResponse(response)).toBe(false);
  });

  it('an error/refusal-shaped finish reason with no visible output is NOT empty', () => {
    const response: UnifiedChatResponse = {
      ...emptyResponse(),
      content: null,
      finishReason: 'error',
    };
    expect(isEmptyUnifiedResponse(response)).toBe(false);

    const refusal: UnifiedChatResponse = {
      ...emptyResponse(),
      content: null,
      finishReason: 'refusal',
    };
    expect(isEmptyUnifiedResponse(refusal)).toBe(false);
  });

  it('a terminal finish reason takes precedence even if a signal WOULD otherwise look empty', () => {
    // Guards against a future refactor accidentally checking signals first.
    const response: UnifiedChatResponse = {
      ...emptyResponse(),
      content: '',
      tool_calls: [],
      finishReason: 'content_filter',
    };
    expect(isEmptyUnifiedResponse(response)).toBe(false);
  });

  it('absent finish reason with no visible output STILL fails over (existing behavior guarded)', () => {
    // No finishReason set at all (undefined) — the pre-existing "truly
    // empty" case. Must remain retryable-empty.
    expect(isEmptyUnifiedResponse(emptyResponse())).toBe(true);
  });

  it('null finish reason with no visible output STILL fails over (existing behavior guarded)', () => {
    const response: UnifiedChatResponse = {
      ...emptyResponse(),
      content: null,
      finishReason: null,
    };
    expect(isEmptyUnifiedResponse(response)).toBe(true);
  });

  it('"stop" finish reason with no visible output STILL fails over (existing behavior guarded)', () => {
    const response: UnifiedChatResponse = {
      ...emptyResponse(),
      content: '',
      finishReason: 'stop',
    };
    expect(isEmptyUnifiedResponse(response)).toBe(true);
  });

  it('"end_turn" (Anthropic-style stop) finish reason with no visible output STILL fails over', () => {
    const response: UnifiedChatResponse = {
      ...emptyResponse(),
      content: '',
      finishReason: 'end_turn',
    };
    expect(isEmptyUnifiedResponse(response)).toBe(true);
  });

  it('a terminal finish reason does not suppress a genuinely non-empty response either way', () => {
    // Sanity check: a content_filter response that DOES have visible text
    // (e.g. a partial answer before the cutoff) is non-empty regardless.
    const response: UnifiedChatResponse = {
      ...emptyResponse(),
      content: 'partial answer before cutoff',
      finishReason: 'content_filter',
    };
    expect(isEmptyUnifiedResponse(response)).toBe(false);
  });
});

describe('getResponseVisibilitySignals / isEmptyUnifiedResponse — image_generation_call visibility (rawResponse / bypass path)', () => {
  // The Responses API returns `image_generation_call` output items
  // (types/responses.ts ResponsesBuiltInToolCallItem). On the
  // bypass-transformation path the unified response carries no typed items —
  // `rawResponse` (populated by dispatcher.ts's handleNonStreamingResponse)
  // is the ORIGINAL body available at the call seam; detect the built-in
  // tool call there. It also covers result-less items, which get no typed
  // carry on the transformed path but still prove the model produced output.
  it('image_generation_call-only rawResponse is non-empty (no failover)', () => {
    const response = {
      ...emptyResponse(),
      rawResponse: {
        id: 'resp-img-1',
        object: 'response',
        output: [
          {
            type: 'image_generation_call',
            id: 'ig_1',
            status: 'completed',
            result: 'base64-image-data',
          },
        ],
      },
    } as UnifiedChatResponse;

    expect(getResponseVisibilitySignals(response).imageCount).toBe(1);
    expect(isEmptyUnifiedResponse(response)).toBe(false);
  });

  it('a rawResponse with no image_generation_call items contributes zero imageCount', () => {
    const response = {
      ...emptyResponse(),
      rawResponse: {
        id: 'resp-text-1',
        object: 'response',
        output: [{ type: 'message', id: 'msg_1', status: 'completed', content: [] }],
      },
    } as UnifiedChatResponse;

    expect(getResponseVisibilitySignals(response).imageCount).toBe(0);
    expect(isEmptyUnifiedResponse(response)).toBe(true);
  });

  it('multiple image_generation_call items are all counted', () => {
    const response = {
      ...emptyResponse(),
      rawResponse: {
        output: [
          { type: 'image_generation_call', id: 'ig_1', status: 'completed' },
          { type: 'image_generation_call', id: 'ig_2', status: 'completed' },
        ],
      },
    } as UnifiedChatResponse;

    expect(getResponseVisibilitySignals(response).imageCount).toBe(2);
  });

  it('a rawResponse with no output array (or no rawResponse at all) does not throw and counts zero', () => {
    expect(getResponseVisibilitySignals(emptyResponse()).imageCount).toBe(0);
    expect(
      getResponseVisibilitySignals({ ...emptyResponse(), rawResponse: {} } as UnifiedChatResponse)
        .imageCount
    ).toBe(0);
    expect(
      getResponseVisibilitySignals({
        ...emptyResponse(),
        rawResponse: { output: 'not-an-array' },
      } as UnifiedChatResponse).imageCount
    ).toBe(0);
  });

  it('the forward-compat `images` array field and rawResponse image_generation_call items both contribute to imageCount', () => {
    const response = {
      ...emptyResponse(),
      images: [{ data: 'base64...' }],
      rawResponse: {
        output: [{ type: 'image_generation_call', id: 'ig_1', status: 'completed' }],
      },
    } as UnifiedChatResponse & { images: unknown[] };

    expect(getResponseVisibilitySignals(response).imageCount).toBe(2);
  });
});

describe('getResponseVisibilitySignals / isEmptyUnifiedResponse — typed image_generation_calls signal (transformed path)', () => {
  // With PURE unified content (image markdown is composed by the
  // client-facing formatters, never baked into `content`), an image-only
  // TRANSFORMED (non-bypass) response has no text and no rawResponse — the
  // typed `image_generation_calls` carry is its only visibility signal.
  it('typed image_generation_calls with a non-empty result count as visible output (no failover)', () => {
    const response = {
      ...emptyResponse(),
      image_generation_calls: [{ id: 'ig_1', status: 'completed', result: 'aGVsbG8=' }],
    } as UnifiedChatResponse;

    expect(getResponseVisibilitySignals(response).imageCount).toBe(1);
    expect(isEmptyUnifiedResponse(response)).toBe(false);
  });

  it('multiple typed entries are all counted', () => {
    const response = {
      ...emptyResponse(),
      image_generation_calls: [
        { id: 'ig_1', status: 'completed', result: 'aGVsbG8=' },
        { id: 'ig_2', status: 'completed', result: 'd29ybGQ=' },
      ],
    } as UnifiedChatResponse;

    expect(getResponseVisibilitySignals(response).imageCount).toBe(2);
  });

  it('typed entries with an empty or missing result contribute zero (defensive)', () => {
    const response = {
      ...emptyResponse(),
      image_generation_calls: [{ id: 'ig_1', status: 'completed', result: '' }, { id: 'ig_2' }],
    } as any;

    expect(getResponseVisibilitySignals(response).imageCount).toBe(0);
    expect(isEmptyUnifiedResponse(response)).toBe(true);
  });

  it('typed entries combine with the rawResponse count (bypass path unchanged)', () => {
    const response = {
      ...emptyResponse(),
      image_generation_calls: [{ id: 'ig_1', status: 'completed', result: 'aGVsbG8=' }],
      rawResponse: {
        output: [{ type: 'image_generation_call', id: 'ig_2', status: 'completed' }],
      },
    } as UnifiedChatResponse;

    expect(getResponseVisibilitySignals(response).imageCount).toBe(2);
  });

  // End-to-end across the two layers: a REAL ResponsesTransformer transform
  // of an image-only completion (the transformed/non-bypass dispatch path —
  // no rawResponse attached) must read as non-empty purely via the typed
  // carry, since pure unified content gives it no text signal. This is the
  // regression lock for the production empty-completion bug: if the typed
  // signal ever regresses, image-only completions would be misclassified as
  // empty and failed over again.
  it('a real transformed image-only Responses completion is NOT empty (typed carry is the only signal)', async () => {
    const unified = await new ResponsesTransformer().transformResponse({
      id: 'resp_img_transformed',
      object: 'response',
      created_at: 1,
      status: 'completed',
      model: 'image-model',
      output: [
        { type: 'image_generation_call', id: 'ig_1', status: 'completed', result: 'aGVsbG8=' },
      ],
    });

    // Pure content, no raw body: the typed carry must be what keeps this
    // visible.
    expect(unified.content).toBeNull();
    expect(unified.rawResponse).toBeUndefined();
    expect(getResponseVisibilitySignals(unified).imageCount).toBe(1);
    expect(isEmptyUnifiedResponse(unified)).toBe(false);
  });
});

describe('createStreamVisibilityTracker / observeStreamChunk / isStreamEmpty (streaming adapter)', () => {
  it('starts empty', () => {
    const tracker = createStreamVisibilityTracker();
    expect(isStreamEmpty(tracker)).toBe(true);
  });

  it('a content delta marks the tracker non-empty', () => {
    const tracker = createStreamVisibilityTracker();
    observeStreamChunk(tracker, { delta: { content: 'Hi' } } as any);
    expect(isStreamEmpty(tracker)).toBe(false);
  });

  it('a whitespace-only content delta does NOT mark the tracker non-empty by itself', () => {
    const tracker = createStreamVisibilityTracker();
    observeStreamChunk(tracker, { delta: { content: '   ' } } as any);
    expect(isStreamEmpty(tracker)).toBe(true);
  });

  it('a tool-call delta marks the tracker non-empty', () => {
    const tracker = createStreamVisibilityTracker();
    observeStreamChunk(tracker, {
      delta: { tool_calls: [{ index: 0, function: { name: 'lookup' } }] },
    } as any);
    expect(isStreamEmpty(tracker)).toBe(false);
  });

  it('a reasoning delta marks the tracker non-empty', () => {
    const tracker = createStreamVisibilityTracker();
    observeStreamChunk(tracker, { delta: { reasoning_content: 'hmm' } } as any);
    expect(isStreamEmpty(tracker)).toBe(false);
  });

  it('a thinking delta marks the tracker non-empty', () => {
    const tracker = createStreamVisibilityTracker();
    observeStreamChunk(tracker, { delta: { thinking: { content: 'hmm' } } } as any);
    expect(isStreamEmpty(tracker)).toBe(false);
  });

  it('chunks with no delta at all leave the tracker empty', () => {
    const tracker = createStreamVisibilityTracker();
    observeStreamChunk(tracker, {} as any);
    observeStreamChunk(tracker, { delta: {} } as any);
    expect(isStreamEmpty(tracker)).toBe(true);
  });

  it('accumulates across multiple chunks: only the last chunk carries content', () => {
    const tracker: StreamVisibilityTracker = createStreamVisibilityTracker();
    observeStreamChunk(tracker, { delta: {} } as any);
    observeStreamChunk(tracker, { delta: {} } as any);
    observeStreamChunk(tracker, { delta: { content: 'answer' } } as any);
    expect(isStreamEmpty(tracker)).toBe(false);
  });
});

describe('observeStreamChunk — chunk-level annotations/images branches (forward-compat contract)', () => {
  // No current transformer streams chunk-level `annotations` or `images`,
  // but the tracker reads both defensively so a future transformer that does
  // is picked up without changes here. These tests pin that contract with
  // synthetic unified chunks. Note both branches sit AFTER the `delta`
  // presence guard, so the synthetic chunks carry an (empty) delta object.
  it('a chunk-level annotations array marks the tracker non-empty', () => {
    const tracker = createStreamVisibilityTracker();
    observeStreamChunk(tracker, {
      delta: {},
      annotations: [
        {
          type: 'url_citation',
          url_citation: { url: 'https://example.com', title: 'Example' },
        },
      ],
    } as any);

    expect(tracker.annotationCount).toBe(1);
    expect(isStreamEmpty(tracker)).toBe(false);
  });

  it('a chunk-level images array marks the tracker non-empty', () => {
    const tracker = createStreamVisibilityTracker();
    observeStreamChunk(tracker, {
      delta: {},
      images: [{ data: 'base64...' }],
    } as any);

    expect(tracker.imageCount).toBe(1);
    expect(isStreamEmpty(tracker)).toBe(false);
  });

  it('annotation and image counts accumulate across chunks', () => {
    const tracker = createStreamVisibilityTracker();
    observeStreamChunk(tracker, {
      delta: {},
      annotations: [{ type: 'url_citation' }, { type: 'url_citation' }],
    } as any);
    observeStreamChunk(tracker, { delta: {}, annotations: [{ type: 'url_citation' }] } as any);
    observeStreamChunk(tracker, { delta: {}, images: [{ data: 'a' }, { data: 'b' }] } as any);
    observeStreamChunk(tracker, { delta: {}, images: [{ data: 'c' }] } as any);

    expect(tracker.annotationCount).toBe(3);
    expect(tracker.imageCount).toBe(3);
    expect(isStreamEmpty(tracker)).toBe(false);
  });

  it('empty annotations/images arrays (and non-array values) leave the tracker empty', () => {
    const tracker = createStreamVisibilityTracker();
    observeStreamChunk(tracker, { delta: {}, annotations: [], images: [] } as any);
    observeStreamChunk(tracker, {
      delta: {},
      annotations: 'not-an-array',
      images: { data: 'not-an-array' },
    } as any);

    expect(tracker.annotationCount).toBe(0);
    expect(tracker.imageCount).toBe(0);
    expect(isStreamEmpty(tracker)).toBe(true);
  });
});

describe('EMPTY_COMPLETION_REASON', () => {
  it('is the exact reason string documented in the task brief', () => {
    expect(EMPTY_COMPLETION_REASON).toBe('Empty completion (no visible output)');
  });
});
