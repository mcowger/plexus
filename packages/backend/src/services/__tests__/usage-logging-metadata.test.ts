import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { registerSpy } from '../../../test/test-utils';
import { PassThrough } from 'stream';
import { UsageInspector } from '../inspectors/usage-logging';
import { DebugLoggingInspector } from '../inspectors/debug-logging';
import { DebugManager } from '../observability/debug-manager';
import type { UsageRecord } from '../../types/usage';

describe('UsageInspector Metadata Robustness', () => {
  let mockStorage: any;
  let mockPricing: any;

  beforeEach(() => {
    mockStorage = {
      saveRequest: vi.fn(() => Promise.resolve()),
      updatePerformanceMetrics: vi.fn(() => Promise.resolve()),
    };
    mockPricing = {
      inputCostPerToken: 0,
      outputCostPerToken: 0,
    };
    const dm = DebugManager.getInstance();
    dm.resetForTesting();
    dm.setEnabled(true);
  });

  afterEach(() => {
    const dm = DebugManager.getInstance();
    dm.setEnabled(false);
  });

  const runInspector = async (
    requestId: string,
    apiType: string,
    snapshot: any
  ): Promise<UsageRecord | null> => {
    const inspector = new UsageInspector(
      requestId,
      mockStorage,
      { requestId } as Partial<UsageRecord>,
      mockPricing,
      undefined,
      Date.now(),
      false,
      apiType,
      undefined,
      undefined
    );

    const dm = DebugManager.getInstance();
    dm.startLog(requestId, {});
    dm.addReconstructedRawResponse(requestId, snapshot);

    let capturedRecord: UsageRecord | null = null;
    registerSpy(mockStorage, 'saveRequest').mockImplementation(async (record: UsageRecord) => {
      capturedRecord = record;
      return Promise.resolve();
    });

    const mockStream = new PassThrough();
    mockStream.pipe(inspector);
    mockStream.end();

    await new Promise((resolve) => setTimeout(resolve, 50));
    return capturedRecord;
  };

  it('should extract tool call count from OpenAI non-streaming choices[0].message.tool_calls', async () => {
    const requestId = 'openai-nonstream-tools';
    const snapshot = {
      choices: [
        { message: { content: '...', tool_calls: [{}, {}, {}] }, finish_reason: 'tool_calls' },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 20 },
    };

    const record = await runInspector(requestId, 'chat', snapshot);
    expect(record?.toolCallsCount).toBe(3);
    expect(record?.finishReason).toBe('tool_calls');
  });

  it('should extract tool call count from Gemini-in-OpenAI mixed format', async () => {
    const requestId = 'gemini-mixed-format';
    // This snapshot looks like chat (apiType='chat') but contains gemini 'candidates'
    const snapshot = {
      candidates: [
        {
          content: { parts: [{ text: 'thinking' }, { functionCall: { name: 'f1' } }] },
          finishReason: 'STOP',
        },
      ],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20 },
    };

    const record = await runInspector(requestId, 'chat', snapshot);
    expect(record?.toolCallsCount).toBe(1);
    expect(record?.finishReason).toBe('tool_calls');
  });

  it('should normalize Gemini "STOP" finish reason to "tool_calls" when tools are present', async () => {
    const requestId = 'gemini-stop-with-tools';
    const snapshot = {
      candidates: [
        {
          content: { parts: [{ text: 'thinking' }, { functionCall: { name: 'f1' } }] },
          finishReason: 'STOP',
        },
      ],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20 },
    };

    const record = await runInspector(requestId, 'gemini', snapshot);
    expect(record?.toolCallsCount).toBe(1);
    expect(record?.finishReason).toBe('tool_calls');
  });

  it('should normalize Gemini "STOP" to "tool_use" when incoming API is Anthropic messages', async () => {
    const requestId = 'gemini-to-anthropic-tools';
    const snapshot = {
      candidates: [
        {
          content: { parts: [{ text: 'thinking' }, { functionCall: { name: 'f1' } }] },
          finishReason: 'STOP',
        },
      ],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20 },
    };

    // runInspector(requestId, apiType, snapshot)
    // apiType here is the provider API type ('gemini')
    // We need to simulate the inspector being initialized with incomingApiType='messages'
    const inspector = new UsageInspector(
      requestId,
      mockStorage,
      { requestId } as Partial<UsageRecord>,
      mockPricing,
      undefined,
      Date.now(),
      false,
      'gemini', // providerApiType
      'messages', // incomingApiType
      undefined // originalRequest
    );

    const dm = DebugManager.getInstance();
    dm.startLog(requestId, {});
    dm.addReconstructedRawResponse(requestId, snapshot);

    let capturedRecord: any = null;
    registerSpy(mockStorage, 'saveRequest').mockImplementation(async (record: any) => {
      capturedRecord = record;
      return Promise.resolve();
    });

    const mockStream = new PassThrough();
    mockStream.pipe(inspector);
    mockStream.end();

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(capturedRecord?.toolCallsCount).toBe(1);
    expect(capturedRecord?.finishReason).toBe('tool_use');
  });

  it('should extract tool call count from Anthropic messages format', async () => {
    const requestId = 'anthropic-metadata';
    const snapshot = {
      content: [
        { type: 'text', text: 'using tool' },
        { type: 'tool_use', id: 't1' },
        { type: 'tool_use', id: 't2' },
      ],
      stop_reason: 'tool_use',
      usage: { input_tokens: 10, output_tokens: 20 },
    };

    const record = await runInspector(requestId, 'messages', snapshot);
    expect(record?.toolCallsCount).toBe(2);
    expect(record?.finishReason).toBe('tool_use');
  });

  it('should handle generic fallback for unknown formats', async () => {
    const requestId = 'generic-fallback';
    const snapshot = {
      tool_calls: [{}, {}],
      finish_reason: 'something_else',
      usage: { prompt_tokens: 10, completion_tokens: 20 },
    };

    const record = await runInspector(requestId, 'unknown-api', snapshot);
    expect(record?.toolCallsCount).toBe(2);
    expect(record?.finishReason).toBe('something_else');
  });

  describe('Responses API status → finishReason mapping', () => {
    // Mirrors the reconstructed snapshot shape produced by
    // DebugLoggingInspector.updateResponsesSnapshot for the same
    // response.created -> response.output_text.delta -> response.failed
    // stream exercised in debug-logging-reconstruction.test.ts.
    it('should map a failed Responses API stream to finishReason "error" with non-zero usage', async () => {
      const requestId = 'responses-failed-stream';
      const snapshot = {
        id: 'resp_test123',
        object: 'response',
        status: 'failed',
        model: 'gpt-4o',
        output: [
          {
            id: 'msg_1',
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'Partial answer before it broke' }],
          },
        ],
        error: { code: 'server_error', message: 'The model response failed to complete.' },
        usage: {
          input_tokens: 42,
          output_tokens: 8,
          total_tokens: 50,
          input_tokens_details: { cached_tokens: 0 },
          output_tokens_details: { reasoning_tokens: 0 },
        },
      };

      const record = await runInspector(requestId, 'responses', snapshot);
      expect(record?.finishReason).toBe('error');
      expect(record?.tokensInput).toBe(42);
      expect(record?.tokensOutput).toBe(8);
    });

    // Mirrors the reconstructed snapshot shape produced by
    // DebugLoggingInspector.updateResponsesSnapshot for the same
    // response.created -> response.output_text.delta -> response.incomplete
    // stream exercised in debug-logging-reconstruction.test.ts.
    it('should map an incomplete Responses API stream (max_output_tokens) to finishReason "length" with non-zero usage', async () => {
      const requestId = 'responses-incomplete-max-tokens-stream';
      const snapshot = {
        id: 'resp_test789',
        object: 'response',
        status: 'incomplete',
        model: 'gpt-4o',
        output: [
          {
            id: 'msg_1',
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'Truncated answer that ran out of ' }],
          },
        ],
        incomplete_details: { reason: 'max_output_tokens' },
        usage: {
          input_tokens: 30,
          output_tokens: 16,
          total_tokens: 46,
          input_tokens_details: { cached_tokens: 0 },
          output_tokens_details: { reasoning_tokens: 0 },
        },
      };

      const record = await runInspector(requestId, 'responses', snapshot);
      expect(record?.finishReason).toBe('length');
      expect(record?.tokensInput).toBe(30);
      expect(record?.tokensOutput).toBe(16);
    });

    it('should map an incomplete Responses API stream (content_filter) to finishReason "content_filter"', async () => {
      const requestId = 'responses-incomplete-content-filter-stream';
      const snapshot = {
        id: 'resp_test999',
        object: 'response',
        status: 'incomplete',
        model: 'gpt-4o',
        output: [
          {
            id: 'msg_1',
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'Cut off by the content filter' }],
          },
        ],
        incomplete_details: { reason: 'content_filter' },
        usage: {
          input_tokens: 25,
          output_tokens: 4,
          total_tokens: 29,
          input_tokens_details: { cached_tokens: 0 },
          output_tokens_details: { reasoning_tokens: 0 },
        },
      };

      const record = await runInspector(requestId, 'responses', snapshot);
      expect(record?.finishReason).toBe('content_filter');
      expect(record?.tokensInput).toBe(25);
      expect(record?.tokensOutput).toBe(4);
    });

    it('should default an incomplete Responses API stream with an unknown/absent reason to finishReason "length"', async () => {
      const requestId = 'responses-incomplete-unknown-reason-stream';
      const snapshot = {
        id: 'resp_test000',
        object: 'response',
        status: 'incomplete',
        model: 'gpt-4o',
        output: [],
        // No incomplete_details at all — must still default sensibly instead
        // of leaking 'incomplete' or throwing on the optional chain.
        usage: {
          input_tokens: 12,
          output_tokens: 1,
          total_tokens: 13,
          input_tokens_details: { cached_tokens: 0 },
          output_tokens_details: { reasoning_tokens: 0 },
        },
      };

      const record = await runInspector(requestId, 'responses', snapshot);
      expect(record?.finishReason).toBe('length');
    });

    it('should record a failed Responses API stream carrying NO usage with finishReason "error" and zero tokens (optional-usage behavior locked in)', async () => {
      // Mirrors the response.failed-without-usage stream exercised in
      // debug-logging-reconstruction.test.ts: the reconstruction keeps usage
      // absent, so usage-logging must record no tokens (and must not throw).
      const requestId = 'responses-failed-no-usage-stream';
      const snapshot = {
        id: 'resp_nousage_1',
        object: 'response',
        status: 'failed',
        model: 'gpt-4o',
        output: [
          {
            id: 'msg_1',
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'Partial answer before it broke' }],
          },
        ],
        error: { code: 'server_error', message: 'The model response failed to complete.' },
        // No usage at all — the upstream failed before reporting any.
      };

      const record = await runInspector(requestId, 'responses', snapshot);
      expect(record?.finishReason).toBe('error');
      expect(record?.tokensInput).toBe(0);
      expect(record?.tokensOutput).toBe(0);
      expect(record?.tokensReasoning).toBe(0);
    });

    it('should still map a completed Responses API stream to finishReason "stop" (regression)', async () => {
      const requestId = 'responses-completed-stream';
      const snapshot = {
        id: 'resp_test456',
        object: 'response',
        status: 'completed',
        model: 'gpt-4o',
        output: [
          {
            id: 'msg_1',
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'Full answer' }],
          },
        ],
        usage: {
          input_tokens: 42,
          output_tokens: 20,
          total_tokens: 62,
          input_tokens_details: { cached_tokens: 0 },
          output_tokens_details: { reasoning_tokens: 0 },
        },
      };

      const record = await runInspector(requestId, 'responses', snapshot);
      expect(record?.finishReason).toBe('stop');
      expect(record?.tokensInput).toBe(42);
      expect(record?.tokensOutput).toBe(20);
    });

    it('should map completed Responses API tool calls to finishReason "tool_calls"', async () => {
      const requestId = 'responses-completed-tool-call-stream';
      const snapshot = {
        id: 'resp_tools',
        object: 'response',
        status: 'completed',
        model: 'gpt-5-codex',
        output: [
          {
            id: 'fc_1',
            type: 'function_call',
            call_id: 'call_1',
            name: 'lookup',
            arguments: '{}',
            status: 'completed',
          },
          {
            id: 'ct_1',
            type: 'custom_tool_call',
            call_id: 'call_2',
            name: 'apply_patch',
            input: '*** Begin Patch',
            status: 'completed',
          },
        ],
        usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
      };

      const record = await runInspector(requestId, 'responses', snapshot);
      expect(record?.toolCallsCount).toBe(2);
      expect(record?.finishReason).toBe('tool_calls');
    });
  });

  describe('usage fallback to the transformed-mode snapshot', () => {
    // The raw-mode reconstruction stays authoritative; the transformed-mode
    // snapshot (written by the client-facing DebugLoggingInspector, keyed by
    // the CLIENT api type) is only consulted when raw yields no usage at all.
    const runInspectorWithSnapshots = async (
      requestId: string,
      options: {
        providerApiType: string;
        incomingApiType?: string;
        rawSnapshot?: any;
        transformedSnapshot?: any;
      }
    ): Promise<UsageRecord | null> => {
      const inspector = new UsageInspector(
        requestId,
        mockStorage,
        { requestId } as Partial<UsageRecord>,
        mockPricing,
        undefined,
        Date.now(),
        false,
        options.providerApiType,
        options.incomingApiType,
        undefined
      );

      const dm = DebugManager.getInstance();
      dm.startLog(requestId, {});
      if (options.rawSnapshot !== undefined) {
        dm.addReconstructedRawResponse(requestId, options.rawSnapshot);
      }
      if (options.transformedSnapshot !== undefined) {
        dm.addTransformedResponseSnapshot(requestId, options.transformedSnapshot);
      }

      let capturedRecord: UsageRecord | null = null;
      registerSpy(mockStorage, 'saveRequest').mockImplementation(async (record: UsageRecord) => {
        capturedRecord = record;
        return Promise.resolve();
      });

      const mockStream = new PassThrough();
      mockStream.pipe(inspector);
      mockStream.end();

      await new Promise((resolve) => setTimeout(resolve, 50));
      return capturedRecord;
    };

    const responsesRawSnapshotWithUsage = () => ({
      id: 'resp_raw_1',
      object: 'response',
      status: 'completed',
      model: 'gpt-4o',
      output: [
        {
          id: 'msg_1',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'Full answer' }],
        },
      ],
      usage: {
        input_tokens: 42,
        output_tokens: 8,
        total_tokens: 50,
        input_tokens_details: { cached_tokens: 0 },
        output_tokens_details: { reasoning_tokens: 0 },
      },
    });

    // Transformed snapshot as reconstructed for a CHAT-format client.
    const chatTransformedSnapshotWithUsage = () => ({
      id: 'chatcmpl_t1',
      object: 'chat.completion.chunk',
      model: 'gpt-4o',
      choices: [{ index: 0, delta: { role: 'assistant', content: 'Full answer' } }],
      usage: { prompt_tokens: 21, completion_tokens: 7, total_tokens: 28 },
    });

    it('raw reconstruction with usage stays authoritative — the transformed snapshot is ignored', async () => {
      const record = await runInspectorWithSnapshots('fallback-raw-authoritative', {
        providerApiType: 'responses',
        incomingApiType: 'chat',
        rawSnapshot: responsesRawSnapshotWithUsage(),
        transformedSnapshot: chatTransformedSnapshotWithUsage(),
      });

      expect(record?.tokensInput).toBe(42);
      expect(record?.tokensOutput).toBe(8);
    });

    it('falls back to the transformed-mode snapshot when NO raw reconstruction exists', async () => {
      const record = await runInspectorWithSnapshots('fallback-raw-absent', {
        providerApiType: 'responses',
        incomingApiType: 'chat',
        transformedSnapshot: chatTransformedSnapshotWithUsage(),
      });

      expect(record?.tokensInput).toBe(21);
      expect(record?.tokensOutput).toBe(7);
    });

    it('falls back when the raw reconstruction exists but carries no usage (metadata still from raw)', async () => {
      const record = await runInspectorWithSnapshots('fallback-raw-usageless', {
        providerApiType: 'responses',
        incomingApiType: 'chat',
        rawSnapshot: {
          id: 'resp_raw_2',
          object: 'response',
          status: 'failed',
          model: 'gpt-4o',
          output: [],
          error: { code: 'server_error', message: 'boom' },
          // No usage block at all.
        },
        transformedSnapshot: chatTransformedSnapshotWithUsage(),
      });

      // Tokens from the transformed snapshot...
      expect(record?.tokensInput).toBe(21);
      expect(record?.tokensOutput).toBe(7);
      // ...while response metadata still comes from the raw reconstruction.
      expect(record?.finishReason).toBe('error');
    });

    it('records no tokens when both snapshots are absent (current behavior unchanged)', async () => {
      const record = await runInspectorWithSnapshots('fallback-both-absent', {
        providerApiType: 'responses',
        incomingApiType: 'chat',
      });

      expect(record).not.toBeNull();
      expect(record?.tokensInput).toBeUndefined();
      expect(record?.tokensOutput).toBeUndefined();
    });

    it('records no tokens when the raw reconstruction is usage-less and no transformed snapshot exists (current behavior unchanged)', async () => {
      const record = await runInspectorWithSnapshots('fallback-raw-usageless-no-transformed', {
        providerApiType: 'responses',
        incomingApiType: 'chat',
        rawSnapshot: {
          id: 'resp_raw_3',
          object: 'response',
          status: 'failed',
          model: 'gpt-4o',
          output: [],
          error: { code: 'server_error', message: 'boom' },
        },
      });

      expect(record?.tokensInput).toBe(0);
      expect(record?.tokensOutput).toBe(0);
      expect(record?.finishReason).toBe('error');
    });

    describe('destroyed/cancelled streams (_destroy) use the same raw-then-transformed read', () => {
      // Same scenarios as runInspectorWithSnapshots, but the stream is
      // DESTROYED (client disconnect/cancel) instead of ending normally, so
      // finalization goes through _destroy rather than _flush — and the
      // snapshots are produced through the REAL write path: provider/client
      // bytes written through DebugLoggingInspector taps that are
      // `finalize()`d before the destroy, exactly as response-handler.ts's
      // onDisconnect teardown does. (Pre-seeding the DebugManager directly
      // would paper over the production gap this guards against: a cancelled
      // web TransformStream never runs its flush, so the taps' 'end' handlers
      // never fire — without the explicit finalize, _destroy would find NO
      // snapshots at all on a real cancellation.) `pricing` (default
      // mockPricing) lets tests assert whether calculateCosts ran: when it
      // runs it always stamps costSource/costTotal, when it doesn't both
      // stay undefined.
      const runDestroyedInspectorWithCapturedBodies = async (
        requestId: string,
        options: {
          providerApiType: string;
          incomingApiType?: string;
          /** Provider-format body written through the RAW debug tap. */
          rawBody?: string;
          /** Client-format body written through the TRANSFORMED debug tap. */
          transformedBody?: string;
          pricing?: any;
        }
      ): Promise<UsageRecord | null> => {
        const inspector = new UsageInspector(
          requestId,
          mockStorage,
          { requestId } as Partial<UsageRecord>,
          options.pricing ?? mockPricing,
          undefined,
          Date.now(),
          false,
          options.providerApiType,
          options.incomingApiType,
          undefined
        );

        const dm = DebugManager.getInstance();
        dm.startLog(requestId, {});

        const rawDebugLogging = new DebugLoggingInspector(requestId, 'raw');
        const rawTap = rawDebugLogging.createInspector(options.providerApiType);
        if (options.rawBody !== undefined) {
          rawTap.write(options.rawBody);
        }

        const transformedDebugLogging = new DebugLoggingInspector(requestId, 'transformed');
        const transformedTap = transformedDebugLogging.createInspector(
          options.incomingApiType ?? 'chat'
        );
        if (options.transformedBody !== undefined) {
          transformedTap.write(options.transformedBody);
        }

        let capturedRecord: UsageRecord | null = null;
        registerSpy(mockStorage, 'saveRequest').mockImplementation(async (record: UsageRecord) => {
          capturedRecord = record;
          return Promise.resolve();
        });

        // Mirror response-handler.ts onDisconnect(): the taps' 'end' events
        // never fire on a cancellation, so the captures are finalized
        // explicitly BEFORE the usage inspector is destroyed.
        rawDebugLogging.finalize();
        transformedDebugLogging.finalize();
        inspector.destroy();

        await new Promise((resolve) => setTimeout(resolve, 50));
        return capturedRecord;
      };

      const responsesRawBodyWithUsage = () => JSON.stringify(responsesRawSnapshotWithUsage());

      const responsesRawBodyWithoutUsage = () =>
        JSON.stringify({
          id: 'resp_raw_d1',
          object: 'response',
          status: 'failed',
          model: 'gpt-4o',
          output: [],
          error: { code: 'server_error', message: 'boom' },
          // No usage block at all.
        });

      // Client-facing chat SSE, as the transformed tap sees it — the usage
      // arrives on the final chunk, but the stream is destroyed before the
      // tap's flush would ever run.
      const chatTransformedSseWithUsage = () =>
        'data: {"id":"chatcmpl_t1","object":"chat.completion.chunk","model":"gpt-4o","choices":[{"index":0,"delta":{"role":"assistant","content":"Full answer"}}]}\n\n' +
        'data: {"id":"chatcmpl_t1","object":"chat.completion.chunk","model":"gpt-4o","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":21,"completion_tokens":7,"total_tokens":28}}\n\n';

      it('raw reconstruction with usage stays authoritative on a destroyed stream (regression)', async () => {
        const record = await runDestroyedInspectorWithCapturedBodies('destroy-raw-authoritative', {
          providerApiType: 'responses',
          incomingApiType: 'chat',
          rawBody: responsesRawBodyWithUsage(),
          transformedBody: chatTransformedSseWithUsage(),
        });

        expect(record?.responseStatus).toBe('cancelled');
        expect(record?.tokensInput).toBe(42);
        expect(record?.tokensOutput).toBe(8);
      });

      it('falls back to the transformed-mode snapshot when NO raw reconstruction exists', async () => {
        const record = await runDestroyedInspectorWithCapturedBodies('destroy-raw-absent', {
          providerApiType: 'responses',
          incomingApiType: 'chat',
          transformedBody: chatTransformedSseWithUsage(),
          pricing: { source: 'simple', input: 1000, output: 2000 },
        });

        expect(record?.responseStatus).toBe('cancelled');
        expect(record?.tokensInput).toBe(21);
        expect(record?.tokensOutput).toBe(7);
        // Costs are calculated over the fallback tokens too — "tokens
        // recorded" must mean a fully finalized record, not tokens with a
        // missing cost: 21/1M * $1000 + 7/1M * $2000 = $0.035.
        expect(record?.costSource).toBe('simple');
        expect(record?.costTotal).toBe(0.035);
      });

      it('falls back when the raw reconstruction exists but carries no usage', async () => {
        const record = await runDestroyedInspectorWithCapturedBodies('destroy-raw-usageless', {
          providerApiType: 'responses',
          incomingApiType: 'chat',
          rawBody: responsesRawBodyWithoutUsage(),
          transformedBody: chatTransformedSseWithUsage(),
        });

        expect(record?.tokensInput).toBe(21);
        expect(record?.tokensOutput).toBe(7);
      });

      it('records no tokens when nothing was captured on either tap (current behavior unchanged)', async () => {
        const record = await runDestroyedInspectorWithCapturedBodies('destroy-both-absent', {
          providerApiType: 'responses',
          incomingApiType: 'chat',
          pricing: { source: 'simple', input: 1000, output: 2000 },
        });

        expect(record).not.toBeNull();
        expect(record?.responseStatus).toBe('cancelled');
        expect(record?.tokensInput).toBeUndefined();
        expect(record?.tokensOutput).toBeUndefined();
        // With neither source, cost calculation must not run at all — even
        // with pricing configured (calculateCosts always stamps costSource
        // when it runs).
        expect(record?.costSource).toBeUndefined();
        expect(record?.costTotal).toBeUndefined();
      });

      it('a usage-less raw reconstruction with no transformed snapshot still runs cost calculation (current behavior preserved)', async () => {
        const record = await runDestroyedInspectorWithCapturedBodies(
          'destroy-raw-usageless-no-transformed',
          {
            providerApiType: 'responses',
            incomingApiType: 'chat',
            rawBody: responsesRawBodyWithoutUsage(),
            pricing: { source: 'simple', input: 1000, output: 2000 },
          }
        );

        // No tokens from anywhere...
        expect(record?.tokensInput).toBeUndefined();
        // ...but calculateCosts still ran over the (zero) token counts,
        // exactly as it did before the readObservedUsage refactor whenever a
        // raw reconstruction existed.
        expect(record?.costSource).toBe('simple');
        expect(record?.costTotal).toBe(0);
      });

      it('finalize() is idempotent — a later stream end after the teardown finalize does not double-capture', async () => {
        const requestId = 'destroy-finalize-idempotent';
        const dm = DebugManager.getInstance();
        dm.startLog(requestId, {});

        const transformedDebugLogging = new DebugLoggingInspector(requestId, 'transformed');
        const tap = transformedDebugLogging.createInspector('chat');
        tap.write(chatTransformedSseWithUsage());

        transformedDebugLogging.finalize();
        const first = dm.getPendingLog(requestId)?.transformedResponseSnapshot;
        expect(first?.usage?.prompt_tokens).toBe(21);

        // A straggler write + end() after the teardown finalize must not
        // corrupt or re-run the capture.
        tap.write('data: {"bogus":true}\n\n');
        tap.end();
        await new Promise((resolve) => setTimeout(resolve, 20));

        const second = dm.getPendingLog(requestId)?.transformedResponseSnapshot;
        expect(second).toBe(first);
      });
    });
  });

  describe('estimation must not overwrite extracted usage (estimateTokens: true)', () => {
    // When `estimateTokens: true` is configured for a provider, estimation is
    // a FALLBACK for responses that carried no usage at all — it must never
    // replace real usage extracted from the raw reconstruction or the
    // transformed-snapshot fallback. (For a 'responses' provider the
    // estimator has no dialect support and returns zeros, so the overwrite
    // corrupted costs/quota to zero output tokens.)
    const runEstimatingInspectorWithSnapshots = async (
      requestId: string,
      options: {
        providerApiType: string;
        incomingApiType?: string;
        rawSnapshot?: any;
        transformedSnapshot?: any;
        pricing?: any;
      }
    ): Promise<UsageRecord | null> => {
      const inspector = new UsageInspector(
        requestId,
        mockStorage,
        { requestId } as Partial<UsageRecord>,
        options.pricing ?? mockPricing,
        undefined,
        Date.now(),
        true, // shouldEstimateTokens
        options.providerApiType,
        options.incomingApiType,
        undefined
      );

      const dm = DebugManager.getInstance();
      dm.startLog(requestId, {});
      if (options.rawSnapshot !== undefined) {
        dm.addReconstructedRawResponse(requestId, options.rawSnapshot);
      }
      if (options.transformedSnapshot !== undefined) {
        dm.addTransformedResponseSnapshot(requestId, options.transformedSnapshot);
      }

      let capturedRecord: UsageRecord | null = null;
      registerSpy(mockStorage, 'saveRequest').mockImplementation(async (record: UsageRecord) => {
        capturedRecord = record;
        return Promise.resolve();
      });

      const mockStream = new PassThrough();
      mockStream.pipe(inspector);
      mockStream.end();

      await new Promise((resolve) => setTimeout(resolve, 50));
      return capturedRecord;
    };

    it('transformed-snapshot usage survives estimation (raw usage-less responses reconstruction)', async () => {
      const record = await runEstimatingInspectorWithSnapshots('estimate-transformed-survives', {
        providerApiType: 'responses',
        incomingApiType: 'chat',
        rawSnapshot: {
          id: 'resp_est_1',
          object: 'response',
          status: 'completed',
          model: 'gpt-4o',
          output: [
            {
              id: 'msg_1',
              type: 'message',
              role: 'assistant',
              content: [{ type: 'output_text', text: 'Full answer' }],
            },
          ],
          // No usage block at all.
        },
        transformedSnapshot: {
          id: 'chatcmpl_est_1',
          object: 'chat.completion.chunk',
          model: 'gpt-4o',
          choices: [{ index: 0, delta: { role: 'assistant', content: 'Full answer' } }],
          usage: { prompt_tokens: 21, completion_tokens: 7, total_tokens: 28 },
        },
        pricing: { source: 'simple', input: 1000, output: 2000 },
      });

      // The transformed-snapshot counts survive (the 'responses' estimator
      // would have zeroed them)...
      expect(record?.tokensInput).toBe(21);
      expect(record?.tokensOutput).toBe(7);
      // ...they are not flagged as estimated...
      expect(record?.tokensEstimated).not.toBe(1);
      // ...and costs are computed from them:
      // 21/1M * $1000 + 7/1M * $2000 = $0.035.
      expect(record?.costSource).toBe('simple');
      expect(record?.costTotal).toBe(0.035);
    });

    it('raw-reconstruction usage survives estimation (chat provider that DID report usage)', async () => {
      const record = await runEstimatingInspectorWithSnapshots('estimate-raw-survives', {
        providerApiType: 'chat',
        incomingApiType: 'chat',
        rawSnapshot: {
          id: 'chatcmpl_est_2',
          object: 'chat.completion',
          model: 'gpt-4o',
          choices: [
            { index: 0, message: { role: 'assistant', content: 'Hello!' }, finish_reason: 'stop' },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
        },
      });

      expect(record?.tokensInput).toBe(100);
      expect(record?.tokensOutput).toBe(50);
      expect(record?.tokensEstimated).not.toBe(1);
    });

    it('estimation still runs when NO usage was extracted from either source (fallback preserved)', async () => {
      // Streamed-reconstruction shape (delta-based) — the shape the chat
      // estimator reads content from.
      const record = await runEstimatingInspectorWithSnapshots('estimate-still-runs', {
        providerApiType: 'chat',
        incomingApiType: 'chat',
        rawSnapshot: {
          id: 'chatcmpl_est_3',
          object: 'chat.completion.chunk',
          model: 'gpt-4o',
          choices: [
            {
              index: 0,
              delta: {
                role: 'assistant',
                content: 'A reasonably long answer with enough words to estimate.',
              },
              finish_reason: 'stop',
            },
          ],
          // No usage block anywhere, and no transformed snapshot.
        },
      });

      expect(record?.tokensEstimated).toBe(1);
      expect(record?.tokensOutput).toBeGreaterThan(0);
    });
  });
});
