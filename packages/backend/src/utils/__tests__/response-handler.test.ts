import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { handleResponse } from '../../services/responses/response-handler';
import { FastifyReply, FastifyRequest } from 'fastify';
import { UsageStorageService } from '../../services/observability/usage-storage';
import { TransformerFactory } from '../../services/dispatch/transformer-factory';
import { Transformer } from '../../types/transformer';
import { UnifiedChatResponse } from '../../types/unified';
import { UsageRecord } from '../../types/usage';
import { registerSpy } from '../../../test/test-utils';
import { logger } from '../../utils/logger';

describe('handleResponse', () => {
  const originalAdminKey = process.env.ADMIN_KEY;

  const mockStorage = {
    saveRequest: vi.fn(),
    saveError: vi.fn(),
    updatePerformanceMetrics: vi.fn(),
  } as unknown as UsageStorageService;

  const mockTransformer: Transformer = {
    name: 'test-transformer',
    defaultEndpoint: '/test',
    parseRequest: vi.fn(),
    transformRequest: vi.fn(),
    transformResponse: vi.fn(),
    extractUsage: vi.fn(),
    formatResponse: vi.fn((r) => Promise.resolve({ formatted: true, ...r })),
  };

  const mockReply = {
    send: vi.fn(function (this: any, data) {
      return this;
    }),
    header: vi.fn(function (this: any) {
      return this;
    }),
    code: vi.fn(function (this: any) {
      return this;
    }),
  } as unknown as FastifyReply;

  const mockRequest = {
    id: 'test-req-id',
  } as unknown as FastifyRequest;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ADMIN_KEY = originalAdminKey;
  });

  afterEach(() => {
    if (originalAdminKey === undefined) {
      delete process.env.ADMIN_KEY;
    } else {
      process.env.ADMIN_KEY = originalAdminKey;
    }
  });

  test('should process non-streaming response correctly', async () => {
    const unifiedResponse: UnifiedChatResponse = {
      id: 'resp-1',
      model: 'model-1',
      content: 'Hello',
      plexus: {
        provider: 'provider-1',
        model: 'model-orig',
        apiType: 'chat',
      },
      usage: {
        input_tokens: 10,
        output_tokens: 20,
        total_tokens: 30,
        reasoning_tokens: 0,
        cached_tokens: 0,
        cache_creation_tokens: 0,
      },
    };

    const usageRecord: Partial<UsageRecord> = {
      requestId: 'req-1',
    };

    await handleResponse(
      mockRequest,
      mockReply,
      unifiedResponse,
      mockTransformer,
      usageRecord,
      mockStorage,
      Date.now(),
      'chat'
    );

    // Verify Usage Record updates
    expect(usageRecord.selectedModelName).toBe('model-orig');
    expect(usageRecord.provider).toBe('provider-1');
    expect(usageRecord.outgoingApiType).toBe('chat');
    expect(usageRecord.tokensInput).toBe(10);
    expect(usageRecord.tokensOutput).toBe(20);
    expect(usageRecord.responseStatus).toBe('success');

    // Verify Storage called
    expect(mockStorage.saveRequest).toHaveBeenCalled();

    // Verify send called with formatted response
    const lastCall = (mockReply.send as any).mock.calls.at(-1);
    const result = lastCall[0];
    expect(result.plexus).toBeUndefined();
    expect(result.formatted).toBe(true);
  });

  test('includes playground routing metadata only with a valid admin key', async () => {
    process.env.ADMIN_KEY = 'correct-admin-key';
    const unifiedResponse: UnifiedChatResponse = {
      id: 'resp-playground',
      model: 'model-1',
      content: 'Hello',
      plexus: {
        provider: 'provider-1',
        model: 'model-orig',
        canonicalModel: 'model-canonical',
        apiType: 'chat',
        attemptCount: 2,
      },
    };
    const usageRecord: Partial<UsageRecord> = {
      requestId: 'req-playground',
    };
    const request = {
      headers: {
        'x-plexus-playground': 'true',
        'x-admin-key': 'correct-admin-key',
      },
    } as unknown as FastifyRequest;

    await handleResponse(
      request,
      mockReply,
      unifiedResponse,
      mockTransformer,
      usageRecord,
      mockStorage,
      Date.now(),
      'chat'
    );

    const lastCall = (mockReply.send as any).mock.calls.at(-1);
    const result = lastCall[0];
    expect(result.plexus).toEqual({
      requestId: 'req-playground',
      provider: 'provider-1',
      model: 'model-orig',
      canonicalModel: 'model-canonical',
      apiType: 'chat',
      attemptCount: 2,
    });
  });

  test('does not include playground routing metadata without an admin key', async () => {
    process.env.ADMIN_KEY = 'correct-admin-key';
    const unifiedResponse: UnifiedChatResponse = {
      id: 'resp-no-admin',
      model: 'model-1',
      content: 'Hello',
      plexus: {
        provider: 'provider-1',
        model: 'model-orig',
        apiType: 'chat',
      },
    };
    const usageRecord: Partial<UsageRecord> = {
      requestId: 'req-no-admin',
    };
    const request = {
      headers: {
        'x-plexus-playground': 'true',
      },
    } as unknown as FastifyRequest;

    await handleResponse(
      request,
      mockReply,
      unifiedResponse,
      mockTransformer,
      usageRecord,
      mockStorage,
      Date.now(),
      'chat'
    );

    const lastCall = (mockReply.send as any).mock.calls.at(-1);
    expect(lastCall[0].plexus).toBeUndefined();
  });

  test('does not include playground routing metadata with the wrong admin key', async () => {
    process.env.ADMIN_KEY = 'correct-admin-key';
    const unifiedResponse: UnifiedChatResponse = {
      id: 'resp-wrong-admin',
      model: 'model-1',
      content: 'Hello',
      plexus: {
        provider: 'provider-1',
        model: 'model-orig',
        apiType: 'chat',
      },
    };
    const usageRecord: Partial<UsageRecord> = {
      requestId: 'req-wrong-admin',
    };
    const request = {
      headers: {
        'x-plexus-playground': 'true',
        'x-admin-key': 'wrong-admin-key',
      },
    } as unknown as FastifyRequest;

    await handleResponse(
      request,
      mockReply,
      unifiedResponse,
      mockTransformer,
      usageRecord,
      mockStorage,
      Date.now(),
      'chat'
    );

    const lastCall = (mockReply.send as any).mock.calls.at(-1);
    expect(lastCall[0].plexus).toBeUndefined();
  });

  test('should fallback to unifiedResponse.model if plexus.model missing', async () => {
    const unifiedResponse: UnifiedChatResponse = {
      id: 'resp-2',
      model: 'fallback-model',
      content: 'Hi',
      plexus: {
        provider: 'provider-2',
      },
    };

    const usageRecord: Partial<UsageRecord> = {};

    await handleResponse(
      mockRequest,
      mockReply,
      unifiedResponse,
      mockTransformer,
      usageRecord,
      mockStorage,
      Date.now(),
      'messages'
    );

    expect(usageRecord.selectedModelName).toBe('fallback-model');
    expect(usageRecord.provider).toBe('provider-2');
  });

  test('signals unary transient client errors without formatting a successful response', async () => {
    const unifiedResponse: UnifiedChatResponse = {
      id: 'resp-malformed',
      model: 'gemini-3.6-flash',
      content: null,
      plexus: {
        provider: 'google',
        model: 'gemini-3.6-flash',
        apiType: 'gemini',
      },
      usage: {
        input_tokens: 100,
        output_tokens: 12,
        total_tokens: 112,
        reasoning_tokens: 2,
        cached_tokens: 0,
        cache_creation_tokens: 0,
      },
      clientError: {
        statusCode: 503,
        code: 'MALFORMED_FUNCTION_CALL',
        message:
          'Upstream Gemini returned MALFORMED_FUNCTION_CALL — please retry your request. [503]',
      },
    };
    const usageRecord: Partial<UsageRecord> = { requestId: 'req-malformed' };
    const quotaEnforcer = {
      recordUsage: vi.fn().mockResolvedValue(undefined),
    };

    await handleResponse(
      mockRequest,
      mockReply,
      unifiedResponse,
      mockTransformer,
      usageRecord,
      mockStorage,
      Date.now(),
      'gemini',
      false,
      undefined,
      quotaEnforcer as any,
      'test-key'
    );

    expect(mockReply.code).toHaveBeenCalledWith(503);
    expect(mockReply.send).toHaveBeenCalledWith({
      error: {
        code: 503,
        status: 'UNAVAILABLE',
        message: expect.stringContaining('please retry your request'),
      },
    });
    expect(mockTransformer.formatResponse).not.toHaveBeenCalled();
    expect(usageRecord).toEqual(
      expect.objectContaining({
        responseStatus: 'error',
        finishReason: 'MALFORMED_FUNCTION_CALL',
        tokensInput: 100,
        tokensOutput: 12,
        tokensReasoning: 2,
      })
    );
    expect(quotaEnforcer.recordUsage).toHaveBeenCalledWith(
      'test-key',
      'google',
      'gemini-3.6-flash',
      expect.objectContaining({ tokensInput: 100, tokensOutput: 12, tokensReasoning: 2 })
    );
    expect(mockStorage.updatePerformanceMetrics).not.toHaveBeenCalled();
    expect(mockStorage.saveError).toHaveBeenCalledWith(
      'req-malformed',
      expect.any(Error),
      expect.objectContaining({
        code: 'MALFORMED_FUNCTION_CALL',
        clientSignaled: true,
      }),
      'test-key'
    );
  });

  describe('Usage Mapping Regression Tests', () => {
    test('should correctly map all usage fields in non-streaming response', async () => {
      const unifiedResponse: UnifiedChatResponse = {
        id: 'resp-3',
        model: 'model-3',
        content: 'Hello',
        usage: {
          input_tokens: 111,
          output_tokens: 222,
          total_tokens: 333,
          reasoning_tokens: 44,
          cached_tokens: 55,
          cache_creation_tokens: 66,
        },
      };

      const usageRecord: Partial<UsageRecord> = {};
      await handleResponse(
        mockRequest,
        mockReply,
        unifiedResponse,
        mockTransformer,
        usageRecord,
        mockStorage,
        Date.now(),
        'chat'
      );

      expect(usageRecord.tokensInput).toBe(111);
      expect(usageRecord.tokensOutput).toBe(222);
      expect(usageRecord.tokensReasoning).toBe(44);
      expect(usageRecord.tokensCached).toBe(55);
      expect(usageRecord.tokensCacheWrite).toBe(66);
      expect(mockStorage.saveRequest).toHaveBeenCalled();
    });
  });

  describe('streaming empty-completion detection (T5)', () => {
    // Fake transformer whose "provider" wire format is newline-delimited
    // JSON — each line IS already a UnifiedChatStreamChunk object. This
    // sidesteps any specific real provider SSE format so the test exercises
    // exactly the response-handler.ts seam under test (the tap inserted
    // between transformStream's output and formatStream's input), independent
    // of any one real transformer's implementation.
    function makeFakeStreamingTransformer(): Transformer {
      return {
        name: 'fake-stream-transformer',
        defaultEndpoint: '/test',
        parseRequest: vi.fn(),
        transformRequest: vi.fn(),
        transformResponse: vi.fn(),
        extractUsage: vi.fn(),
        formatResponse: vi.fn(),
        transformStream(stream: ReadableStream): ReadableStream {
          const decoder = new TextDecoder();
          return new ReadableStream({
            async start(controller) {
              const reader = stream.getReader();
              let buffer = '';
              try {
                while (true) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  buffer += decoder.decode(value, { stream: true });
                }
              } finally {
                reader.releaseLock();
              }
              for (const line of buffer.split('\n')) {
                const trimmed = line.trim();
                if (!trimmed) continue;
                controller.enqueue(JSON.parse(trimmed));
              }
              controller.close();
            },
          });
        },
        formatStream(stream: ReadableStream): ReadableStream {
          const encoder = new TextEncoder();
          return new ReadableStream({
            async start(controller) {
              const reader = stream.getReader();
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`));
              }
              controller.close();
            },
          });
        },
      };
    }

    function makeRawChunkStream(chunks: unknown[]): ReadableStream<Uint8Array> {
      const encoder = new TextEncoder();
      return new ReadableStream({
        start(controller) {
          for (const chunk of chunks) {
            controller.enqueue(encoder.encode(`${JSON.stringify(chunk)}\n`));
          }
          controller.close();
        },
      });
    }

    /** Drains a Node Readable to completion, the way reply.send(pipeline) would in production. */
    function drainNodeStream(stream: any): Promise<void> {
      return new Promise((resolve, reject) => {
        stream.on('data', () => {});
        stream.once('end', () => resolve());
        stream.once('error', reject);
      });
    }

    test('stream with zero visible deltas marks responseStatus="empty" and logs a warn', async () => {
      const fakeTransformer = makeFakeStreamingTransformer();
      registerSpy(TransformerFactory, 'getTransformer').mockReturnValue(fakeTransformer);

      const unifiedResponse: UnifiedChatResponse = {
        id: 'resp-empty-stream',
        model: 'model-1',
        content: null,
        stream: makeRawChunkStream([
          { id: 'c1', model: 'model-1', delta: {}, finish_reason: null },
          { id: 'c1', model: 'model-1', delta: {}, finish_reason: 'stop' },
        ]),
        plexus: {
          provider: 'test-provider',
          model: 'model-orig',
          apiType: 'chat',
        },
      };

      const usageRecord: Partial<UsageRecord> = {
        requestId: 'req-empty-stream',
        canonicalModelName: 'test-alias',
      };

      await handleResponse(
        mockRequest,
        mockReply,
        unifiedResponse,
        fakeTransformer,
        usageRecord,
        mockStorage,
        Date.now(),
        'chat'
      );

      const lastCall = (mockReply.send as any).mock.calls.at(-1);
      await drainNodeStream(lastCall[0]);
      // Let any pending microtasks (e.g. fire-and-forget saveRequest) settle.
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(usageRecord.responseStatus).toBe('empty');
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Empty completion (no visible output)')
      );
    });

    test('stream with visible content keeps responseStatus="success"', async () => {
      const fakeTransformer = makeFakeStreamingTransformer();
      registerSpy(TransformerFactory, 'getTransformer').mockReturnValue(fakeTransformer);

      const unifiedResponse: UnifiedChatResponse = {
        id: 'resp-content-stream',
        model: 'model-1',
        content: null,
        stream: makeRawChunkStream([
          { id: 'c1', model: 'model-1', delta: { content: 'Hello' }, finish_reason: null },
          { id: 'c1', model: 'model-1', delta: {}, finish_reason: 'stop' },
        ]),
        plexus: {
          provider: 'test-provider',
          model: 'model-orig',
          apiType: 'chat',
        },
      };

      const usageRecord: Partial<UsageRecord> = {
        requestId: 'req-content-stream',
        canonicalModelName: 'test-alias',
      };

      await handleResponse(
        mockRequest,
        mockReply,
        unifiedResponse,
        fakeTransformer,
        usageRecord,
        mockStorage,
        Date.now(),
        'chat'
      );

      const lastCall = (mockReply.send as any).mock.calls.at(-1);
      await drainNodeStream(lastCall[0]);
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(usageRecord.responseStatus).toBe('success');
      expect(logger.warn).not.toHaveBeenCalledWith(
        expect.stringContaining('Empty completion (no visible output)')
      );
    });

    test('stream with an error chunk (no content) marks responseStatus="error", not "empty"/"success"', async () => {
      const fakeTransformer = makeFakeStreamingTransformer();
      registerSpy(TransformerFactory, 'getTransformer').mockReturnValue(fakeTransformer);

      const unifiedResponse: UnifiedChatResponse = {
        id: 'resp-error-stream',
        model: 'model-1',
        content: null,
        stream: makeRawChunkStream([
          {
            id: 'c1',
            model: 'model-1',
            event: 'error',
            delta: {},
            error: { statusCode: 500, code: 'response_failed', message: 'boom' },
          },
        ]),
        plexus: {
          provider: 'test-provider',
          model: 'model-orig',
          apiType: 'chat',
        },
      };

      const usageRecord: Partial<UsageRecord> = {
        requestId: 'req-error-stream',
        canonicalModelName: 'test-alias',
      };

      await handleResponse(
        mockRequest,
        mockReply,
        unifiedResponse,
        fakeTransformer,
        usageRecord,
        mockStorage,
        Date.now(),
        'chat'
      );

      const lastCall = (mockReply.send as any).mock.calls.at(-1);
      await drainNodeStream(lastCall[0]);
      await new Promise((resolve) => setTimeout(resolve, 20));

      // Not 'empty' (would silently hide the failure) and not the initial
      // 'success' default — the error chunk must win over both.
      expect(usageRecord.responseStatus).toBe('error');
    });

    test('stream with visible content THEN an error chunk still marks responseStatus="error"', async () => {
      const fakeTransformer = makeFakeStreamingTransformer();
      registerSpy(TransformerFactory, 'getTransformer').mockReturnValue(fakeTransformer);

      const unifiedResponse: UnifiedChatResponse = {
        id: 'resp-content-then-error-stream',
        model: 'model-1',
        content: null,
        stream: makeRawChunkStream([
          { id: 'c1', model: 'model-1', delta: { content: 'Partial' }, finish_reason: null },
          {
            id: 'c1',
            model: 'model-1',
            event: 'error',
            delta: {},
            error: { statusCode: 500, code: 'response_failed', message: 'boom mid-stream' },
          },
        ]),
        plexus: {
          provider: 'test-provider',
          model: 'model-orig',
          apiType: 'chat',
        },
      };

      const usageRecord: Partial<UsageRecord> = {
        requestId: 'req-content-then-error-stream',
        canonicalModelName: 'test-alias',
      };

      await handleResponse(
        mockRequest,
        mockReply,
        unifiedResponse,
        fakeTransformer,
        usageRecord,
        mockStorage,
        Date.now(),
        'chat'
      );

      const lastCall = (mockReply.send as any).mock.calls.at(-1);
      await drainNodeStream(lastCall[0]);
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(usageRecord.responseStatus).toBe('error');
    });
  });
});
