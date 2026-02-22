import { describe, expect, test, mock } from "bun:test";
import { calculateCosts } from "../calculate-costs";
import { handleResponse } from "../../services/response-handler";
import { validateConfig } from "../../config";
import { FastifyReply, FastifyRequest } from "fastify";
import { UsageStorageService } from "../../services/usage-storage";
import { Transformer } from "../../types/transformer";
import { UnifiedChatResponse } from "../../types/unified";
import { UsageRecord } from "../../types/usage";

// ---------------------------------------------------------------------------
// Direct unit tests for calculateCosts with per_request pricing
// These exercise the utility in isolation — fast, no DB, no Fastify.
// ---------------------------------------------------------------------------

describe("calculateCosts - per_request pricing", () => {
    test("charges the flat amount regardless of token counts", () => {
        const record: Partial<UsageRecord> = {
            tokensInput: 5000,
            tokensOutput: 2000,
            tokensCached: 500,
            tokensCacheWrite: 100,
        };

        calculateCosts(record, { source: "per_request", amount: 0.002 });

        expect(record.costInput).toBe(0.002);
        expect(record.costOutput).toBe(0);
        expect(record.costCached).toBe(0);
        expect(record.costCacheWrite).toBe(0);
        expect(record.costTotal).toBe(0.002);
    });

    test("works correctly when token counts are all zero", () => {
        const record: Partial<UsageRecord> = {
            tokensInput: 0,
            tokensOutput: 0,
        };

        calculateCosts(record, { source: "per_request", amount: 0.05 });

        expect(record.costInput).toBe(0.05);
        expect(record.costTotal).toBe(0.05);
    });

    test("records the correct costSource", () => {
        const record: Partial<UsageRecord> = { tokensInput: 100 };
        calculateCosts(record, { source: "per_request", amount: 0.001 });
        expect(record.costSource).toBe("per_request");
    });

    test("stores amount in costMetadata JSON", () => {
        const record: Partial<UsageRecord> = { tokensInput: 100 };
        calculateCosts(record, { source: "per_request", amount: 0.0075 });

        const meta = JSON.parse(record.costMetadata!);
        expect(meta).toEqual({ amount: 0.0075 });
    });

    test("handles a zero-cost per_request amount", () => {
        const record: Partial<UsageRecord> = { tokensInput: 999 };
        calculateCosts(record, { source: "per_request", amount: 0 });

        expect(record.costInput).toBe(0);
        expect(record.costTotal).toBe(0);
        expect(record.costSource).toBe("per_request");
    });

    test("amount is rounded to 8 decimal places", () => {
        const record: Partial<UsageRecord> = { tokensInput: 1 };
        // Amount that would produce a long float if not rounded
        calculateCosts(record, { source: "per_request", amount: 0.123456789123 });

        // toFixed(8) should cap precision
        expect(record.costInput).toBeCloseTo(0.12345679, 8);
    });

    test("ignores providerDiscount (no discount support for per_request)", () => {
        const recordWithDiscount: Partial<UsageRecord> = { tokensInput: 100 };
        const recordNoDiscount: Partial<UsageRecord> = { tokensInput: 100 };

        calculateCosts(recordWithDiscount, { source: "per_request", amount: 0.01 }, 0.5);
        calculateCosts(recordNoDiscount, { source: "per_request", amount: 0.01 });

        // Both should produce the same result — discount is not applied
        expect(recordWithDiscount.costTotal).toBe(recordNoDiscount.costTotal);
        expect(recordWithDiscount.costTotal).toBe(0.01);
    });
});

// ---------------------------------------------------------------------------
// Integration-style tests via handleResponse (matches pricing_metadata.test.ts
// and pricing_calculation.test.ts patterns)
// ---------------------------------------------------------------------------

describe("handleResponse - per_request pricing", () => {
    const mockStorage = {
        saveRequest: mock(),
        updatePerformanceMetrics: mock(),
    } as unknown as UsageStorageService;

    const mockTransformer: Transformer = {
        name: "test-transformer",
        defaultEndpoint: "/test",
        parseRequest: mock(),
        transformRequest: mock(),
        transformResponse: mock(),
        formatResponse: mock((r) => Promise.resolve({ formatted: true, ...r })),
        extractUsage: mock(),
    };

    const mockReply = {
        send: mock(function (this: any, data: any) { return this; }),
        header: mock(function (this: any) { return this; }),
        code: mock(function (this: any) { return this; }),
    } as unknown as FastifyReply;

    const mockRequest = {
        id: "test-req-id",
    } as unknown as FastifyRequest;

    const baseUsage = {
        reasoning_tokens: 0,
        cached_tokens: 0,
        cache_creation_tokens: 0,
    };

    test("costs equal the flat amount, output/cached/cacheWrite are 0", async () => {
        const unifiedResponse: UnifiedChatResponse = {
            id: "resp-pr-1",
            model: "flat-fee-model",
            content: "Hello",
            plexus: {
                provider: "provider-x",
                model: "flat-fee-model",
                apiType: "openai",
                pricing: { source: "per_request", amount: 0.003 },
            },
            usage: {
                ...baseUsage,
                input_tokens: 8000,
                output_tokens: 2000,
                total_tokens: 10000,
            },
        };

        const usageRecord: Partial<UsageRecord> = { requestId: "req-pr-1" };

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

        expect(usageRecord.costInput).toBe(0.003);
        expect(usageRecord.costOutput).toBe(0);
        expect(usageRecord.costCached).toBe(0);
        expect(usageRecord.costCacheWrite).toBe(0);
        expect(usageRecord.costTotal).toBe(0.003);
    });

    test("costSource is 'per_request'", async () => {
        const unifiedResponse: UnifiedChatResponse = {
            id: "resp-pr-2",
            model: "flat-fee-model",
            content: "Hello",
            plexus: {
                provider: "provider-x",
                model: "flat-fee-model",
                apiType: "openai",
                pricing: { source: "per_request", amount: 0.01 },
            },
            usage: { ...baseUsage, input_tokens: 100, output_tokens: 50, total_tokens: 150 },
        };

        const usageRecord: Partial<UsageRecord> = { requestId: "req-pr-2" };

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

        expect(usageRecord.costSource).toBe("per_request");
    });

    test("costMetadata contains the flat amount", async () => {
        const unifiedResponse: UnifiedChatResponse = {
            id: "resp-pr-3",
            model: "flat-fee-model",
            content: "Hello",
            plexus: {
                provider: "provider-x",
                model: "flat-fee-model",
                apiType: "openai",
                pricing: { source: "per_request", amount: 0.0025 },
            },
            usage: { ...baseUsage, input_tokens: 500, output_tokens: 200, total_tokens: 700 },
        };

        const usageRecord: Partial<UsageRecord> = { requestId: "req-pr-3" };

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

        const meta = JSON.parse(usageRecord.costMetadata!);
        expect(meta).toEqual({ amount: 0.0025 });
    });

    test("cost is the same regardless of token volume", async () => {
        const makeResponse = (id: string, inputTokens: number): UnifiedChatResponse => ({
            id,
            model: "flat-fee-model",
            content: "Hello",
            plexus: {
                provider: "provider-x",
                model: "flat-fee-model",
                apiType: "openai",
                pricing: { source: "per_request", amount: 0.005 },
            },
            usage: { ...baseUsage, input_tokens: inputTokens, output_tokens: inputTokens, total_tokens: inputTokens * 2 },
        });

        const smallRecord: Partial<UsageRecord> = { requestId: "req-pr-small" };
        const largeRecord: Partial<UsageRecord> = { requestId: "req-pr-large" };

        await handleResponse(mockRequest, mockReply, makeResponse("resp-pr-small", 10), mockTransformer, smallRecord, mockStorage, Date.now(), "chat");
        await handleResponse(mockRequest, mockReply, makeResponse("resp-pr-large", 1_000_000), mockTransformer, largeRecord, mockStorage, Date.now(), "chat");

        expect(smallRecord.costTotal).toBe(0.005);
        expect(largeRecord.costTotal).toBe(0.005);
    });
});

// ---------------------------------------------------------------------------
// Config schema validation tests — ensures the YAML/Zod schema accepts and
// rejects per_request pricing configs correctly.
// ---------------------------------------------------------------------------

describe("config schema - per_request pricing", () => {
    const baseConfig = `
adminKey: test-key
providers:
  test-provider:
    api_base_url: https://api.example.com/v1/chat/completions
    api_key: sk-test
    models:
      test-model:
        pricing:
          source: per_request
          amount: 0.002
        access_via: []
models:
  test-alias:
    targets:
      - provider: test-provider
        model: test-model
keys:
  user1:
    secret: sk-user1
`;

    test("accepts a valid per_request pricing config", () => {
        expect(() => validateConfig(baseConfig)).not.toThrow();
    });

    test("parsed pricing has correct source and amount", () => {
        const config = validateConfig(baseConfig);
        const model = (config.providers["test-provider"]!.models as Record<string, any>)["test-model"];
        expect(model.pricing.source).toBe("per_request");
        expect(model.pricing.amount).toBe(0.002);
    });

    test("rejects per_request pricing with negative amount", () => {
        const badConfig = baseConfig.replace("amount: 0.002", "amount: -1");
        expect(() => validateConfig(badConfig)).toThrow();
    });

    test("rejects per_request pricing with missing amount", () => {
        const badConfig = baseConfig.replace("          amount: 0.002\n", "");
        expect(() => validateConfig(badConfig)).toThrow();
    });

    test("accepts a zero amount (free model)", () => {
        const freeConfig = baseConfig.replace("amount: 0.002", "amount: 0");
        expect(() => validateConfig(freeConfig)).not.toThrow();
    });
});
