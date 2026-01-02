import { describe, expect, test, mock, beforeEach, afterEach, spyOn } from "bun:test";
import { Dispatcher } from "../dispatcher";
import { Router } from "../router";
import { TransformerFactory } from "../transformer-factory";
import { UnifiedChatRequest } from "../../types/unified";
import { DebugManager } from "../debug-manager";

// Remove mock.module calls
// mock.module("../router", ...);
// mock.module("../debug-manager", ...);

describe("Dispatcher Pass-through Optimization", () => {
    let dispatcher: Dispatcher;
    let mockTransformer: any;

    beforeEach(() => {
        dispatcher = new Dispatcher();
        mockTransformer = {
            name: "MockTransformer",
            defaultEndpoint: "/v1/chat/completions",
            transformRequest: mock(async () => ({ transformed: true })),
            transformResponse: mock(async () => ({ content: "transformed" })),
            transformStream: mock((s: any) => s)
        };
        spyOn(TransformerFactory, "getTransformer").mockReturnValue(mockTransformer);
        spyOn(Router, "resolve").mockReturnValue({} as any); // Default mock, overridden in tests
        spyOn(DebugManager, "getInstance").mockReturnValue({
            addTransformedRequest: mock(),
            addRawResponse: mock(),
            captureStream: mock(),
            isEnabled: () => false
        } as any);
        
        // Mock global fetch
        global.fetch = mock(() => Promise.resolve(new Response(JSON.stringify({ original: "response" })))) as any;
    });

    afterEach(() => {
        mock.restore();
    });

    test("should use originalBody when incomingApiType matches outgoing type", async () => {
        // Setup route to match incoming type
        (Router.resolve as any).mockReturnValue({
            provider: "test-provider",
            model: "test-model",
            config: {
                type: "chat", // Matches incoming
                api_base_url: "https://api.openai.com",
                api_key: "sk-test"
            },
            modelConfig: {}
        });

        const request: UnifiedChatRequest = {
            model: "test-alias",
            messages: [],
            incomingApiType: "chat",
            originalBody: { 
                model: "test-alias", 
                messages: [{ role: "user", content: "hello" }],
                some_openai_param: true
            }
        };

        const response = await dispatcher.dispatch(request);

        // Verify fetch was called with original body (with model swapped)
        const fetchCall = (global.fetch as any).mock.calls[0];
        const bodySent = JSON.parse(fetchCall[1].body);

        expect(bodySent.some_openai_param).toBe(true);
        expect(bodySent.model).toBe("test-model"); // Swapped
        
        // Verify transformRequest was NOT called (optimization)
        expect(mockTransformer.transformRequest).not.toHaveBeenCalled();

        // Verify response has bypass flag
        expect(response.bypassTransformation).toBe(true);
        expect(response.rawResponse).toEqual({ original: "response" });
    });

    test("should NOT use originalBody when types do not match", async () => {
        // Setup route to NOT match
        (Router.resolve as any).mockReturnValue({
            provider: "anthropic",
            model: "claude-3",
            config: {
                type: "messages", // Mismatch
                api_base_url: "https://api.anthropic.com",
                api_key: "sk-ant"
            },
            modelConfig: {}
        });

        const request: UnifiedChatRequest = {
            model: "test-alias",
            messages: [],
            incomingApiType: "chat", // Mismatch
            originalBody: { model: "test-alias" }
        };

        const response = await dispatcher.dispatch(request);

        // Verify transformRequest WAS called
        expect(mockTransformer.transformRequest).toHaveBeenCalled();
        
        // Verify response does NOT have bypass flag
        expect(response.bypassTransformation).toBeFalsy();
    });
});
