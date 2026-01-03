import { describe, expect, test, mock, beforeEach, afterEach, spyOn, beforeAll } from "bun:test";
import { Dispatcher } from "../services/dispatcher";
import { UsageStorageService } from "../services/usage-storage";

// Mock Config
mock.module('../config', () => {
    const { z } = require('zod');
    // Reconstruct the config object directly here since we want to ensure getConfig returns it
    const testConfig = {
        providers: {
            openai: {
                type: 'chat',
                api_base_url: 'https://api.openai.com/v1',
                api_key: 'test-key',
                models: ['gpt-4', 'gpt-3.5-turbo']
            }
        },
        models: {
            'gpt-4': {
                targets: [{ provider: 'openai', model: 'gpt-4' }]
            }
        },
        keys: {
            'test-key': {
                secret: 'sk-test-key',
                comment: 'Test Key'
            }
        },
        adminKey: 'test-admin-key'
    };

    return {
        loadConfig: () => Promise.resolve(testConfig),
        getConfig: () => testConfig,
        getConfigPath: () => '/tmp/test-config.yaml',
        validateConfig: () => testConfig,
        setConfigForTesting: () => {}
    };
});

describe("Streaming Usage Integration", () => {
    let dispatchSpy: any;
    let saveRequestSpy: any;
    let server: any;

    beforeAll(async () => {
        process.env.PLEXUS_DB_URL = ':memory:';
        
        // Load the module
        const module = await import("../index");
        server = module.default;
    });

    beforeEach(() => {
        dispatchSpy = spyOn(Dispatcher.prototype, 'dispatch');
        saveRequestSpy = spyOn(UsageStorageService.prototype, 'saveRequest').mockImplementation(() => {});
    });

    afterEach(() => {
        dispatchSpy.mockRestore();
        saveRequestSpy.mockRestore();
    });

    test("should capture usage tokens from stream chunks", async () => {
        // Prepare a mock stream that yields usage in the last chunk
        const stream = new ReadableStream({
            start(controller) {
                // Chunk 1: Content
                controller.enqueue({
                    id: "test-id",
                    model: "test-model",
                    delta: { content: "Hello" }
                });
                // Chunk 2: Usage
                controller.enqueue({
                    id: "test-id",
                    model: "test-model",
                    delta: {},
                    usage: {
                        input_tokens: 10,
                        output_tokens: 5,
                        total_tokens: 15,
                        cached_tokens: 2,
                        reasoning_tokens: 1,
                        cache_creation_tokens: 0
                    }
                });
                controller.close();
            }
        });

        dispatchSpy.mockResolvedValue({
            id: "test-id",
            model: "provider:test-model",
            stream: stream
        });

        // Trigger request
        const res = await server.fetch(new Request("http://localhost/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": "Bearer sk-test-key"
            },
            body: JSON.stringify({
                model: "minimax-m2.1",
                messages: [{ role: "user", content: "hi" }],
                stream: true
            })
        }));

        if (res.status !== 200) {
            console.log("Status:", res.status);
            console.log("Body:", await res.text());
        }
        expect(res.status).toBe(200);

        // Consume the response stream to ensure background tasks finish
        const reader = res.body?.getReader();
        while (true) {
            const { done } = await reader!.read();
            if (done) break;
        }

        // Wait a bit for the background async block in index.ts to finish
        // Since it's a 'finally' block after the reader loop, it might take a microtask
        await new Promise(resolve => setTimeout(resolve, 100));

        expect(saveRequestSpy).toHaveBeenCalled();
        const savedRecord = saveRequestSpy.mock.calls[0][0];

        expect(savedRecord.tokensInput).toBe(10);
        expect(savedRecord.tokensOutput).toBe(5);
        expect(savedRecord.tokensCached).toBe(2);
        expect(savedRecord.tokensReasoning).toBe(1);
        expect(savedRecord.isStreamed).toBe(true);
        expect(savedRecord.incomingModelAlias).toBe("minimax-m2.1");
        expect(savedRecord.selectedModelName).toBe("provider:test-model");
    });
});
