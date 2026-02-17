import { describe, it, expect, beforeAll } from "bun:test";
import Fastify, { FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import { setConfigForTesting } from "../../../config";
import { registerInferenceRoutes } from "../index";
import { Dispatcher } from "../../../services/dispatcher";
import { UsageStorageService } from "../../../services/usage-storage";
import { mock } from "bun:test";
import { DebugManager } from "../../../services/debug-manager";
import { SelectorFactory } from "../../../services/selectors/factory";
import FormData from "form-data";

// Helper to create multipart form-data payload using form-data package
function createMultipartPayload(fields: Record<string, any>, file?: { buffer: Buffer, filename: string, mimeType: string }) {
    const form = new FormData();
    
    // Add file if provided
    if (file) {
        form.append('file', file.buffer, {
            filename: file.filename,
            contentType: file.mimeType
        });
    }
    
    // Add other fields
    for (const [key, value] of Object.entries(fields)) {
        if (value !== undefined && value !== null) {
            form.append(key, String(value));
        }
    }
    
    return {
        boundary: form.getBoundary(),
        payload: form.getBuffer()
    };
}

describe("Transcriptions Endpoint", () => {
    let fastify: FastifyInstance;
    let mockUsageStorage: UsageStorageService;
    let mockDispatcher: Dispatcher;

    beforeAll(async () => {
        fastify = Fastify({
            bodyLimit: 30 * 1024 * 1024 // 30MB
        });

        // Register multipart support
        await fastify.register(multipart, {
            limits: {
                fileSize: 25 * 1024 * 1024, // 25MB
            },
            attachFieldsToBody: true,
        });

        // Mock dispatcher with transcriptions support
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
                data: [],
                model: "text-embedding-3-small",
                usage: { prompt_tokens: 8, total_tokens: 8 }
            })),
            dispatchTranscription: mock(async () => ({
                text: "This is a test transcription.",
                usage: {
                    input_tokens: 150,
                    output_tokens: 25,
                    total_tokens: 175
                },
                plexus: {
                    provider: "openai",
                    model: "whisper-1",
                    apiType: "transcriptions",
                    canonicalModel: "transcription-model",
                    pricing: { source: "simple", input: 0.006, output: 0 }
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

        // Set config with transcription models
        setConfigForTesting({
            providers: {
                openai: {
                    api_key: "sk-test",
                    api_base_url: "https://api.openai.com/v1",
                    estimateTokens: false,
                    models: {
                        "whisper-1": {
                            type: "transcriptions",
                            pricing: { source: "simple", input: 0.006, output: 0 }
                        }
                    }
                }
            },
            models: {
                "transcription-model": {
                    type: "transcriptions",
                    priority: "selector",
                    targets: [{ provider: "openai", model: "whisper-1" }]
                }
            },
            keys: {
                "test-key-1": { secret: "sk-valid-key", comment: "Test Key" }
            },
            adminKey: "admin-secret",
            failover: { enabled: false, retryableStatusCodes: [429, 500, 502, 503, 504], retryableErrors: ["ECONNREFUSED", "ETIMEDOUT"] },
            quotas: []
        });

        await registerInferenceRoutes(fastify, mockDispatcher, mockUsageStorage);
        await fastify.ready();
    });

    it("should accept transcription request with audio file (JSON format)", async () => {
        const audioBuffer = Buffer.from('fake-audio-data');
        
        const { boundary, payload } = createMultipartPayload(
            { model: 'transcription-model', response_format: 'json' },
            { buffer: audioBuffer, filename: 'test.wav', mimeType: 'audio/wav' }
        );

        const response = await fastify.inject({
            method: 'POST',
            url: '/v1/audio/transcriptions',
            headers: {
                authorization: 'Bearer sk-valid-key',
                'content-type': `multipart/form-data; boundary=${boundary}`
            },
            payload
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);
        expect(body).toHaveProperty('text');
        expect(body.text).toBe('This is a test transcription.');
        expect(mockDispatcher.dispatchTranscription).toHaveBeenCalled();
    });

    it("should accept transcription request with text response format", async () => {
        const audioBuffer = Buffer.from('fake-audio-data');
        
        const { boundary, payload } = createMultipartPayload(
            { model: 'transcription-model', response_format: 'text' },
            { buffer: audioBuffer, filename: 'test.mp3', mimeType: 'audio/mpeg' }
        );

        const response = await fastify.inject({
            method: 'POST',
            url: '/v1/audio/transcriptions',
            headers: {
                authorization: 'Bearer sk-valid-key',
                'content-type': `multipart/form-data; boundary=${boundary}`
            },
            payload
        });

        expect(response.statusCode).toBe(200);
        expect(response.headers['content-type']).toContain('text/plain');
        expect(response.body).toBe('This is a test transcription.');
    });

    it("should accept optional parameters (language, prompt, temperature)", async () => {
        const audioBuffer = Buffer.from('fake-audio-data');
        
        const { boundary, payload } = createMultipartPayload(
            {
                model: 'transcription-model',
                language: 'en',
                prompt: 'This is a test prompt.',
                temperature: '0.5',
                response_format: 'json'
            },
            { buffer: audioBuffer, filename: 'test.mp3', mimeType: 'audio/mpeg' }
        );

        const response = await fastify.inject({
            method: 'POST',
            url: '/v1/audio/transcriptions',
            headers: {
                authorization: 'Bearer sk-valid-key',
                'content-type': `multipart/form-data; boundary=${boundary}`
            },
            payload
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);
        expect(body).toHaveProperty('text');
        
        // Verify dispatcher was called with correct parameters (get the latest call)
        const calls = (mockDispatcher.dispatchTranscription as any).mock.calls;
        const request = calls[calls.length - 1][0];
        expect(request.language).toBe('en');
        expect(request.prompt).toBe('This is a test prompt.');
        expect(request.temperature).toBe(0.5);
    });

    it("should reject request without file", async () => {
        const { boundary, payload } = createMultipartPayload({ model: 'transcription-model' });

        const response = await fastify.inject({
            method: 'POST',
            url: '/v1/audio/transcriptions',
            headers: {
                authorization: 'Bearer sk-valid-key',
                'content-type': `multipart/form-data; boundary=${boundary}`
            },
            payload
        });

        expect(response.statusCode).toBe(400);
        const body = JSON.parse(response.body);
        expect(body.error.message).toContain('No file uploaded');
    });

    it("should reject request without model parameter", async () => {
        const audioBuffer = Buffer.from('fake-audio-data');
        
        const { boundary, payload } = createMultipartPayload(
            {},
            { buffer: audioBuffer, filename: 'test.mp3', mimeType: 'audio/mpeg' }
        );

        const response = await fastify.inject({
            method: 'POST',
            url: '/v1/audio/transcriptions',
            headers: {
                authorization: 'Bearer sk-valid-key',
                'content-type': `multipart/form-data; boundary=${boundary}`
            },
            payload
        });

        expect(response.statusCode).toBe(400);
        const body = JSON.parse(response.body);
        expect(body.error.message).toContain('Missing required parameter: model');
    });

    it("should reject unsupported response format", async () => {
        const audioBuffer = Buffer.from('fake-audio-data');
        
        const { boundary, payload } = createMultipartPayload(
            { model: 'transcription-model', response_format: 'srt' },
            { buffer: audioBuffer, filename: 'test.mp3', mimeType: 'audio/mpeg' }
        );

        const response = await fastify.inject({
            method: 'POST',
            url: '/v1/audio/transcriptions',
            headers: {
                authorization: 'Bearer sk-valid-key',
                'content-type': `multipart/form-data; boundary=${boundary}`
            },
            payload
        });

        expect(response.statusCode).toBe(400);
        const body = JSON.parse(response.body);
        expect(body.error.message).toContain('Unsupported response_format');
    });

    it("should reject file exceeding 25MB limit", async () => {
        // Create a buffer larger than 25MB
        const largeBuffer = Buffer.alloc(26 * 1024 * 1024);
        
        const { boundary, payload } = createMultipartPayload(
            { model: 'transcription-model' },
            { buffer: largeBuffer, filename: 'large.mp3', mimeType: 'audio/mpeg' }
        );

        const response = await fastify.inject({
            method: 'POST',
            url: '/v1/audio/transcriptions',
            headers: {
                authorization: 'Bearer sk-valid-key',
                'content-type': `multipart/form-data; boundary=${boundary}`
            },
            payload
        });

        // Should be rejected by either Fastify or our validation
        expect([400, 413]).toContain(response.statusCode);
    });

    it("should require authentication", async () => {
        const audioBuffer = Buffer.from('fake-audio-data');
        
        const { boundary, payload } = createMultipartPayload(
            { model: 'transcription-model' },
            { buffer: audioBuffer, filename: 'test.mp3', mimeType: 'audio/mpeg' }
        );

        const response = await fastify.inject({
            method: 'POST',
            url: '/v1/audio/transcriptions',
            headers: {
                'content-type': `multipart/form-data; boundary=${boundary}`
                // No authorization header
            },
            payload
        });

        expect(response.statusCode).toBe(401);
    });

    it("should track usage metrics", async () => {
        const audioBuffer = Buffer.from('fake-audio-data');
        
        const { boundary, payload } = createMultipartPayload(
            { model: 'transcription-model' },
            { buffer: audioBuffer, filename: 'test.mp3', mimeType: 'audio/mpeg' }
        );

        await fastify.inject({
            method: 'POST',
            url: '/v1/audio/transcriptions',
            headers: {
                authorization: 'Bearer sk-valid-key',
                'content-type': `multipart/form-data; boundary=${boundary}`
            },
            payload
        });

        expect(mockUsageStorage.saveRequest).toHaveBeenCalled();
        const usageCall = (mockUsageStorage.saveRequest as any).mock.calls[0];
        const usageRecord = usageCall[0];
        
        expect(usageRecord.incomingApiType).toBe('transcriptions');
        expect(usageRecord.outgoingApiType).toBe('transcriptions');
        expect(usageRecord.isPassthrough).toBe(true);
        expect(usageRecord.provider).toBe('openai');
        expect(usageRecord.selectedModelName).toBe('whisper-1');
    });
});
