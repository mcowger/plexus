import { describe, expect, test, mock, beforeAll } from "bun:test";
import { handleResponse } from "../../services/response-handler";
import { FastifyReply, FastifyRequest } from "fastify";
import { UsageStorageService } from "../../services/usage-storage";
import { Transformer } from "../../types/transformer";
import { UnifiedChatResponse } from "../../types/unified";
import { UsageRecord } from "../../types/usage";
import { PricingManager } from "../../services/pricing-manager";
import path from "path";

describe("handleResponse - OpenRouter Pricing", () => {
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
        reasoning_tokens: 0,
        cache_creation_tokens: 0
    };

    const testDataPath = path.join(__dirname, "fixtures/openrouter-models.json");

    beforeAll(async () => {
        await PricingManager.getInstance().loadPricing(testDataPath);
    });

    test("should calculate costs for 'openrouter' pricing strategy (GPT-3.5 Turbo)", async () => {
        const slug = "anthropic/claude-3.5-sonnet";

        const unifiedResponse: UnifiedChatResponse = {
            id: "resp-or-1",
            model: "claude-3.5-sonnet",
            content: "Hello",
            plexus: {
                provider: "openrouter",
                model: "anthropic/claude-3.5-sonnet",
                apiType: "openai",
                pricing: {
                    source: 'openrouter',
                    slug: slug
                }
            },
            usage: {
                ...baseUsage,
                input_tokens: 1000,
                output_tokens: 500,
                total_tokens: 1500,
                cached_tokens: 1000
            }
        };

        const usageRecord: Partial<UsageRecord> = {
            requestId: "req-or-1"
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

        expect(usageRecord.costInput).toBeCloseTo(0.003, 8);
        expect(usageRecord.costOutput).toBeCloseTo(0.0075, 8);
        expect(usageRecord.costCached).toBeCloseTo(0.0003, 8);
        expect(usageRecord.costTotal).toBeCloseTo(0.0108, 8);
    });

    test("should calculate costs for 'openrouter' pricing strategy (Missing Cache Rate)", async () => {
        const slug = "openai/gpt-4";

        const unifiedResponse: UnifiedChatResponse = {
            id: "resp-or-2",
            model: "gpt-4",
            content: "Hello",
            plexus: {
                provider: "openrouter",
                model: "openai/gpt-4",
                apiType: "openai",
                pricing: {
                    source: 'openrouter',
                    slug: slug
                }
            },
            usage: {
                ...baseUsage,
                input_tokens: 1000,
                output_tokens: 500,
                total_tokens: 1500,
                cached_tokens: 1000
            }
        };

        const usageRecord: Partial<UsageRecord> = {
            requestId: "req-or-2"
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

        expect(usageRecord.costInput).toBeCloseTo(0.03, 8);
        expect(usageRecord.costOutput).toBeCloseTo(0.03, 8);
        expect(usageRecord.costCached).toBe(0);
        expect(usageRecord.costTotal).toBeCloseTo(0.06, 8);
    });

    test("should handle missing pricing slug gracefully", async () => {
         const unifiedResponse: UnifiedChatResponse = {
            id: "resp-or-3",
            model: "unknown",
            content: "Hello",
            plexus: {
                provider: "openrouter",
                model: "unknown",
                apiType: "openai",
                pricing: {
                    source: 'openrouter',
                    slug: "non-existent-slug"
                }
            },
            usage: {
                ...baseUsage,
                input_tokens: 1000,
                output_tokens: 500,
                total_tokens: 1500,
                cached_tokens: 0
            }
        };

        const usageRecord: Partial<UsageRecord> = { requestId: "req-or-3" };

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

        // Should not have calculated costs
        expect(usageRecord.costTotal).toBeUndefined();
    });

    test("should calculate costs for 'openrouter' pricing strategy with DISCOUNT", async () => {
        const slug = "anthropic/claude-3.5-sonnet";

        const unifiedResponse: UnifiedChatResponse = {
            id: "resp-or-discount",
            model: "claude-3.5-sonnet",
            content: "Hello",
            plexus: {
                provider: "openrouter",
                model: "anthropic/claude-3.5-sonnet",
                apiType: "openai",
                pricing: {
                    source: 'openrouter',
                    slug: slug,
                    discount: 0.1 // 10% discount
                }
            },
            usage: {
                ...baseUsage,
                input_tokens: 1000,
                output_tokens: 500,
                total_tokens: 1500,
                cached_tokens: 1000
            }
        };

        const usageRecord: Partial<UsageRecord> = {
            requestId: "req-or-discount"
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

        expect(usageRecord.costInput).toBeCloseTo(0.0027, 8);
        expect(usageRecord.costOutput).toBeCloseTo(0.00675, 8);
        expect(usageRecord.costCached).toBeCloseTo(0.00027, 8);
        expect(usageRecord.costTotal).toBeCloseTo(0.00972, 8);
        
        const metadata = JSON.parse(usageRecord.costMetadata || "{}");
        expect(metadata.discount).toBe(0.1);
    });

    test("should calculate costs for 'openrouter' pricing strategy with PROVIDER-LEVEL DISCOUNT", async () => {
        const slug = "anthropic/claude-3.5-sonnet";

        const unifiedResponse: UnifiedChatResponse = {
            id: "resp-or-provider-discount",
            model: "claude-3.5-sonnet",
            content: "Hello",
            plexus: {
                provider: "openrouter",
                model: "anthropic/claude-3.5-sonnet",
                apiType: "openai",
                pricing: {
                    source: 'openrouter',
                    slug: slug
                },
                providerDiscount: 0.2 // 20% global discount
            },
            usage: {
                ...baseUsage,
                input_tokens: 1000,
                output_tokens: 500,
                total_tokens: 1500,
                cached_tokens: 1000
            }
        };

        const usageRecord: Partial<UsageRecord> = {
            requestId: "req-or-provider-discount"
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

        expect(usageRecord.costInput).toBeCloseTo(0.0024, 8);
        expect(usageRecord.costOutput).toBeCloseTo(0.006, 8);
        expect(usageRecord.costCached).toBeCloseTo(0.00024, 8);
        expect(usageRecord.costTotal).toBeCloseTo(0.00864, 8);
        
        const metadata = JSON.parse(usageRecord.costMetadata || "{}");
        expect(metadata.discount).toBe(0.2);
    });
});
