import { expect, test, describe } from "bun:test";
import { AnthropicTransformer } from "../anthropic";
import { UnifiedChatRequest, UnifiedChatResponse } from "../../types/unified";

describe("AnthropicTransformer", () => {
    const transformer = new AnthropicTransformer();

    test("parseRequest converts Anthropic user message to Unified", async () => {
        const input = {
            model: "claude-3",
            messages: [
                { role: "user", content: "Hello" }
            ],
            max_tokens: 100
        };
        const result = await transformer.parseRequest(input);
        expect(result.messages).toHaveLength(1);
        expect(result.messages[0].role).toBe("user");
        expect(result.messages[0].content).toBe("Hello");
        expect(result.model).toBe("claude-3");
    });

    test("formatResponse converts Unified response to Anthropic", async () => {
        const unified: UnifiedChatResponse = {
            id: "msg_123",
            model: "claude-3",
            content: "Hi there",
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
        };
        const result = await transformer.formatResponse(unified);
        expect(result.id).toBe("msg_123");
        expect(result.role).toBe("assistant");
        expect(result.content).toBeInstanceOf(Array);
        expect(result.content[0].text).toBe("Hi there");
    });

    test("transformResponse extracts thinking into reasoning_content", async () => {
        const anthropicResponse = {
            id: "msg_think",
            model: "claude-3-5-sonnet",
            content: [
                { type: "thinking", thinking: "I should say hello", signature: "sig1" },
                { type: "text", text: "Hello!" }
            ],
            usage: { input_tokens: 10, output_tokens: 20 }
        };
        const result = await transformer.transformResponse(anthropicResponse);
        expect(result.content).toBe("Hello!");
        expect(result.reasoning_content).toBe("I should say hello");
    });

    test("formatResponse converts reasoning_content to thinking block", async () => {
        const unified: UnifiedChatResponse = {
            id: "unified-think",
            model: "claude-3",
            content: "Hello!",
            reasoning_content: "My internal thought",
            usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 }
        };
        const result = await transformer.formatResponse(unified);
        expect(result.content).toHaveLength(2);
        expect(result.content[0].type).toBe("thinking");
        expect(result.content[0].thinking).toBe("My internal thought");
        expect(result.content[1].type).toBe("text");
        expect(result.content[1].text).toBe("Hello!");
    });

    test("usage details are mapped correctly", async () => {
        // Test Anthropic -> Unified (cache read)
        const anthropicResponse = {
            id: "msg_cache",
            model: "claude-3",
            content: [],
            usage: { 
                input_tokens: 100, 
                output_tokens: 50,
                cache_read_input_tokens: 25
            }
        };
        const unified = await transformer.transformResponse(anthropicResponse);
        expect(unified.usage?.prompt_tokens_details?.cached_tokens).toBe(25);

        // Test Unified -> Anthropic (cache read)
        const result = await transformer.formatResponse(unified);
        expect(result.usage.cache_read_input_tokens).toBe(25);
    });

    test("transformStream converts Anthropic events to unified chunks", async () => {
        const encoder = new TextEncoder();
        const events = [
            'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","model":"claude-3","usage":{"input_tokens":10}}}\n\n',
            'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
            'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}\n\n',
            'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":5}}\n\n'
        ];

        const stream = new ReadableStream({
            start(controller) {
                events.forEach(e => controller.enqueue(encoder.encode(e)));
                controller.close();
            }
        });

        const transformedStream = transformer.transformStream!(stream);
        const reader = transformedStream.getReader();
        
        const results = [];
        while(true) {
            const {done, value} = await reader.read();
            if (done) break;
            results.push(value);
        }

        expect(results).toHaveLength(3); // message_start, content_block_delta, message_delta
        expect(results[0].delta.role).toBe("assistant");
        expect(results[1].delta.content).toBe("Hello");
        expect(results[2].finish_reason).toBe("stop");
        expect(results[2].usage.completion_tokens).toBe(5);
    });

    test("formatStream converts unified chunks to Anthropic event stream", async () => {
        const unifiedChunks = [
            { id: "msg_1", model: "claude-3", delta: { role: "assistant" } },
            { id: "msg_1", model: "claude-3", delta: { content: "Hi" } },
            { id: "msg_1", model: "claude-3", finish_reason: "stop", usage: { completion_tokens: 5 } }
        ];

        const stream = new ReadableStream({
            start(controller) {
                unifiedChunks.forEach(c => controller.enqueue(c));
                controller.close();
            }
        });

        const formattedStream = transformer.formatStream!(stream);
        const reader = formattedStream.getReader();
        const decoder = new TextDecoder();
        
        let output = "";
        while(true) {
            const {done, value} = await reader.read();
            if (done) break;
            output += decoder.decode(value);
        }

        expect(output).toContain("event: message_start");
        expect(output).toContain("event: content_block_delta");
        expect(output).toContain('"text":"Hi"');
        expect(output).toContain("event: message_delta");
        expect(output).toContain('"stop_reason":"end_turn"');
        expect(output).toContain("event: message_stop");
    });
});
