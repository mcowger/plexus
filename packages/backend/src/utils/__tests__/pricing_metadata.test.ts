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

describe("handleResponse - Pricing Metadata", () => {
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
        formatResponse: mock((r) => Promise.resolve({ formatted: true, ...r })),
        extractUsage: mock()
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
        total_tokens: 200,
        reasoning_tokens: 0,
        cached_tokens: 0,
        cache_creation_tokens: 0
    };

    test("should set default source and metadata when no pricing is provided", async () => {
        const unifiedResponse: UnifiedChatResponse = {
            id: "resp-no-pricing",
            model: "model-test",
            content: "Hello",
            plexus: {
                provider: "provider-1",
                model: "model-orig",
                apiType: "openai"
                // No pricing
            },
            usage: {
                ...baseUsage,
                input_tokens: 100,
                output_tokens: 100,
            }
        };

        const usageRecord: Partial<UsageRecord> = { requestId: "req-1" };

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

        expect(usageRecord.costSource).toBe("default");
        const metadata = JSON.parse(usageRecord.costMetadata || "{}");
        expect(metadata).toEqual({ input: 0, output: 0, cached: 0 });
    });

    test("should set simple source and metadata", async () => {
        const pricing = {
            source: 'simple',
            input: 10,
            output: 30,
            cached: 5
        };

        const unifiedResponse: UnifiedChatResponse = {
            id: "resp-simple",
            model: "model-test",
            content: "Hello",
            plexus: {
                provider: "provider-1",
                model: "model-orig",
                apiType: "openai",
                pricing
            },
            usage: {
                ...baseUsage,
                input_tokens: 100,
                output_tokens: 100,
            }
        };

        const usageRecord: Partial<UsageRecord> = { requestId: "req-2" };

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

        expect(usageRecord.costSource).toBe("simple");
        const metadata = JSON.parse(usageRecord.costMetadata || "{}");
        expect(metadata).toEqual(pricing);
    });

    test("should set defined source and metadata", async () => {
        const pricing = {
            source: 'defined',
            range: [
                { lower_bound: 0, input_per_m: 1, output_per_m: 2 }
            ]
        } as any;

        const unifiedResponse: UnifiedChatResponse = {
            id: "resp-defined",
            model: "model-test",
            content: "Hello",
            plexus: {
                provider: "provider-1",
                model: "model-orig",
                apiType: "openai",
                pricing
            },
            usage: {
                ...baseUsage,
                input_tokens: 100,
                output_tokens: 100,
            }
        };

        const usageRecord: Partial<UsageRecord> = { requestId: "req-3" };

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

        expect(usageRecord.costSource).toBe("defined");
        const metadata = JSON.parse(usageRecord.costMetadata || "{}");
        expect(metadata).toEqual({
            ...pricing,
            input: pricing.range[0]!.input_per_m,
            output: pricing.range[0]!.output_per_m,
            range: pricing.range[0]
        });
    });
});
