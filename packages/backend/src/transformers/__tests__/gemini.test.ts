import { expect, test, describe } from "bun:test";
import { GeminiTransformer } from "../gemini";
import { UnifiedChatRequest, UnifiedChatResponse } from "../../types/unified";

describe("GeminiTransformer", () => {
    const transformer = new GeminiTransformer();

    test("getEndpoint returns correct Gemini URL for stream and non-stream", () => {
        const nonStreamReq: UnifiedChatRequest = { model: "gemini-1.5-pro", messages: [] };
        const streamReq: UnifiedChatRequest = { model: "gemini-1.5-pro", messages: [], stream: true };

        expect(transformer.getEndpoint!(nonStreamReq)).toBe("/v1beta/models/gemini-1.5-pro:generateContent");
        expect(transformer.getEndpoint!(streamReq)).toBe("/v1beta/models/gemini-1.5-pro:streamGenerateContent?alt=sse");
    });

    test("parseRequest converts Gemini client request to Unified", async () => {
        const input = {
            model: "gemini-1.5-pro",
            contents: [
                { role: "user", parts: [{ text: "Hello" }] }
            ],
            generationConfig: {
                temperature: 0.7,
                maxOutputTokens: 100
            }
        };
        const result = await transformer.parseRequest(input);
        expect(result.messages).toHaveLength(1);
        expect(result.messages[0]!.role).toBe("user");
        expect(result.messages[0]!.content).toBe("Hello");
        expect(result.model).toBe("gemini-1.5-pro");
        expect(result.temperature).toBe(0.7);
        expect(result.max_tokens).toBe(100);
    });

    test("transformRequest returns valid Gemini provider payload", async () => {
        const unified: UnifiedChatRequest = {
            model: "gemini-1.5-pro",
            messages: [
                { role: "system", content: "You are a helpful assistant." },
                { role: "user", content: "Hi" }
            ],
            max_tokens: 50,
            temperature: 0.5
        };
        const result = await transformer.transformRequest(unified);
        expect(result.contents).toHaveLength(2);
        expect(result.contents![0]!.role).toBe("user"); // System mapped to user
        expect(result.contents![1]!.role).toBe("user");
        expect(result.generationConfig!.maxOutputTokens).toBe(50);
        expect(result.generationConfig!.temperature).toBe(0.5);
    });

    test("transformResponse extracts content and usage from Gemini response", async () => {
        const geminiResponse = {
            responseId: "resp-123",
            modelVersion: "gemini-1.5-flash",
            candidates: [{
                index: 0,
                content: {
                    role: "model",
                    parts: [{ text: "Greetings!" }]
                },
                finishReason: "STOP"
            }],
            usageMetadata: {
                promptTokenCount: 10,
                candidatesTokenCount: 5,
                totalTokenCount: 15
            }
        };

        const result = await transformer.transformResponse(geminiResponse);
        expect(result.id).toBe("resp-123");
        expect(result.content).toBe("Greetings!");
        expect(result.usage?.total_tokens).toBe(15);
    });

    test("transformResponse handles reasoning_content (thinking)", async () => {
        const geminiResponse = {
            candidates: [{
                content: {
                    parts: [
                        { text: "Thinking process...", thought: true },
                        { text: "Final answer." }
                    ]
                }
            }]
        };

        const result = await transformer.transformResponse(geminiResponse);
        expect(result.content).toBe("Final answer.");
        expect(result.reasoning_content).toBe("Thinking process...");
    });

    test("formatResponse constructs Gemini response from Unified", async () => {
        const unified: UnifiedChatResponse = {
            id: "unified-123",
            model: "gemini-pro",
            content: "Hello world",
            reasoning_content: "My thoughts",
            usage: {
                prompt_tokens: 10,
                completion_tokens: 10,
                total_tokens: 20
            }
        };

        const result = await transformer.formatResponse(unified);
        expect(result.candidates[0]!.content!.parts).toHaveLength(2);
        expect(result.candidates[0]!.content!.parts![0]!.text).toBe("My thoughts");
        expect(result.candidates[0]!.content!.parts![1]!.text).toBe("Hello world");
        expect(result.usageMetadata!.totalTokenCount).toBe(20);
    });

    test("transformStream converts Gemini chunks to unified chunks", async () => {
        const encoder = new TextEncoder();
        const chunks = [
            'data: {"responseId":"1","modelVersion":"m1","candidates":[{"content":{"parts":[{"text":"Hel"}]}}]}', 
            'data: {"responseId":"1","modelVersion":"m1","candidates":[{"content":{"parts":[{"text":"lo"}]}}]}', 
            'data: {"responseId":"1","modelVersion":"m1","candidates":[{"finishReason":"STOP"}],"usageMetadata":{"totalTokenCount":10}}'
        ];

        const stream = new ReadableStream({
            start(controller) {
                chunks.forEach(c => controller.enqueue(encoder.encode(c + "\n\n")));
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

        expect(results).toHaveLength(3);
        expect(results[0].delta.content).toBe("Hel");
        expect(results[1].delta.content).toBe("lo");
        expect(results[2].finish_reason).toBe("stop");
        expect(results[2].usage.total_tokens).toBe(10);
    });

    test("formatStream converts unified chunks to Gemini SSE stream", async () => {
        const unifiedChunks = [
            { id: "1", model: "m1", delta: { content: "Hi" } },
            { id: "1", model: "m1", finish_reason: "stop" }
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

        expect(output).toContain('"parts":[{"text":"Hi"}]');
        expect(output).toContain('"finishReason":"STOP"');
    });
});