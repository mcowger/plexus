import { describe, it, expect, beforeAll, afterAll, mock } from "bun:test";
import Fastify, { FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import { setConfigForTesting } from "../../../config";
import { registerInferenceRoutes } from "../index";
import { Dispatcher } from "../../../services/dispatcher";
import { UsageStorageService } from "../../../services/usage-storage";
import { DebugManager } from "../../../services/debug-manager";
import { SelectorFactory } from "../../../services/selectors/factory";
import FormData from "form-data";

/**
 * Test suite to verify that binary audio files are NOT stored in debug logs
 * This is critical to prevent memory bloat and database size issues
 */
describe("Transcriptions Debug Logging", () => {
    let fastify: FastifyInstance;
    let mockUsageStorage: UsageStorageService;
    let mockDispatcher: Dispatcher;
    let debugManager: DebugManager;
    let savedDebugLogs: any[] = [];
    let wasDebugEnabled: boolean = false;

    beforeAll(async () => {
        // Save current debug state
        debugManager = DebugManager.getInstance();
        wasDebugEnabled = debugManager.isEnabled();
        
        fastify = Fastify({
            bodyLimit: 30 * 1024 * 1024 // 30MB
        });

        await fastify.register(multipart, {
            limits: {
                fileSize: 25 * 1024 * 1024, // 25MB
            },
            attachFieldsToBody: true,
        });

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

        // Create mock storage that captures saved debug logs
        savedDebugLogs = [];
        mockUsageStorage = {
            saveRequest: mock(),
            saveError: mock(),
            updatePerformanceMetrics: mock(),
            saveDebugLog: mock((log: any) => {
                savedDebugLogs.push(log);
            })
        } as unknown as UsageStorageService;

        // Initialize singletons and enable debug mode
        debugManager.setStorage(mockUsageStorage);
        debugManager.setEnabled(true); // Enable debug mode for this test
        SelectorFactory.setUsageStorage(mockUsageStorage);

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
            adminKey: "admin-secret"
        });

        await registerInferenceRoutes(fastify, mockDispatcher, mockUsageStorage);
        await fastify.ready();
    });

    afterAll(() => {
        // Restore original debug state
        debugManager.setEnabled(wasDebugEnabled);
    });

    it("should NOT store binary audio data in debug logs", async () => {
        // Create a large audio buffer to make it obvious if it gets stored
        const largeAudioBuffer = Buffer.alloc(5 * 1024 * 1024); // 5MB
        largeAudioBuffer.fill('A'); // Fill with recognizable data
        
        const form = new FormData();
        form.append('file', largeAudioBuffer, {
            filename: 'large-test.wav',
            contentType: 'audio/wav'
        });
        form.append('model', 'transcription-model');
        form.append('response_format', 'json');

        const response = await fastify.inject({
            method: 'POST',
            url: '/v1/audio/transcriptions',
            headers: {
                authorization: 'Bearer sk-valid-key',
                'content-type': `multipart/form-data; boundary=${form.getBoundary()}`
            },
            payload: form.getBuffer()
        });

        expect(response.statusCode).toBe(200);

        // Verify debug log was saved
        expect(savedDebugLogs.length).toBeGreaterThan(0);
        
        const debugLog = savedDebugLogs[savedDebugLogs.length - 1];
        
        // Check rawRequest (from route handler startLog)
        expect(debugLog.rawRequest).toBeDefined();
        expect(debugLog.rawRequest.filename).toBe('large-test.wav');
        expect(debugLog.rawRequest.fileSize).toBe(5 * 1024 * 1024);
        expect(debugLog.rawRequest.mimeType).toBe('audio/wav');
        
        // CRITICAL: Ensure the binary file buffer is NOT in the debug log
        expect(debugLog.rawRequest.file).toBeUndefined();
        
        // Convert debug log to JSON string to check size
        const debugLogJson = JSON.stringify(debugLog);
        
        // The debug log should be small (< 10KB), not 5MB+
        // If the binary data was included, it would be much larger
        expect(debugLogJson.length).toBeLessThan(10000);
        
        // Verify it doesn't contain the buffer data
        expect(debugLogJson).not.toContain('AAAAA'); // Our fill pattern
    });

    it("should include all request metadata in rawRequest", async () => {
        savedDebugLogs = []; // Clear previous logs
        
        const audioBuffer = Buffer.from('test-audio-data');
        
        const form = new FormData();
        form.append('file', audioBuffer, {
            filename: 'test.mp3',
            contentType: 'audio/mpeg'
        });
        form.append('model', 'transcription-model');
        form.append('language', 'en');
        form.append('prompt', 'Test prompt');
        form.append('temperature', '0.5');

        await fastify.inject({
            method: 'POST',
            url: '/v1/audio/transcriptions',
            headers: {
                authorization: 'Bearer sk-valid-key',
                'content-type': `multipart/form-data; boundary=${form.getBoundary()}`
            },
            payload: form.getBuffer()
        });

        const debugLog = savedDebugLogs[savedDebugLogs.length - 1];
        
        // Check rawRequest contains all metadata
        expect(debugLog.rawRequest).toBeDefined();
        expect(debugLog.rawRequest.model).toBe('transcription-model');
        expect(debugLog.rawRequest.filename).toBe('test.mp3');
        expect(debugLog.rawRequest.mimeType).toBe('audio/mpeg');
        expect(debugLog.rawRequest.language).toBe('en');
        expect(debugLog.rawRequest.prompt).toBe('(provided)'); // We log '(provided)' instead of actual prompt
        expect(debugLog.rawRequest.temperature).toBe(0.5);
        
        // CRITICAL: Binary file should not be in rawRequest
        expect(debugLog.rawRequest.file).toBeUndefined();
    });
});
