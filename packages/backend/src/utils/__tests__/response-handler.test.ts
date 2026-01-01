import { describe, expect, test, mock } from "bun:test";
import { handleResponse } from "../response-handler";
import { Context } from "hono";
import { UsageStorageService } from "../../services/usage-storage";
import { Transformer } from "../../types/transformer";
import { UnifiedChatResponse } from "../../types/unified";
import { UsageRecord } from "../../types/usage";

// Mock Logger
mock.module("../logger", () => ({
    logger: {
        debug: mock(),
    }
}));

describe("handleResponse", () => {
    const mockStorage = {
        saveRequest: mock()
    } as unknown as UsageStorageService;

    const mockTransformer: Transformer = {
        defaultEndpoint: "/test",
        parseRequest: mock(),
        transformRequest: mock(),
        transformResponse: mock(),
        formatResponse: mock((r) => Promise.resolve({ formatted: true, ...r })),
    };

    const mockContext = {
        json: mock((data) => data),
        header: mock(),
    } as unknown as Context;

    test("should process non-streaming response correctly", async () => {
        const unifiedResponse: UnifiedChatResponse = {
            id: "resp-1",
            model: "model-1",
            content: "Hello",
            plexus: {
                provider: "provider-1",
                model: "model-orig",
                apiType: "openai"
            },
            usage: {
                input_tokens: 10,
                output_tokens: 20,
                total_tokens: 30,
                reasoning_tokens: 0,
                cached_tokens: 0,
                cache_creation_tokens: 0
            }
        };

        const usageRecord: Partial<UsageRecord> = {
            requestId: "req-1"
        };

        const result = await handleResponse(
            mockContext,
            unifiedResponse,
            mockTransformer,
            usageRecord,
            mockStorage,
            Date.now(),
            "openai"
        );

        // Verify Usage Record updates
        expect(usageRecord.selectedModelName).toBe("model-orig");
        expect(usageRecord.provider).toBe("provider-1");
        expect(usageRecord.outgoingApiType).toBe("openai");
        expect(usageRecord.tokensInput).toBe(10);
        expect(usageRecord.tokensOutput).toBe(20);
        expect(usageRecord.responseStatus).toBe("success");
        
        // Verify Storage called
        expect(mockStorage.saveRequest).toHaveBeenCalled();

        // Verify Response Formatting (plexus stripped)
        expect(result.plexus).toBeUndefined();
        expect(result.formatted).toBe(true);
    });

    test("should fallback to unifiedResponse.model if plexus.model missing", async () => {
        const unifiedResponse: UnifiedChatResponse = {
            id: "resp-2",
            model: "fallback-model",
            content: "Hi",
            plexus: {
                provider: "provider-2"
            }
        };

        const usageRecord: Partial<UsageRecord> = {};

        await handleResponse(
            mockContext,
            unifiedResponse,
            mockTransformer,
            usageRecord,
            mockStorage,
            Date.now(),
            "anthropic"
        );

        expect(usageRecord.selectedModelName).toBe("fallback-model");
        expect(usageRecord.provider).toBe("provider-2");
    });
});
