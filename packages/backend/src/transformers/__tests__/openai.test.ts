import { expect, test, describe } from "bun:test";
import { OpenAITransformer } from "../openai";
import { UnifiedChatRequest, UnifiedChatResponse } from "../../types/unified";

describe("OpenAITransformer", () => {
    const transformer = new OpenAITransformer();

    test("parseRequest passes through standard fields", async () => {
        const input = {
            model: "gpt-4",
            messages: [{ role: "user", content: "Hello" }],
            max_tokens: 100,
            temperature: 0.5,
            reasoning: { effort: "high" }
        };
        const result = await transformer.parseRequest(input);
        expect(result.messages).toHaveLength(1);
        expect(result.model).toBe("gpt-4");
        expect(result.reasoning?.effort).toBe("high");
    });

    test("transformRequest returns valid OpenAI request payload", async () => {
        const unified: UnifiedChatRequest = {
            model: "gpt-4",
            messages: [{ role: "user", content: "Hi" } as any],
            max_tokens: 50
        };
        const result = await transformer.transformRequest(unified);
        expect(result.model).toBe("gpt-4");
        expect(result.messages[0].content).toBe("Hi");
    });

    test("transformResponse extracts content and usage", async () => {
        const openAIResponse = {
            id: "chatcmpl-123",
            model: "gpt-4",
            created: 1234567890,
            choices: [{
                index: 0,
                message: {
                    role: "assistant",
                    content: "Hello there",
                    tool_calls: null
                },
                finish_reason: "stop"
            }],
            usage: {
                prompt_tokens: 10,
                completion_tokens: 20,
                total_tokens: 30
            }
        };

        const result = await transformer.transformResponse(openAIResponse);
        expect(result.id).toBe("chatcmpl-123");
        expect(result.content).toBe("Hello there");
        expect(result.usage?.total_tokens).toBe(30);
    });

    test("transformResponse extracts reasoning_content", async () => {
        const openAIResponse = {
            id: "chatcmpl-reason",
            model: "deepseek-reasoner",
            choices: [{
                message: {
                    role: "assistant",
                    content: "The answer is 42",
                    reasoning_content: "Calculating answer..."
                }
            }],
            usage: { total_tokens: 10 }
        };

        const result = await transformer.transformResponse(openAIResponse);
        expect(result.content).toBe("The answer is 42");
        expect(result.reasoning_content).toBe("Calculating answer...");
    });

    test("transformResponse passes through detailed usage", async () => {
        const openAIResponse = {
            id: "chatcmpl-usage",
            model: "gpt-4",
            choices: [{}],
            usage: {
                prompt_tokens: 10,
                completion_tokens: 20,
                total_tokens: 30,
                prompt_tokens_details: { cached_tokens: 5 },
                completion_tokens_details: { reasoning_tokens: 15 }
            }
        };

        const result = await transformer.transformResponse(openAIResponse);
        expect(result.usage?.prompt_tokens_details?.cached_tokens).toBe(5);
        expect(result.usage?.completion_tokens_details?.reasoning_tokens).toBe(15);
    });

    test("formatResponse constructs OpenAI response with reasoning_content", async () => {
        const unified: UnifiedChatResponse = {
            id: "unified-123",
            model: "gpt-4",
            content: "Final answer",
            reasoning_content: "Thinking process",
            usage: {
                prompt_tokens: 10,
                completion_tokens: 10,
                total_tokens: 20
            }
        };

        const result = await transformer.formatResponse(unified);
        expect(result.id).toBe("unified-123");
        expect(result.choices[0].message.content).toBe("Final answer");
        expect(result.choices[0].message.reasoning_content).toBe("Thinking process");
    });

    test("transformStream converts OpenAI chunks to unified chunks", async () => {
        const encoder = new TextEncoder();
        const chunks = [
            'data: {"id":"1","choices":[{"delta":{"role":"assistant"}}]}\n\n',
            'data: {"id":"1","choices":[{"delta":{"content":"Hello"}}]}\n\n',
            'data: {"id":"1","choices":[{"delta":{"content":" world"}}]}\n\n',
            'data: {"id":"1","choices":[{"finish_reason":"stop"}],"usage":{"total_tokens":10}}\n\n',
            'data: [DONE]\n\n'
        ];

        const stream = new ReadableStream({
            start(controller) {
                chunks.forEach(c => controller.enqueue(encoder.encode(c)));
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

        expect(results).toHaveLength(4);
        expect(results[0].delta.role).toBe("assistant");
        expect(results[1].delta.content).toBe("Hello");
        expect(results[2].delta.content).toBe(" world");
        expect(results[3].finish_reason).toBe("stop");
        expect(results[3].usage.total_tokens).toBe(10);
    });

    test("formatStream converts unified chunks to OpenAI event stream", async () => {
        const unifiedChunks = [
            { id: "1", model: "gpt-4", delta: { role: "assistant" } },
            { id: "1", model: "gpt-4", delta: { content: "Hi" } },
            { id: "1", model: "gpt-4", finish_reason: "stop" }
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

        expect(output).toContain('data: {"id":"1"');
        expect(output).toContain('"role":"assistant"');
        expect(output).toContain('"content":"Hi"');
        expect(output).toContain('"finish_reason":"stop"');
        expect(output).toContain("data: [DONE]\n\n");
    });
});
