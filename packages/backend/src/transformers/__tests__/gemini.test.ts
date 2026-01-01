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

    test("parseRequest handles snake_case tools and tool_config", async () => {
        const input = {
            "contents": [
                {
                    "role": "user",
                    "parts": [
                        { "text": "What is the weather like in London?" }
                    ]
                }
            ],
            "tools": [
                {
                    "function_declarations": [
                        {
                            "name": "get_weather",
                            "description": "Get the current weather",
                            "parameters": {
                                "type": "OBJECT",
                                "properties": {
                                    "location": { "type": "STRING" }
                                },
                                "required": ["location"]
                            }
                        }
                    ]
                }
            ],
            "tool_config": {
                "function_calling_config": {
                    "mode": "AUTO"
                }
            }
        };

        const result = await transformer.parseRequest(input);
        expect(result.tools).toHaveLength(1);
        expect(result.tools![0].function.name).toBe("get_weather");
        expect(result.tool_choice).toBe("auto");

        // Verify it also transforms back correctly
        const transformed = await transformer.transformRequest(result);
        expect(transformed.tools).toHaveLength(1);
        // @ts-ignore
        expect(transformed.tools[0].functionDeclarations).toBeDefined();
        expect(transformed.toolConfig.functionCallingConfig.mode).toBe("AUTO");
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
                input_tokens: 10,
                output_tokens: 10,
                total_tokens: 20,
                reasoning_tokens: 0,
                cached_tokens: 0,
                cache_creation_tokens: 0,
                prompt_tokens: 10,
                completion_tokens: 10,
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

    test("transformResponse extracts detailed usage from Gemini response", async () => {
        const geminiResponse = {
            candidates: [{
                content: { parts: [{ text: "Response" }] }
            }],
            usageMetadata: {
                promptTokenCount: 104,
                candidatesTokenCount: 25,
                totalTokenCount: 439,
                promptTokensDetails: [
                    { modality: "TEXT", tokenCount: 104 },
                    { modality: "IMAGE", tokenCount: 10 }
                ],
                thoughtsTokenCount: 310
            }
        };

        const result = await transformer.transformResponse(geminiResponse);
        expect(result.usage?.input_tokens).toBe(104);
        expect(result.usage?.reasoning_tokens).toBe(310);
    });

    test("formatResponse includes detailed usage in Gemini format", async () => {
        const unified: UnifiedChatResponse = {
            id: "unified-123",
            model: "gemini-pro",
            content: "Response",
            usage: {
                input_tokens: 104,
                output_tokens: 25,
                total_tokens: 439,
                reasoning_tokens: 310,
                cached_tokens: 0,
                cache_creation_tokens: 0
            }
        };

        const result = await transformer.formatResponse(unified);
        expect(result.usageMetadata.promptTokenCount).toBe(104);
        expect(result.usageMetadata.thoughtsTokenCount).toBe(310);
    });

    test("parseRequest and transformRequest preserve response format and thinking config", async () => {
        const input = {
            model: "gemini-2.0-flash-thinking",
            contents: [{ role: "user", parts: [{ text: "Think about JSON" }] }],
            generationConfig: {
                responseMimeType: "application/json",
                responseJsonSchema: { type: "OBJECT", properties: { result: { type: "STRING" } } },
                thinkingConfig: {
                    includeThoughts: true,
                    thinkingBudget: 1024
                },
                maxOutputTokens: 2048,
                temperature: 0.5
            }
        };

        const unified = await transformer.parseRequest(input);
        
        expect(unified.response_format?.type).toBe("json_schema");
        expect(unified.response_format?.json_schema).toEqual(input.generationConfig.responseJsonSchema);
        expect(unified.reasoning?.enabled).toBe(true);
        expect(unified.reasoning?.max_tokens).toBe(1024);

        const transformed = await transformer.transformRequest(unified);

        expect(transformed.generationConfig!.responseMimeType).toBe("application/json");
        expect(transformed.generationConfig!.responseJsonSchema).toEqual(input.generationConfig.responseJsonSchema);
        expect(transformed.generationConfig!.thinkingConfig!.includeThoughts).toBe(true);
        expect(transformed.generationConfig!.thinkingConfig!.thinkingBudget).toBe(1024);
        expect(transformed.generationConfig!.maxOutputTokens).toBe(2048);
    });

    test("parseRequest and transformRequest preserve thought parts (thinking content)", async () => {
        const input = {
            model: "gemini-2.0-flash-thinking",
            contents: [
                { 
                    role: "model", 
                    parts: [
                        { text: "I should check the weather.", thought: true },
                        { functionCall: { name: "get_weather", args: { location: "London" } } }
                    ] 
                }
            ]
        };

        const unified = await transformer.parseRequest(input);
        
        expect(unified.messages).toHaveLength(1);
        expect(unified.messages[0].role).toBe("assistant");
        expect(unified.messages[0].thinking?.content).toBe("I should check the weather.");
        expect(unified.messages[0].tool_calls).toHaveLength(1);
        expect(unified.messages[0].tool_calls![0].function.name).toBe("get_weather");

        const transformed = await transformer.transformRequest(unified);
        
        expect(transformed.contents).toHaveLength(1);
        expect(transformed.contents[0].role).toBe("model");
        expect(transformed.contents[0].parts).toHaveLength(2);
        // @ts-ignore
        expect(transformed.contents[0].parts[0].thought).toBe(true);
        expect(transformed.contents[0].parts[0].text).toBe("I should check the weather.");
        expect(transformed.contents[0].parts[1].functionCall).toBeDefined();
    });

    test("transformResponse and formatResponse preserve thought signature", async () => {
        const geminiResponse = {
            candidates: [{
                content: {
                    parts: [
                        { text: "Thinking...", thought: true, thoughtSignature: "sig-123" },
                        { text: "Answer" }
                    ]
                }
            }]
        };

        const unified = await transformer.transformResponse(geminiResponse);
        expect(unified.thinking?.content).toBe("Thinking...");
        expect(unified.thinking?.signature).toBe("sig-123");
        expect(unified.content).toBe("Answer");

        const formatted = await transformer.formatResponse(unified);
        // @ts-ignore
        expect(formatted.candidates[0].content.parts[0].thought).toBe(true);
        // @ts-ignore
        expect(formatted.candidates[0].content.parts[0].thoughtSignature).toBe("sig-123");
    });

    test("transformRequest attaches thought signature to parts", async () => {
        const unified: UnifiedChatRequest = {
            model: "gemini-2.0-flash-thinking",
            messages: [{
                role: "assistant",
                content: "Result",
                thinking: {
                    content: "Thought",
                    signature: "sig-abc"
                }
            }]
        };

        const result = await transformer.transformRequest(unified);
        // @ts-ignore
        expect(result.contents[0].parts[1].text).toBe("Result");
        // @ts-ignore
        expect(result.contents[0].parts[1].thoughtSignature).toBe("sig-abc");
    });
});