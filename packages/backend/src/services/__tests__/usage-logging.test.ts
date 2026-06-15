import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { registerSpy } from '../../../test/test-utils';
import { PassThrough } from 'stream';
import { UsageInspector } from '../inspectors/usage-logging';
import { UsageStorageService } from '../usage-storage';
import { DebugManager } from '../debug-manager';
import type { UsageRecord } from '../../types/usage';
import { DEFAULT_GPU_PARAMS, DEFAULT_MODEL } from '@plexus/shared';

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
        undefined,
        DEFAULT_GPU_PARAMS,
        DEFAULT_MODEL
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
        undefined,
        DEFAULT_GPU_PARAMS,
        DEFAULT_MODEL
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
        undefined,
        DEFAULT_GPU_PARAMS,
        DEFAULT_MODEL
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
        undefined,
        DEFAULT_GPU_PARAMS,
        DEFAULT_MODEL
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
        undefined,
        DEFAULT_GPU_PARAMS,
        DEFAULT_MODEL
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
        undefined,
        DEFAULT_GPU_PARAMS,
        DEFAULT_MODEL
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
        originalRequest,
        DEFAULT_GPU_PARAMS,
        DEFAULT_MODEL
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
      expect(capturedRecord!.tokensEstimated).toBe(1);
    });
  });

  describe('_destroy() — client disconnect handling', () => {
    function makeInspector(requestId: string, startTime: number) {
      return new UsageInspector(
        requestId,
        mockStorage,
        { requestId } as Partial<UsageRecord>,
        mockPricing,
        undefined,
        startTime,
        false,
        'chat',
        undefined,
        undefined,
        DEFAULT_GPU_PARAMS,
        DEFAULT_MODEL
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
