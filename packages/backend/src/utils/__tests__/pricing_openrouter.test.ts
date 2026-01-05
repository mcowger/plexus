import { describe, expect, test, mock, beforeAll } from "bun:test";
import { handleResponse } from "../../services/response-handler";
import { FastifyReply, FastifyRequest } from "fastify";
import { UsageStorageService } from "../../services/usage-storage";
import { Transformer } from "../../types/transformer";
import { UnifiedChatResponse } from "../../types/unified";
import { UsageRecord } from "../../types/usage";
import { PricingManager } from "../../services/pricing-manager";
import path from "path";

// Mock PricingManager
mock.module("../../services/pricing-manager", () => {
    const pricingMap = new Map();
    pricingMap.set("minimax/minimax-m2.1", {
        prompt: "0.0000003",
        completion: "0.0000012",
        input_cache_read: "0.00000003"
    });
    pricingMap.set("z-ai/glm-4.7", {
        prompt: "0.0000004",
        completion: "0.0000015"
    });

    return {
        PricingManager: {
            getInstance: () => ({
                getPricing: (slug: string) => pricingMap.get(slug),
                loadPricing: () => Promise.resolve(),
                isInitialized: () => true
            })
        }
    };
});

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

    beforeAll(async () => {
        // Load pricing from the test models.json file
        const modelsPath = path.resolve(process.cwd(), "packages/backend/src/__tests__/models.json");
        await PricingManager.getInstance().loadPricing(modelsPath);
    });

    test("should calculate costs for 'openrouter' pricing strategy (GPT-3.5 Turbo)", async () => {
        const slug = "minimax/minimax-m2.1";

        const unifiedResponse: UnifiedChatResponse = {
            id: "resp-or-1",
            model: "minimax-m2.1",
            content: "Hello",
            plexus: {
                provider: "openrouter",
                model: "minimax/minimax-m2.1",
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

        expect(usageRecord.costInput).toBeCloseTo(0.0003, 8);
        expect(usageRecord.costOutput).toBeCloseTo(0.0006, 8);
        expect(usageRecord.costCached).toBeCloseTo(0.00003, 8);
        expect(usageRecord.costTotal).toBeCloseTo(0.00093, 8);
    });

    test("should calculate costs for 'openrouter' pricing strategy (Missing Cache Rate)", async () => {
        const slug = "z-ai/glm-4.7";

        const unifiedResponse: UnifiedChatResponse = {
            id: "resp-or-2",
            model: "glm-4.7",
            content: "Hello",
            plexus: {
                provider: "openrouter",
                model: "z-ai/glm-4.7",
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

        expect(usageRecord.costInput).toBeCloseTo(0.0004, 8);
        expect(usageRecord.costOutput).toBeCloseTo(0.00075, 8);
        expect(usageRecord.costCached).toBe(0);
        expect(usageRecord.costTotal).toBeCloseTo(0.00115, 8);
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
        const slug = "minimax/minimax-m2.1";

        const unifiedResponse: UnifiedChatResponse = {
            id: "resp-or-discount",
            model: "minimax-m2.1",
            content: "Hello",
            plexus: {
                provider: "openrouter",
                model: "minimax/minimax-m2.1",
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

        expect(usageRecord.costInput).toBeCloseTo(0.00027, 8);
        expect(usageRecord.costOutput).toBeCloseTo(0.00054, 8);
        expect(usageRecord.costCached).toBeCloseTo(0.000027, 8);
        expect(usageRecord.costTotal).toBeCloseTo(0.000837, 8);
        
        const metadata = JSON.parse(usageRecord.costMetadata || "{}");
        expect(metadata.discount).toBe(0.1);
    });

    test("should calculate costs for 'openrouter' pricing strategy with PROVIDER-LEVEL DISCOUNT", async () => {
        const slug = "minimax/minimax-m2.1";

        const unifiedResponse: UnifiedChatResponse = {
            id: "resp-or-provider-discount",
            model: "minimax-m2.1",
            content: "Hello",
            plexus: {
                provider: "openrouter",
                model: "minimax/minimax-m2.1",
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

        expect(usageRecord.costInput).toBeCloseTo(0.00024, 8);
        expect(usageRecord.costOutput).toBeCloseTo(0.00048, 8);
        expect(usageRecord.costCached).toBeCloseTo(0.000024, 8);
        expect(usageRecord.costTotal).toBeCloseTo(0.000744, 8);
        
        const metadata = JSON.parse(usageRecord.costMetadata || "{}");
        expect(metadata.discount).toBe(0.2);
    });
});
