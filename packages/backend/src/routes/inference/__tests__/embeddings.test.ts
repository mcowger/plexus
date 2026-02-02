import { describe, it, expect, beforeAll } from "bun:test";
import Fastify, { FastifyInstance } from "fastify";
import { setConfigForTesting } from "../../../config";
import { registerInferenceRoutes } from "../index";
import { Dispatcher } from "../../../services/dispatcher";
import { UsageStorageService } from "../../../services/usage-storage";
import { mock } from "bun:test";
import { DebugManager } from "../../../services/debug-manager";
import { SelectorFactory } from "../../../services/selectors/factory";

describe("Embeddings Endpoint", () => {
    let fastify: FastifyInstance;
    let mockUsageStorage: UsageStorageService;
    let mockDispatcher: Dispatcher;

    beforeAll(async () => {
        fastify = Fastify();

        // Mock dispatcher with embeddings support
        mockDispatcher = {
            dispatch: mock(async () => ({
                id: '123',
                model: 'gpt-4',
                created: 123,
                content: 'test content',
                usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20, reasoning_tokens: 0, cached_tokens: 0, cache_creation_tokens: 0 }
            })),
            dispatchEmbeddings: mock(async () => ({
                object: "list",
                data: [
                    {
                        object: "embedding",
                        embedding: [0.1, 0.2, 0.3, -0.1, -0.2],
                        index: 0
                    }
                ],
                model: "text-embedding-3-small",
                usage: {
                    prompt_tokens: 8,
                    total_tokens: 8
                },
                plexus: {
                    provider: "openai",
                    model: "text-embedding-3-small",
                    apiType: "embeddings",
                    canonicalModel: "embeddings-small"
                }
            }))
        } as unknown as Dispatcher;

        mockUsageStorage = {
            saveRequest: mock(),
            saveError: mock(),
            updatePerformanceMetrics: mock()
        } as unknown as UsageStorageService;

        // Initialize singletons
        DebugManager.getInstance().setStorage(mockUsageStorage);
        SelectorFactory.setUsageStorage(mockUsageStorage);

        // Set config with embeddings models
        setConfigForTesting({
            providers: {
                openai: {
                    api_key: "sk-test",
                    api_base_url: "https://api.openai.com/v1",
                    estimateTokens: false,
                    models: {
                        "text-embedding-3-small": {
                            pricing: { source: "simple", input: 0.00002, output: 0 }
                        }
                    }
                }
            },
            models: {
                "embeddings-small": {
                    priority: "selector",
                    targets: [{ provider: "openai", model: "text-embedding-3-small" }]
                }
            },
            keys: {
                "test-key-1": { secret: "sk-valid-key", comment: "Test Key" }
            },
            adminKey: "admin-secret"
        });

        await registerInferenceRoutes(fastify, mockDispatcher, mockUsageStorage);
        await fastify.ready();
    });

    it("should accept embeddings request with single text input", async () => {
        const response = await fastify.inject({
            method: 'POST',
            url: '/v1/embeddings',
            headers: {
                authorization: 'Bearer sk-valid-key',
                'content-type': 'application/json'
            },
            payload: {
                model: 'embeddings-small',
                input: 'The quick brown fox jumps over the lazy dog'
            }
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);
        expect(body.object).toBe('list');
        expect(body.data).toBeArray();
        expect(body.data[0].object).toBe('embedding');
        expect(body.data[0].embedding).toBeArray();
        expect(body.model).toBe('text-embedding-3-small');
        expect(body.usage).toBeDefined();
        expect(body.usage.prompt_tokens).toBe(8);
    });

    it("should accept embeddings request with array input", async () => {
        // Mock batch response
        (mockDispatcher.dispatchEmbeddings as any).mockImplementationOnce(async () => ({
            object: "list",
            data: [
                { object: "embedding", embedding: [0.1, 0.2], index: 0 },
                { object: "embedding", embedding: [0.3, 0.4], index: 1 },
                { object: "embedding", embedding: [0.5, 0.6], index: 2 }
            ],
            model: "text-embedding-3-small",
            usage: { prompt_tokens: 24, total_tokens: 24 },
            plexus: {
                provider: "openai",
                model: "text-embedding-3-small",
                apiType: "embeddings"
            }
        }));

        const response = await fastify.inject({
            method: 'POST',
            url: '/v1/embeddings',
            headers: {
                authorization: 'Bearer sk-valid-key',
                'content-type': 'application/json'
            },
            payload: {
                model: 'embeddings-small',
                input: ['Text 1', 'Text 2', 'Text 3']
            }
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);
        expect(body.data).toHaveLength(3);
        expect(body.data[0].index).toBe(0);
        expect(body.data[1].index).toBe(1);
        expect(body.data[2].index).toBe(2);
    });

    it("should accept optional encoding_format parameter", async () => {
        const response = await fastify.inject({
            method: 'POST',
            url: '/v1/embeddings',
            headers: {
                authorization: 'Bearer sk-valid-key',
                'content-type': 'application/json'
            },
            payload: {
                model: 'embeddings-small',
                input: 'Test text',
                encoding_format: 'float'
            }
        });

        expect(response.statusCode).toBe(200);
    });

    it("should accept optional dimensions parameter", async () => {
        const response = await fastify.inject({
            method: 'POST',
            url: '/v1/embeddings',
            headers: {
                authorization: 'Bearer sk-valid-key',
                'content-type': 'application/json'
            },
            payload: {
                model: 'embeddings-small',
                input: 'Test text',
                dimensions: 256
            }
        });

        expect(response.statusCode).toBe(200);
    });

    it("should track usage correctly for embeddings", async () => {
        const response = await fastify.inject({
            method: 'POST',
            url: '/v1/embeddings',
            headers: {
                authorization: 'Bearer sk-valid-key',
                'content-type': 'application/json'
            },
            payload: {
                model: 'embeddings-small',
                input: 'Test input'
            }
        });

        expect(response.statusCode).toBe(200);

        const saveRequestCalls = (mockUsageStorage.saveRequest as any).mock.calls;
        const lastCall = saveRequestCalls[saveRequestCalls.length - 1];
        
        expect(lastCall[0].incomingApiType).toBe('embeddings');
        expect(lastCall[0].tokensInput).toBe(8);
        expect(lastCall[0].tokensOutput).toBe(0); // Embeddings have no output tokens
        expect(lastCall[0].responseStatus).toBe('success');
        expect(lastCall[0].apiKey).toBe('test-key-1');
    });

    it("should require authentication", async () => {
        const response = await fastify.inject({
            method: 'POST',
            url: '/v1/embeddings',
            headers: {
                'content-type': 'application/json'
            },
            payload: {
                model: 'embeddings-small',
                input: 'Test text'
            }
        });

        expect(response.statusCode).toBe(401);
    });

    it("should reject invalid API key", async () => {
        const response = await fastify.inject({
            method: 'POST',
            url: '/v1/embeddings',
            headers: {
                authorization: 'Bearer invalid-key',
                'content-type': 'application/json'
            },
            payload: {
                model: 'embeddings-small',
                input: 'Test text'
            }
        });

        expect(response.statusCode).toBe(401);
    });

    it("should support x-api-key header", async () => {
        const response = await fastify.inject({
            method: 'POST',
            url: '/v1/embeddings',
            headers: {
                'x-api-key': 'sk-valid-key',
                'content-type': 'application/json'
            },
            payload: {
                model: 'embeddings-small',
                input: 'Test text'
            }
        });

        expect(response.statusCode).toBe(200);
    });

    it("should track attribution when provided", async () => {
        const response = await fastify.inject({
            method: 'POST',
            url: '/v1/embeddings',
            headers: {
                authorization: 'Bearer sk-valid-key:my-app',
                'content-type': 'application/json'
            },
            payload: {
                model: 'embeddings-small',
                input: 'Test text'
            }
        });

        expect(response.statusCode).toBe(200);

        const saveRequestCalls = (mockUsageStorage.saveRequest as any).mock.calls;
        const lastCall = saveRequestCalls[saveRequestCalls.length - 1];
        expect(lastCall[0].attribution).toBe('my-app');
    });

    it("should handle dispatcher errors gracefully", async () => {
        // Mock error
        (mockDispatcher.dispatchEmbeddings as any).mockRejectedValueOnce(
            new Error("Provider unavailable")
        );

        const response = await fastify.inject({
            method: 'POST',
            url: '/v1/embeddings',
            headers: {
                authorization: 'Bearer sk-valid-key',
                'content-type': 'application/json'
            },
            payload: {
                model: 'embeddings-small',
                input: 'Test text'
            }
        });

        expect(response.statusCode).toBe(500);
        const body = JSON.parse(response.body);
        expect(body.error).toBeDefined();
        expect(body.error.message).toContain("Provider unavailable");

        // Verify error was logged
        const saveErrorCalls = (mockUsageStorage.saveError as any).mock.calls;
        expect(saveErrorCalls.length).toBeGreaterThan(0);
    });
});
