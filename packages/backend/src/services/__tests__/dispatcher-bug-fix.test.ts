import { describe, expect, test, beforeEach, spyOn, mock } from "bun:test";
import { Dispatcher } from "../dispatcher";
import { setConfigForTesting } from "../../config";
import { UnifiedChatRequest } from "../../types/unified";
import { logger } from "../../utils/logger";

// Mock fetch to prevent actual network calls
const fetchMock = mock(async (url: string, options: any) => {
    return new Response(JSON.stringify({
        id: "chatcmpl-123",
        object: "chat.completion",
        created: 1677652288,
        model: "claude-haiku-4.5-20251001",
        choices: [{
            index: 0,
            message: {
                role: "assistant",
                content: "Hello there!",
            },
            finish_reason: "stop",
        }],
        usage: {
            prompt_tokens: 9,
            completion_tokens: 12,
            total_tokens: 21,
        },
    }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
    });
});
global.fetch = fetchMock;

describe("Dispatcher Bug Fixes", () => {
    
    beforeEach(() => {
        // Reset mocks
        fetchMock.mockClear();
    });

    test("Handles empty access_via by falling back to provider type", async () => {
        const mockConfig = {
            providers: {
                "naga": {
                    type: "chat", // Provider supports 'chat'
                    api_base_url: "https://api.naga.ac/v1",
                    api_key: "test-key-123", // Add API key for authentication
                    models: {
                        "claude-haiku-4.5-20251001": {
                            pricing: { source: "simple", input: 0, output: 0 },
                            access_via: [] // The problematic config
                        }
                    }
                }
            },
            models: {
                "claude-haiku": {
                    targets: [
                        { provider: "naga", model: "claude-haiku-4.5-20251001" }
                    ]
                }
            },
            keys: {},
            adminKey: "secret"
        };

        setConfigForTesting(mockConfig as any);

        const dispatcher = new Dispatcher();
        const request: UnifiedChatRequest = {
            model: "claude-haiku",
            messages: [{ role: "user", content: "Hello" }],
            incomingApiType: "messages" // User request type
        };

        const response = await dispatcher.dispatch(request);

        expect(response).toBeDefined();
        expect(response.model).toBe("claude-haiku-4.5-20251001");
        
        // Check that the provider type 'chat' was used (since 'access_via' was empty)
        expect(response.plexus.apiType).toBe("chat");
        
        // Verify fetch was called
        expect(fetchMock).toHaveBeenCalled();
    });

    test("Throws descriptive error if no API type matches", async () => {
        const mockConfig = {
            providers: {
                "naga": {
                    type: [], // Empty provider types!
                    api_base_url: "https://api.naga.ac/v1",
                    api_key: "test-key-123", // Add API key for authentication
                    models: {
                        "claude-haiku-4.5-20251001": {
                            pricing: { source: "simple", input: 0, output: 0 },
                            access_via: [] // Also empty
                        }
                    }
                }
            },
            models: {
                "claude-haiku": {
                    targets: [
                        { provider: "naga", model: "claude-haiku-4.5-20251001" }
                    ]
                }
            },
            keys: {},
            adminKey: "secret"
        };

        setConfigForTesting(mockConfig as any);

        const dispatcher = new Dispatcher();
        const request: UnifiedChatRequest = {
            model: "claude-haiku",
            messages: [{ role: "user", content: "Hello" }]
        };

        // Should throw the new specific error
        await expect(dispatcher.dispatch(request)).rejects.toThrow("No available API type found");
    });
});
