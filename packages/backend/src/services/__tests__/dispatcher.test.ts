import { expect, test, describe, mock, spyOn, beforeEach, afterEach } from "bun:test";
import { Dispatcher } from "../dispatcher";
import { Router } from "../router";
import { TransformerFactory } from "../transformer-factory";
import { UnifiedChatRequest, UnifiedChatResponse } from "../../types/unified";
import { CooldownManager } from "../cooldown-manager";

// Mock Logger to suppress output
mock.module("../../utils/logger", () => ({
    logger: {
        info: mock(),
        error: mock(),
        warn: mock(),
        debug: mock(),
        silly: mock(),
    }
}));

describe("Dispatcher", () => {
    let dispatcher: Dispatcher;
    let cooldownSpy: any;
    
    // Mock Data
    const mockRequest: UnifiedChatRequest = {
        model: "test-model",
        messages: [{ role: "user", content: "hello" }]
    };

    const mockRouteConfig = {
        type: "chat",
        api_base_url: "https://api.example.com/v1",
        api_key: "test-key",
        headers: { "X-Custom-Header": "custom-value" }
    };

    const mockRoute = {
        provider: "test-provider",
        model: "target-model",
        config: mockRouteConfig
    };

    const mockTransformer = {
        name: "chat",
        defaultEndpoint: "/chat/completions",
        transformRequest: mock((_req: any) => Promise.resolve({ transformed: "request" })),
        transformResponse: mock((_res: any) => Promise.resolve({ 
            id: "resp-1", 
            model: "target-model", 
            content: "response" 
        } as UnifiedChatResponse))
    };

    afterEach(() => {
        mock.restore();
        if (cooldownSpy) cooldownSpy.mockRestore();
    });

    beforeEach(() => {
        dispatcher = new Dispatcher();
        cooldownSpy = spyOn(CooldownManager, "getInstance").mockReturnValue({
            markProviderFailure: mock(),
            isProviderHealthy: mock(() => true),
            filterHealthyTargets: mock((t: any) => t),
            removeCooldowns: mock((t: any) => t),
            setStorage: mock(),
            getCooldowns: mock(() => [])
        } as any);
    });

    test("dispatches request with correct url, headers and body", async () => {
        // Mock Router
        spyOn(Router, "resolve").mockReturnValue(mockRoute as any);
        
        // Mock TransformerFactory
        spyOn(TransformerFactory, "getTransformer").mockReturnValue(mockTransformer as any);

        // Mock fetch
        global.fetch = mock(() => Promise.resolve(new Response(JSON.stringify({ raw: "response" })))) as any;

        await dispatcher.dispatch(mockRequest);

        // Verify Router call
        expect(Router.resolve).toHaveBeenCalledWith("test-model");

        // Verify TransformerFactory call
        expect(TransformerFactory.getTransformer).toHaveBeenCalledWith("chat");

        // Verify transformRequest call
        expect(mockTransformer.transformRequest).toHaveBeenCalled();
        const transformCallArg = mockTransformer.transformRequest.mock.calls[0]![0];
        expect(transformCallArg.model).toBe("target-model"); // Model should be overridden

        // Verify fetch call
        expect(global.fetch).toHaveBeenCalled();
        const fetchCall = (global.fetch as any).mock.calls[0];
        const url = fetchCall[0];
        const options = fetchCall[1];

        expect(url).toBe("https://api.example.com/v1/chat/completions");
        expect(options.method).toBe("POST");
        expect(options.headers["Content-Type"]).toBe("application/json");
        expect(options.headers["Authorization"]).toBe("Bearer test-key");
        expect(options.headers["X-Custom-Header"]).toBe("custom-value"); // Custom header check
        expect(options.body).toBe(JSON.stringify({ transformed: "request" }));

        // Verify transformResponse call
        expect(mockTransformer.transformResponse).toHaveBeenCalledWith({ raw: "response" });
    });

    test("handles Anthropic specific headers", async () => {
        const anthropicRoute = {
            ...mockRoute,
            config: { ...mockRouteConfig, type: "messages" }
        };

        spyOn(Router, "resolve").mockReturnValue(anthropicRoute as any);
        spyOn(TransformerFactory, "getTransformer").mockReturnValue(mockTransformer as any);
        global.fetch = mock(() => Promise.resolve(new Response(JSON.stringify({})))) as any;

        await dispatcher.dispatch(mockRequest);

        const fetchCall = (global.fetch as any).mock.calls[0];
        const headers = fetchCall[1].headers;

        expect(headers["x-api-key"]).toBe("test-key");
        expect(headers["anthropic-version"]).toBe("2023-06-01");
        expect(headers["Authorization"]).toBeUndefined();
    });

    test("throws error on provider failure", async () => {
        spyOn(Router, "resolve").mockReturnValue(mockRoute as any);
        spyOn(TransformerFactory, "getTransformer").mockReturnValue(mockTransformer as any);
        
        global.fetch = mock(() => Promise.resolve(new Response("Error", { status: 500 }))) as any;

        expect(dispatcher.dispatch(mockRequest)).rejects.toThrow("Provider failed: 500 Error");
    });

    test("injects extraBody from config into request body", async () => {
        const extraBodyRoute = {
            ...mockRoute,
            config: { 
                ...mockRouteConfig, 
                extraBody: { "stream_options": { "include_usage": true }, "custom_param": "value" }
            }
        };

        spyOn(Router, "resolve").mockReturnValue(extraBodyRoute as any);
        spyOn(TransformerFactory, "getTransformer").mockReturnValue(mockTransformer as any);
        global.fetch = mock(() => Promise.resolve(new Response(JSON.stringify({})))) as any;

        await dispatcher.dispatch(mockRequest);

        const fetchCall = (global.fetch as any).mock.calls[0];
        const body = JSON.parse(fetchCall[1].body);

        expect(body.transformed).toBe("request");
        expect(body.stream_options).toEqual({ "include_usage": true });
        expect(body.custom_param).toBe("value");
    });
});