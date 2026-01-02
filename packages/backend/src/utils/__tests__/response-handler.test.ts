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
        newResponse: mock((body) => ({ body })),
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
            "chat"
        );

        // Verify Usage Record updates
        expect(usageRecord.selectedModelName).toBe("model-orig");
        expect(usageRecord.provider).toBe("provider-1");
        expect(usageRecord.outgoingApiType).toBe("chat");
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
            "messages"
        );

        expect(usageRecord.selectedModelName).toBe("fallback-model");
        expect(usageRecord.provider).toBe("provider-2");
    });

    describe("Usage Mapping Regression Tests", () => {
        test("should correctly map all usage fields in non-streaming response", async () => {
            const unifiedResponse: UnifiedChatResponse = {
                id: "resp-3",
                model: "model-3",
                content: "Hello",
                usage: {
                    input_tokens: 111,
                    output_tokens: 222,
                    total_tokens: 333,
                    reasoning_tokens: 44,
                    cached_tokens: 55,
                    cache_creation_tokens: 0
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
                "chat"
            );

            expect(usageRecord.tokensInput).toBe(111);
            expect(usageRecord.tokensOutput).toBe(222);
            expect(usageRecord.tokensReasoning).toBe(44);
            expect(usageRecord.tokensCached).toBe(55);
            expect(mockStorage.saveRequest).toHaveBeenCalled();
        });

        test("should correctly map all usage fields in streaming response", async () => {
            const usageData = {
                input_tokens: 123,
                output_tokens: 456,
                total_tokens: 579,
                reasoning_tokens: 78,
                cached_tokens: 90,
                cache_creation_tokens: 0
            };

            const stream = new ReadableStream({
                start(controller) {
                    controller.enqueue({ usage: usageData });
                    controller.close();
                }
            });

            const unifiedResponse: UnifiedChatResponse = {
                id: "resp-stream-1",
                model: "model-stream",
                content: null,
                stream: stream
            };

            const usageRecord: Partial<UsageRecord> = {};
            
            // For streaming, handleResponse returns a Hono stream response.
            // We need to consume it to trigger the background usage recording.
            const result = await handleResponse(
                mockContext,
                unifiedResponse,
                mockTransformer,
                usageRecord,
                mockStorage,
                Date.now(),
                "chat"
            );

            // Mock the transformer's formatStream to just return the same stream for simplicity
            // or assume handleResponse handles it.
            
            // In the real implementation, handleResponse tees the stream and processes one half.
            // We need to wait for that background process.
            await new Promise(resolve => setTimeout(resolve, 50));

            expect(usageRecord.tokensInput).toBe(123);
            expect(usageRecord.tokensOutput).toBe(456);
            expect(usageRecord.tokensReasoning).toBe(78);
            expect(usageRecord.tokensCached).toBe(90);
        });
    });
});
