import { describe, expect, test, mock } from "bun:test";
import { handleResponse } from "../response-handler";
import { FastifyReply } from "fastify";
import { UsageStorageService } from "../../services/usage-storage";
import { AnthropicTransformer, OpenAITransformer } from "../../transformers";
import { UnifiedChatResponse } from "../../types/unified";
import { UsageRecord } from "../../types/usage";
import { encode } from "eventsource-encoder";

// Mock Logger to see output during debugging if needed, but we used console.log
mock.module("../logger", () => ({
    logger: {
        debug: (...args: any[]) => console.log('DEBUG:', ...args),
        info: (...args: any[]) => console.log('INFO:', ...args),
        warn: (...args: any[]) => console.log('WARN:', ...args),
        error: (...args: any[]) => console.log('ERROR:', ...args),
        silly: (...args: any[]) => console.log('SILLY:', ...args)
    }
}));

describe("Cross-format Streaming Conversion", () => {
    const mockStorage = {
        saveRequest: mock(),
        saveError: mock(),
        updatePerformanceMetrics: mock()
    } as unknown as UsageStorageService;

    const mockReply = {
        send: mock(function(this: any, data) { return this; }),
        header: mock(function(this: any) { return this; }),
        code: mock(function(this: any) { return this; }),
    } as unknown as FastifyReply;

    test("should convert OpenAI provider stream to Anthropic client format", async () => {
        const encoder = new TextEncoder();
        
        // Mock OpenAI SSE stream with realistic chunks including finish_reason
        const chunks = [
            encode({ data: JSON.stringify({ id: "1", choices: [{ delta: { role: "assistant" } }] }) }),
            encode({ data: JSON.stringify({ id: "1", choices: [{ delta: { content: "Hello" } }] }) }),
            encode({ data: JSON.stringify({ id: "1", choices: [{ delta: { content: " world" } }] }) }),
            encode({ data: JSON.stringify({ id: "1", choices: [{ delta: {}, finish_reason: "stop" }], usage: { total_tokens: 10 } }) }),
            encode({ data: "[DONE]" })
        ];

        const providerStream = new ReadableStream({
            start(controller) {
                chunks.forEach(c => controller.enqueue(encoder.encode(c)));
                controller.close();
            }
        });

        const unifiedResponse: UnifiedChatResponse = {
            id: "stream-1",
            model: "test-model",
            content: null,
            stream: providerStream,
            plexus: {
                provider: "openai-provider",
                apiType: "chat", 
                model: "gpt-4"
            }
        };

        const clientTransformer = new AnthropicTransformer();
        const usageRecord: Partial<UsageRecord> = { requestId: "req-cross" };

        await handleResponse(
            mockReply,
            unifiedResponse,
            clientTransformer,
            usageRecord,
            mockStorage,
            Date.now(),
            "messages"
        );

        expect(mockReply.send).toHaveBeenCalled();
        const lastCall = (mockReply.send as any).mock.calls.at(-1);
        const resultStream = lastCall[0];
        
        const reader = resultStream.getReader();
        const decoder = new TextDecoder();
        let output = "";
        while(true) {
            const {done, value} = await reader.read();
            if (done) break;
            output += decoder.decode(value);
        }

        expect(output).toContain("event: message_start");
        expect(output).toContain("event: content_block_delta");
        expect(output).toContain("Hello");
        expect(output).toContain(" world");
        expect(output).toContain("event: message_stop");
    });

    test("should convert Anthropic provider stream to OpenAI client format", async () => {
        const encoder = new TextEncoder();
        
        // Mock Anthropic SSE stream
        const chunks = [
            encode({ event: "message_start", data: JSON.stringify({ message: { id: "msg1", model: "claude-3", role: "assistant" }, type: "message_start" }) }),
            encode({ event: "content_block_delta", data: JSON.stringify({ delta: { text: "Hi", type: "text_delta" }, index: 0, type: "content_block_delta" }) }),
            encode({ event: "message_delta", data: JSON.stringify({ delta: { stop_reason: "end_turn" }, type: "message_delta" }) }),
            encode({ event: "message_stop", data: JSON.stringify({ type: "message_stop" }) })
        ];

        const providerStream = new ReadableStream({
            start(controller) {
                chunks.forEach(c => controller.enqueue(encoder.encode(c)));
                controller.close();
            }
        });

        const unifiedResponse: UnifiedChatResponse = {
            id: "stream-2",
            model: "claude-alias",
            content: null,
            stream: providerStream,
            plexus: {
                provider: "anthropic-provider",
                apiType: "messages",
                model: "claude-3-opus"
            }
        };

        const clientTransformer = new OpenAITransformer();
        const usageRecord: Partial<UsageRecord> = { requestId: "req-cross-2" };

        await handleResponse(
            mockReply,
            unifiedResponse,
            clientTransformer,
            usageRecord,
            mockStorage,
            Date.now(),
            "chat"
        );

        const lastCall = (mockReply.send as any).mock.calls.at(-1);
        const resultStream = lastCall[0];
        
        const reader = resultStream.getReader();
        const decoder = new TextDecoder();
        let output = "";
        while(true) {
            const {done, value} = await reader.read();
            if (done) break;
            output += decoder.decode(value);
        }

        expect(output).toContain('data: {"id":"msg1"');
        expect(output).toContain('"content":"Hi"');
        expect(output).toContain('"finish_reason":"stop"');
        expect(output).toContain("data: [DONE]");
    });
});