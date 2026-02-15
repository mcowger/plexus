import { describe, expect, test, mock } from "bun:test";
import { handleResponse } from "../../services/response-handler";
import { FastifyReply, FastifyRequest } from "fastify";
import { UsageStorageService } from "../../services/usage-storage";
import { Transformer } from "../../types/transformer";
import { UnifiedChatResponse } from "../../types/unified";
import { UsageRecord } from "../../types/usage";

describe("handleResponse", () => {
    const mockStorage = {
        saveRequest: mock(),
        saveError: mock(),
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

    test("should process non-streaming response correctly", async () => {
        const unifiedResponse: UnifiedChatResponse = {
            id: "resp-1",
            model: "model-1",
            content: "Hello",
            plexus: {
                provider: "provider-1",
                model: "model-orig",
                apiType: "chat"
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

        // Verify Usage Record updates
        expect(usageRecord.selectedModelName).toBe("model-orig");
        expect(usageRecord.provider).toBe("provider-1");
        expect(usageRecord.outgoingApiType).toBe("chat");
        expect(usageRecord.tokensInput).toBe(10);
        expect(usageRecord.tokensOutput).toBe(20);
        expect(usageRecord.responseStatus).toBe("success");
        
        // Verify Storage called
        expect(mockStorage.saveRequest).toHaveBeenCalled();

        // Verify send called with formatted response
        const lastCall = (mockReply.send as any).mock.calls.at(-1);
        const result = lastCall[0];
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
            mockRequest,
            mockReply,
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
                    cache_creation_tokens: 66
                }
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
                "chat"
            );

            expect(usageRecord.tokensInput).toBe(111);
            expect(usageRecord.tokensOutput).toBe(222);
            expect(usageRecord.tokensReasoning).toBe(44);
            expect(usageRecord.tokensCached).toBe(55);
            expect(usageRecord.tokensCacheWrite).toBe(66);
            expect(mockStorage.saveRequest).toHaveBeenCalled();
        });

    });
});
