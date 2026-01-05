import { describe, expect, test, mock } from "bun:test";
import { handleResponse } from "../../services/response-handler";
import { FastifyReply, FastifyRequest } from "fastify";
import { UsageStorageService } from "../../services/usage-storage";
import { Transformer } from "../../types/transformer";
import { UnifiedChatResponse } from "../../types/unified";
import { UsageRecord } from "../../types/usage";

// Mock Logger
mock.module("../logger", () => ({
    logger: {
        debug: mock(),
        info: mock(),
        warn: mock(),
        error: mock(),
    }
}));

describe("handleResponse - Pricing Calculation", () => {
    const mockStorage = {
        saveRequest: mock(),
        updatePerformanceMetrics: mock()
    } as unknown as UsageStorageService;

    const mockTransformer: Transformer = {
        name: "test-transformer",
        defaultEndpoint: "/test",
        parseRequest: mock(),
        transformRequest: mock(),
        transformResponse: mock(),
        extractUsage: mock(),
        formatResponse: mock((r) => Promise.resolve({ formatted: true, ...r })),
    };

    const mockReply = {
        send: mock(function(this: any, data) { return this; }),
        header: mock(function(this: any) { return this; }),
        code: mock(function(this: any) { return this; }),
    } as unknown as FastifyReply;

    const mockRequest = {
        id: "test-req-id"
    } as unknown as FastifyRequest;

    const baseUsage = {
        reasoning_tokens: 0,
        cached_tokens: 0,
        cache_creation_tokens: 0
    };

    test("should calculate costs for 'defined' pricing strategy (Range 1)", async () => {
        const unifiedResponse: UnifiedChatResponse = {
            id: "resp-pricing-1",
            model: "model-pricing",
            content: "Hello",
            plexus: {
                provider: "provider-1",
                model: "model-orig",
                apiType: "openai",
                pricing: {
                    source: 'defined',
                    range: [
                        {
                            lower_bound: 0,
                            upper_bound: 1000,
                            input_per_m: 0.01,
                            output_per_m: 0.02
                        },
                        {
                            lower_bound: 1001,
                            upper_bound: Infinity,
                            input_per_m: 0.005,
                            output_per_m: 0.01
                        }
                    ]
                }
            },
            usage: {
                ...baseUsage,
                input_tokens: 500,
                output_tokens: 1000,
                total_tokens: 1500,
            }
        };

        const usageRecord: Partial<UsageRecord> = {
            requestId: "req-p-1"
        };

        await handleResponse(
            mockRequest,
            mockReply,
            unifiedResponse,
            mockTransformer,
            usageRecord,
            mockStorage,
            Date.now(),
            "chat"
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
            id: "resp-pricing-2",
            model: "model-pricing",
            content: "Hello",
            plexus: {
                provider: "provider-1",
                model: "model-orig",
                apiType: "openai",
                pricing: {
                    source: 'defined',
                    range: [
                        {
                            lower_bound: 0,
                            upper_bound: 1000,
                            input_per_m: 0.01,
                            output_per_m: 0.02
                        },
                        {
                            lower_bound: 1001,
                            upper_bound: Infinity,
                            input_per_m: 0.005,
                            output_per_m: 0.01
                        }
                    ]
                }
            },
            usage: {
                ...baseUsage,
                input_tokens: 2000,
                output_tokens: 1000,
                total_tokens: 3000,
            }
        };

        const usageRecord: Partial<UsageRecord> = {
            requestId: "req-p-2"
        };

        await handleResponse(
            mockRequest,
            mockReply,
            unifiedResponse,
            mockTransformer,
            usageRecord,
            mockStorage,
            Date.now(),
            "chat"
        );

        // Expected Cost:
        // Input: 2000 / 1M * 0.005 = 0.00001
        // Output: 1000 / 1M * 0.01 = 0.00001
        // Total: 0.00002
        expect(usageRecord.costInput).toBeCloseTo(0.00001, 8);
        expect(usageRecord.costOutput).toBeCloseTo(0.00001, 8);
        expect(usageRecord.costTotal).toBeCloseTo(0.00002, 8);
    });
});
