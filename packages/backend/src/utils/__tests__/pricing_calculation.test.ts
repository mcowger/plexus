import { describe, expect, test, vi } from 'vitest';
import { handleResponse } from '../../services/response-handler';
import { FastifyReply, FastifyRequest } from 'fastify';
import { UsageStorageService } from '../../services/usage-storage';
import { Transformer } from '../../types/transformer';
import { UnifiedChatResponse } from '../../types/unified';
import { UsageRecord } from '../../types/usage';

describe('handleResponse - Pricing Calculation', () => {
  const mockStorage = {
    saveRequest: vi.fn(),
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

  const baseUsage = {
    reasoning_tokens: 0,
    cached_tokens: 0,
    cache_creation_tokens: 0,
  };

  test("should calculate costs for 'defined' pricing strategy (Range 1)", async () => {
    const unifiedResponse: UnifiedChatResponse = {
      id: 'resp-pricing-1',
      model: 'model-pricing',
      content: 'Hello',
      plexus: {
        provider: 'provider-1',
        model: 'model-orig',
        apiType: 'openai',
        pricing: {
          source: 'defined',
          range: [
            {
              lower_bound: 0,
              upper_bound: 1000,
              input_per_m: 0.01,
              output_per_m: 0.02,
            },
            {
              lower_bound: 1001,
              upper_bound: Infinity,
              input_per_m: 0.005,
              output_per_m: 0.01,
            },
          ],
        },
      },
      usage: {
        ...baseUsage,
        input_tokens: 500,
        output_tokens: 1000,
        total_tokens: 1500,
      },
    };

    const usageRecord: Partial<UsageRecord> = {
      requestId: 'req-p-1',
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

    // Expected Cost:
    // Input: 500 / 1M * 0.01 = 0.000005
    // Output: 1000 / 1M * 0.02 = 0.00002
    // Total: 0.000025
    expect(usageRecord.costInput).toBeCloseTo(0.000005, 8);
    expect(usageRecord.costOutput).toBeCloseTo(0.00002, 8);
    expect(usageRecord.costTotal).toBeCloseTo(0.000025, 8);
  });

  test("should calculate costs for 'defined' pricing strategy (Range 2)", async () => {
    const unifiedResponse: UnifiedChatResponse = {
      id: 'resp-pricing-2',
      model: 'model-pricing',
      content: 'Hello',
      plexus: {
        provider: 'provider-1',
        model: 'model-orig',
        apiType: 'openai',
        pricing: {
          source: 'defined',
          range: [
            {
              lower_bound: 0,
              upper_bound: 1000,
              input_per_m: 0.01,
              output_per_m: 0.02,
            },
            {
              lower_bound: 1001,
              upper_bound: Infinity,
              input_per_m: 0.005,
              output_per_m: 0.01,
            },
          ],
        },
      },
      usage: {
        ...baseUsage,
        input_tokens: 2000,
        output_tokens: 1000,
        total_tokens: 3000,
      },
    };

    const usageRecord: Partial<UsageRecord> = {
      requestId: 'req-p-2',
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

    // Expected Cost:
    // Input: 2000 / 1M * 0.005 = 0.00001
    // Output: 1000 / 1M * 0.01 = 0.00001
    // Total: 0.00002
    expect(usageRecord.costInput).toBeCloseTo(0.00001, 8);
    expect(usageRecord.costOutput).toBeCloseTo(0.00001, 8);
    expect(usageRecord.costTotal).toBeCloseTo(0.00002, 8);
  });

  test("should calculate cache write costs for 'defined' pricing with ranges", async () => {
    const unifiedResponse: UnifiedChatResponse = {
      id: 'resp-pricing-cache-write',
      model: 'model-pricing',
      content: 'Hello',
      plexus: {
        provider: 'provider-1',
        model: 'model-orig',
        apiType: 'anthropic',
        pricing: {
          source: 'defined',
          range: [
            {
              lower_bound: 0,
              upper_bound: 200000,
              input_per_m: 5.0,
              output_per_m: 25.0,
              cached_per_m: 0.5,
              cache_write_per_m: 3.75,
            },
            {
              lower_bound: 200001,
              upper_bound: Infinity,
              input_per_m: 10.0,
              output_per_m: 37.5,
              cached_per_m: 1.0,
              cache_write_per_m: 6.25,
            },
          ],
        },
      },
      usage: {
        ...baseUsage,
        input_tokens: 250000, // Falls in second range (>200k)
        output_tokens: 1000,
        cached_tokens: 10000,
        cache_creation_tokens: 50000, // Cache write tokens
        total_tokens: 310000,
      },
    };

    const usageRecord: Partial<UsageRecord> = {
      requestId: 'req-p-cache-write',
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

    // Expected Cost (using second range >200k tokens):
    // Input: 250000 / 1M * 10.0 = 2.5
    // Output: 1000 / 1M * 37.5 = 0.0375
    // Cached: 10000 / 1M * 1.0 = 0.01
    // Cache Write: 50000 / 1M * 6.25 = 0.3125
    // Total: 2.86
    expect(usageRecord.costInput).toBeCloseTo(2.5, 8);
    expect(usageRecord.costOutput).toBeCloseTo(0.0375, 8);
    expect(usageRecord.costCached).toBeCloseTo(0.01, 8);
    expect(usageRecord.costCacheWrite).toBeCloseTo(0.3125, 8);
    expect(usageRecord.costTotal).toBeCloseTo(2.86, 8);
  });

  test("should calculate cache write costs for 'defined' pricing in lower range", async () => {
    const unifiedResponse: UnifiedChatResponse = {
      id: 'resp-pricing-cache-write-low',
      model: 'model-pricing',
      content: 'Hello',
      plexus: {
        provider: 'provider-1',
        model: 'model-orig',
        apiType: 'anthropic',
        pricing: {
          source: 'defined',
          range: [
            {
              lower_bound: 0,
              upper_bound: 200000,
              input_per_m: 5.0,
              output_per_m: 25.0,
              cached_per_m: 0.5,
              cache_write_per_m: 3.75,
            },
            {
              lower_bound: 200001,
              upper_bound: Infinity,
              input_per_m: 10.0,
              output_per_m: 37.5,
              cached_per_m: 1.0,
              cache_write_per_m: 6.25,
            },
          ],
        },
      },
      usage: {
        ...baseUsage,
        input_tokens: 100000, // Falls in first range (<200k)
        output_tokens: 500,
        cached_tokens: 5000,
        cache_creation_tokens: 20000, // Cache write tokens
        total_tokens: 125000,
      },
    };

    const usageRecord: Partial<UsageRecord> = {
      requestId: 'req-p-cache-write-low',
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

    // Expected Cost (using first range <200k tokens):
    // Input: 100000 / 1M * 5.0 = 0.5
    // Output: 500 / 1M * 25.0 = 0.0125
    // Cached: 5000 / 1M * 0.5 = 0.0025
    // Cache Write: 20000 / 1M * 3.75 = 0.075
    // Total: 0.59
    expect(usageRecord.costInput).toBeCloseTo(0.5, 8);
    expect(usageRecord.costOutput).toBeCloseTo(0.0125, 8);
    expect(usageRecord.costCached).toBeCloseTo(0.0025, 8);
    expect(usageRecord.costCacheWrite).toBeCloseTo(0.075, 8);
    expect(usageRecord.costTotal).toBeCloseTo(0.59, 8);
  });
});
