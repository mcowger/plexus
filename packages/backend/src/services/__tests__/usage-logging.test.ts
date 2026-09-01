import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { registerSpy } from '../../../test/test-utils';
import { PassThrough } from 'stream';
import { UsageInspector } from '../inspectors/usage-logging';
import { DebugLoggingInspector } from '../inspectors/debug-logging';
import { UsageStorageService } from '../observability/usage-storage';
import { DebugManager } from '../observability/debug-manager';
import type { UsageRecord } from '../../types/usage';
import * as quotaMiddleware from '../quota/quota-middleware';

describe('UsageInspector', () => {
  let mockStorage: any;
  let mockPricing: any;

  beforeEach(() => {
    mockStorage = {
      saveRequest: vi.fn(() => Promise.resolve()),
      updatePerformanceMetrics: vi.fn(() => Promise.resolve()),
    };
    mockPricing = {
      inputCostPerToken: 0.00001,
      outputCostPerToken: 0.00003,
    };
  });

  afterEach(() => {
    const dm = DebugManager.getInstance();
    dm.setEnabled(false);
  });

  describe('extractUsageFromReconstructed', () => {
    it('should capture cached_tokens from OpenAI usage response with top-level cached_tokens', async () => {
      const requestId = 'test-request-with-cache-toplevel';
      const startTime = Date.now() - 100;

      const inspector = new UsageInspector(
        requestId,
        mockStorage,
        { requestId } as Partial<UsageRecord>,
        mockPricing,
        undefined,
        startTime,
        false,
        'chat',
        undefined,
        undefined
      );

      const debugManager = DebugManager.getInstance();
      debugManager.setEnabled(true);
      debugManager.startLog(requestId, { messages: [{ role: 'user', content: 'Hello' }] });

      debugManager.addReconstructedRawResponse(requestId, {
        id: 'chatcmpl-abc123',
        object: 'chat.completion',
        created: Date.now(),
        model: 'gpt-4o',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'Hello!' },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 50,
          total_tokens: 150,
          cached_tokens: 25,
        },
      });

      const mockStream = new PassThrough();

      let capturedRecord: UsageRecord | null = null;
      registerSpy(mockStorage, 'saveRequest').mockImplementation(async (record: UsageRecord) => {
        capturedRecord = record;
        return Promise.resolve();
      });

      mockStream.pipe(inspector);
      mockStream.end();

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(capturedRecord).not.toBeNull();
      expect(capturedRecord!.tokensCached).toBe(25);
    });

    it('should capture cached_tokens from OpenAI prompt_tokens_details', async () => {
      const requestId = 'test-request-cache-details';
      const startTime = Date.now() - 100;

      const inspector = new UsageInspector(
        requestId,
        mockStorage,
        { requestId } as Partial<UsageRecord>,
        mockPricing,
        undefined,
        startTime,
        false,
        'chat',
        undefined,
        undefined
      );

      const debugManager = DebugManager.getInstance();
      debugManager.setEnabled(true);
      debugManager.startLog(requestId, { messages: [{ role: 'user', content: 'Hello' }] });

      debugManager.addReconstructedRawResponse(requestId, {
        usage: {
          prompt_tokens: 100,
          completion_tokens: 50,
          total_tokens: 150,
          prompt_tokens_details: {
            cached_tokens: 30,
          },
        },
      });

      const mockStream = new PassThrough();

      let capturedRecord: UsageRecord | null = null;
      registerSpy(mockStorage, 'saveRequest').mockImplementation(async (record: UsageRecord) => {
        capturedRecord = record;
        return Promise.resolve();
      });

      mockStream.pipe(inspector);
      mockStream.end();

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(capturedRecord).not.toBeNull();
      expect(capturedRecord!.tokensCached).toBe(30);
    });

    it('should prefer prompt_tokens_details.cached_tokens when both are present', async () => {
      const requestId = 'test-request-cache-both';
      const startTime = Date.now() - 100;

      const inspector = new UsageInspector(
        requestId,
        mockStorage,
        { requestId } as Partial<UsageRecord>,
        mockPricing,
        undefined,
        startTime,
        false,
        'chat',
        undefined,
        undefined
      );

      const debugManager = DebugManager.getInstance();
      debugManager.setEnabled(true);
      debugManager.startLog(requestId, { messages: [{ role: 'user', content: 'Hello' }] });

      debugManager.addReconstructedRawResponse(requestId, {
        usage: {
          prompt_tokens: 100,
          completion_tokens: 50,
          total_tokens: 150,
          cached_tokens: 20,
          prompt_tokens_details: {
            cached_tokens: 35,
          },
        },
      });

      const mockStream = new PassThrough();

      let capturedRecord: UsageRecord | null = null;
      registerSpy(mockStorage, 'saveRequest').mockImplementation(async (record: UsageRecord) => {
        capturedRecord = record;
        return Promise.resolve();
      });

      mockStream.pipe(inspector);
      mockStream.end();

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(capturedRecord).not.toBeNull();
      expect(capturedRecord!.tokensCached).toBe(35);
    });

    it('should handle Anthropic cache_read_input_tokens', async () => {
      const requestId = 'test-anthropic-cache';
      const startTime = Date.now() - 100;

      const inspector = new UsageInspector(
        requestId,
        mockStorage,
        { requestId } as Partial<UsageRecord>,
        mockPricing,
        undefined,
        startTime,
        false,
        'messages',
        undefined,
        undefined
      );

      const debugManager = DebugManager.getInstance();
      debugManager.setEnabled(true);
      debugManager.startLog(requestId, { messages: [{ role: 'user', content: 'Hello' }] });

      debugManager.addReconstructedRawResponse(requestId, {
        usage: {
          input_tokens: 200,
          output_tokens: 75,
          cache_read_input_tokens: 150,
          cache_creation_input_tokens: 25,
        },
      });

      const mockStream = new PassThrough();

      let capturedRecord: UsageRecord | null = null;
      registerSpy(mockStorage, 'saveRequest').mockImplementation(async (record: UsageRecord) => {
        capturedRecord = record;
        return Promise.resolve();
      });

      mockStream.pipe(inspector);
      mockStream.end();

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(capturedRecord).not.toBeNull();
      expect(capturedRecord!.tokensCached).toBe(150);
      expect(capturedRecord!.tokensCacheWrite).toBe(25);
    });

    it('should handle Gemini cachedContentTokenCount', async () => {
      const requestId = 'test-gemini-cache';
      const startTime = Date.now() - 100;

      const inspector = new UsageInspector(
        requestId,
        mockStorage,
        { requestId } as Partial<UsageRecord>,
        mockPricing,
        undefined,
        startTime,
        false,
        'gemini',
        undefined,
        undefined
      );

      const debugManager = DebugManager.getInstance();
      debugManager.setEnabled(true);
      debugManager.startLog(requestId, {
        contents: [{ role: 'user', parts: [{ text: 'Hello' }] }],
      });

      debugManager.addReconstructedRawResponse(requestId, {
        usageMetadata: {
          promptTokenCount: 50,
          candidatesTokenCount: 25,
          cachedContentTokenCount: 40,
        },
      });

      const mockStream = new PassThrough();

      let capturedRecord: UsageRecord | null = null;
      registerSpy(mockStorage, 'saveRequest').mockImplementation(async (record: UsageRecord) => {
        capturedRecord = record;
        return Promise.resolve();
      });

      mockStream.pipe(inspector);
      mockStream.end();

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(capturedRecord).not.toBeNull();
      expect(capturedRecord!.tokensCached).toBe(40);
    });

    it('should extract reasoning tokens from OpenAI completion_tokens_details', async () => {
      const requestId = 'test-reasoning-tokens';
      const startTime = Date.now() - 100;

      const inspector = new UsageInspector(
        requestId,
        mockStorage,
        { requestId } as Partial<UsageRecord>,
        mockPricing,
        undefined,
        startTime,
        false,
        'chat',
        undefined,
        undefined
      );

      const debugManager = DebugManager.getInstance();
      debugManager.setEnabled(true);
      debugManager.startLog(requestId, {
        messages: [{ role: 'user', content: 'Think carefully' }],
      });

      debugManager.addReconstructedRawResponse(requestId, {
        usage: {
          prompt_tokens: 100,
          completion_tokens: 50,
          total_tokens: 150,
          completion_tokens_details: {
            reasoning_tokens: 25,
          },
        },
      });

      const mockStream = new PassThrough();

      let capturedRecord: UsageRecord | null = null;
      registerSpy(mockStorage, 'saveRequest').mockImplementation(async (record: UsageRecord) => {
        capturedRecord = record;
        return Promise.resolve();
      });

      mockStream.pipe(inspector);
      mockStream.end();

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(capturedRecord).not.toBeNull();
      expect(capturedRecord!.tokensReasoning).toBe(25);
    });

    it('should estimate input tokens using incoming API type when provider API type differs', async () => {
      const requestId = 'test-input-estimation-incoming-api-type';
      const startTime = Date.now() - 100;
      const originalRequest = {
        messages: [{ role: 'user', content: 'Count these words for input estimation.' }],
      };

      const inspector = new UsageInspector(
        requestId,
        mockStorage,
        { requestId } as Partial<UsageRecord>,
        mockPricing,
        undefined,
        startTime,
        true,
        'gemini',
        'chat',
        originalRequest
      );

      const debugManager = DebugManager.getInstance();
      debugManager.setEnabled(true);
      debugManager.startLog(requestId, originalRequest);

      // Simulate reconstructed provider response with no prompt/input token count available.
      // This should trigger input fallback estimation from original request.
      debugManager.addReconstructedRawResponse(requestId, {
        usageMetadata: {
          promptTokenCount: 0,
          candidatesTokenCount: 12,
        },
      });

      const mockStream = new PassThrough();

      let capturedRecord: UsageRecord | null = null;
      registerSpy(mockStorage, 'saveRequest').mockImplementation(async (record: UsageRecord) => {
        capturedRecord = record;
        return Promise.resolve();
      });

      mockStream.pipe(inspector);
      mockStream.end();

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(capturedRecord).not.toBeNull();
      expect(capturedRecord!.tokensInput).toBeGreaterThan(0);
      // The provider DID report output usage (candidatesTokenCount: 12), so
      // output estimation must NOT run (and must not overwrite the real
      // count) — the record is not flagged as estimated; only the
      // input-token fallback (which fires whenever the provider reports 0
      // input tokens) filled in tokensInput above.
      expect(capturedRecord!.tokensOutput).toBe(12);
      expect(capturedRecord!.tokensEstimated).not.toBe(1);
    });

    it('does not update performance metrics for errored streams', async () => {
      const requestId = 'test-error-performance-metrics';
      const inspector = new UsageInspector(
        requestId,
        mockStorage,
        {
          requestId,
          provider: 'google',
          selectedModelName: 'gemini-3.6-flash',
          responseStatus: 'error',
        } as Partial<UsageRecord>,
        mockPricing,
        undefined,
        Date.now() - 100,
        false,
        'gemini',
        undefined,
        undefined
      );

      const source = new PassThrough();
      source.pipe(inspector);
      source.end();
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockStorage.saveRequest).toHaveBeenCalled();
      expect(mockStorage.updatePerformanceMetrics).not.toHaveBeenCalled();
    });
  });

  describe('_destroy() — client disconnect handling', () => {
    function makeInspector(
      requestId: string,
      startTime: number,
      incomingApiType = 'chat',
      responseStatus?: string
    ) {
      return new UsageInspector(
        requestId,
        mockStorage,
        { requestId, responseStatus } as Partial<UsageRecord>,
        mockPricing,
        undefined,
        startTime,
        false,
        incomingApiType,
        incomingApiType,
        undefined
      );
    }

    it('records responseStatus=cancelled when stream is destroyed before completion', async () => {
      const requestId = 'test-destroy-cancelled';
      const startTime = Date.now() - 200;
      const inspector = makeInspector(requestId, startTime);
      // Must attach error listener — destroying with an Error would otherwise throw uncaught
      inspector.on('error', () => {});

      let capturedRecord: UsageRecord | null = null;
      registerSpy(mockStorage, 'saveRequest').mockImplementation(async (record: UsageRecord) => {
        capturedRecord = record;
      });

      const src = new PassThrough();
      src.pipe(inspector);
      src.write('data: partial chunk\n\n');
      // Destroy before end — simulates client disconnect
      inspector.destroy(new Error('client_disconnected'));

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(capturedRecord).not.toBeNull();
      expect(capturedRecord!.responseStatus).toBe('cancelled');
      expect(capturedRecord!.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('preserves success when a Responses terminal event precedes stream destruction', async () => {
      const requestId = 'test-destroy-responses-completed';
      const transformedCapture = new DebugLoggingInspector(requestId, 'transformed');
      const transformedTap = transformedCapture.createInspector('responses');
      transformedTap.write('event: response.completed\ndata: {"type":"response.completed"}\n\n');
      const inspector = new UsageInspector(
        requestId,
        mockStorage,
        { requestId, responseStatus: 'success' } as Partial<UsageRecord>,
        mockPricing,
        undefined,
        Date.now() - 200,
        false,
        'responses',
        'responses',
        undefined,
        undefined,
        undefined,
        undefined,
        transformedCapture
      );
      inspector.on('error', () => {});

      let capturedRecord: UsageRecord | null = null;
      registerSpy(mockStorage, 'saveRequest').mockImplementation(async (record: UsageRecord) => {
        capturedRecord = record;
      });
      inspector.destroy();

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(capturedRecord).not.toBeNull();
      expect(capturedRecord!.responseStatus).toBe('success');
    });

    it('preserves success when a Chat Completions terminal chunk precedes stream destruction', async () => {
      const requestId = 'test-destroy-chat-completed';
      const transformedCapture = new DebugLoggingInspector(requestId, 'transformed');
      const transformedTap = transformedCapture.createInspector('chat');
      transformedTap.write(
        'data: {"id":"chatcmpl_test","choices":[{"delta":{},"finish_reason":"stop"}]}\n\n'
      );
      const inspector = new UsageInspector(
        requestId,
        mockStorage,
        { requestId, responseStatus: 'success' } as Partial<UsageRecord>,
        mockPricing,
        undefined,
        Date.now() - 200,
        false,
        'chat',
        'chat',
        undefined,
        undefined,
        undefined,
        undefined,
        transformedCapture
      );
      inspector.on('error', () => {});

      let capturedRecord: UsageRecord | null = null;
      registerSpy(mockStorage, 'saveRequest').mockImplementation(async (record: UsageRecord) => {
        capturedRecord = record;
      });
      inspector.destroy();

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(capturedRecord).not.toBeNull();
      expect(capturedRecord!.responseStatus).toBe('success');
    });

    it('runs successful finalization after a terminal Responses stream is destroyed', async () => {
      const requestId = 'test-destroy-responses-full-finalization';
      const rawCapture = new DebugLoggingInspector(requestId, 'raw');
      const rawTap = rawCapture.createInspector('responses');
      rawTap.write(
        JSON.stringify({
          status: 'completed',
          output: [
            { type: 'function_call', id: 'fc_1' },
            { type: 'function_call', id: 'fc_2' },
          ],
          usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
          providerReportedCost: { request_cost_usd: 0.42 },
          providerReportedEnergy: { energy_kwh: 0.12345678901 },
        })
      );
      const transformedCapture = new DebugLoggingInspector(requestId, 'transformed');
      const transformedTap = transformedCapture.createInspector('responses');
      transformedTap.write('event: response.completed\ndata: {"type":"response.completed"}\n\n');

      const quotaEnforcer = {};
      const inspector = new UsageInspector(
        requestId,
        mockStorage,
        {
          requestId,
          responseStatus: 'success',
          provider: 'test-provider',
          selectedModelName: 'test-model',
          canonicalModelName: 'test-canonical-model',
          finalAttemptProvider: 'final-provider',
          finalAttemptModel: 'final-model',
        } as Partial<UsageRecord>,
        mockPricing,
        undefined,
        Date.now() - 200,
        false,
        'responses',
        'responses',
        undefined,
        quotaEnforcer,
        'test-key',
        rawCapture,
        transformedCapture
      );

      let capturedRecord: UsageRecord | null = null;
      registerSpy(mockStorage, 'saveRequest').mockImplementation(async (record: UsageRecord) => {
        capturedRecord = record;
      });
      const recordQuotaUsageSpy = registerSpy(
        quotaMiddleware,
        'recordQuotaUsage'
      ).mockResolvedValue(undefined);

      inspector.destroy();
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(capturedRecord!.responseStatus).toBe('success');
      expect(capturedRecord!.toolCallsCount).toBe(2);
      expect(capturedRecord!.finishReason).toBe('tool_calls');
      expect(capturedRecord!.providerReportedCost).toBe(0.42);
      expect(capturedRecord!.kwhUsed).toBe(0.123456789);
      expect(capturedRecord!.tokensPerSec).toBeGreaterThan(0);
      expect(mockStorage.updatePerformanceMetrics).toHaveBeenCalledWith(
        'test-provider',
        'test-model',
        'test-canonical-model',
        null,
        5,
        expect.any(Number),
        requestId
      );
      expect(recordQuotaUsageSpy).toHaveBeenCalledWith(
        'test-key',
        'final-provider',
        'final-model',
        expect.objectContaining({ tokensInput: 10, tokensOutput: 5, costTotal: 0.42 }),
        quotaEnforcer
      );
    });

    it('records cancellation when destroyed before the terminal event', async () => {
      const requestId = 'test-destroy-before-terminal';
      const inspector = makeInspector(requestId, Date.now() - 200, 'responses', 'success');
      inspector.on('error', () => {});

      let capturedRecord: UsageRecord | null = null;
      registerSpy(mockStorage, 'saveRequest').mockImplementation(async (record: UsageRecord) => {
        capturedRecord = record;
      });

      const src = new PassThrough();
      src.pipe(inspector);
      src.write('event: response.output_text.delta\n');
      inspector.destroy();

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(capturedRecord).not.toBeNull();
      expect(capturedRecord!.responseStatus).toBe('cancelled');
    });

    it.each(['gemini', 'messages'])(
      'does not classify %s streams from Responses markers',
      async (apiType) => {
        const requestId = `test-destroy-${apiType}-marker`;
        const inspector = makeInspector(requestId, Date.now() - 200, apiType, 'success');
        inspector.on('error', () => {});

        let capturedRecord: UsageRecord | null = null;
        registerSpy(mockStorage, 'saveRequest').mockImplementation(async (record: UsageRecord) => {
          capturedRecord = record;
        });

        const src = new PassThrough();
        src.pipe(inspector);
        src.write('event: response.completed\n');
        inspector.destroy();

        await new Promise((resolve) => setTimeout(resolve, 100));

        expect(capturedRecord).not.toBeNull();
        expect(capturedRecord!.responseStatus).toBe('cancelled');
      }
    );

    it('records responseStatus=timeout when destroyed with a TimeoutError', async () => {
      const requestId = 'test-destroy-timeout';
      const startTime = Date.now() - 500;
      const inspector = makeInspector(requestId, startTime);
      inspector.on('error', () => {});

      let capturedRecord: UsageRecord | null = null;
      registerSpy(mockStorage, 'saveRequest').mockImplementation(async (record: UsageRecord) => {
        capturedRecord = record;
      });

      const src = new PassThrough();
      src.pipe(inspector);

      const timeoutErr = new Error('Upstream timeout');
      timeoutErr.name = 'TimeoutError';
      inspector.destroy(timeoutErr);

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(capturedRecord).not.toBeNull();
      expect(capturedRecord!.responseStatus).toBe('timeout');
    });

    it('does not double-save when _flush runs normally then destroy is called', async () => {
      const requestId = 'test-no-double-save';
      const startTime = Date.now() - 100;

      const debugManager = DebugManager.getInstance();
      debugManager.setEnabled(true);
      debugManager.startLog(requestId, { messages: [] });
      debugManager.addReconstructedRawResponse(requestId, {
        choices: [{ finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      });

      const inspector = makeInspector(requestId, startTime);
      inspector.on('error', () => {});

      let saveCount = 0;
      registerSpy(mockStorage, 'saveRequest').mockImplementation(async () => {
        saveCount++;
      });

      const src = new PassThrough();
      src.pipe(inspector);

      // Normal end — _flush fires, sets _flushed = true
      src.end();
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Simulate a post-completion write error triggering destroy
      inspector.destroy(new Error('EPIPE'));
      await new Promise((resolve) => setTimeout(resolve, 100));

      // saveRequest must be called exactly once (from _flush, not again from _destroy)
      expect(saveCount).toBe(1);
    });

    it('saves with partial tokens from DebugManager when cancelled mid-stream', async () => {
      const requestId = 'test-destroy-partial-tokens';
      const startTime = Date.now() - 1000;

      const debugManager = DebugManager.getInstance();
      debugManager.setEnabled(true);
      debugManager.startLog(requestId, { messages: [] });
      // Simulate partial token data accumulated before disconnect
      debugManager.addReconstructedRawResponse(requestId, {
        choices: [{ finish_reason: null }],
        usage: { prompt_tokens: 50, completion_tokens: 0, total_tokens: 50 },
      });

      const inspector = makeInspector(requestId, startTime);
      inspector.on('error', () => {});

      let capturedRecord: UsageRecord | null = null;
      registerSpy(mockStorage, 'saveRequest').mockImplementation(async (record: UsageRecord) => {
        capturedRecord = record;
      });

      const src = new PassThrough();
      src.pipe(inspector);
      src.write('data: partial\n\n');
      inspector.destroy(new Error('client_disconnected'));

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(capturedRecord).not.toBeNull();
      expect(capturedRecord!.responseStatus).toBe('cancelled');
      expect(capturedRecord!.tokensInput).toBe(50);
    });
  });
});
