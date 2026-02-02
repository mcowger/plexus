import { describe, it, expect } from "bun:test";
import { SpeechTransformer } from "../speech";

describe("SpeechTransformer", () => {
    const transformer = new SpeechTransformer();

    describe("parseRequest", () => {
        it("should parse basic request fields", async () => {
            const input = {
                model: "gpt-4o-mini-tts",
                input: "Hello, world!",
                voice: "alloy"
            };

            const result = await transformer.parseRequest(input);

            expect(result.model).toBe("gpt-4o-mini-tts");
            expect(result.input).toBe("Hello, world!");
            expect(result.voice).toBe("alloy");
        });

        it("should parse optional parameters", async () => {
            const input = {
                model: "tts-1",
                input: "Test text",
                voice: "echo",
                instructions: "Speak in a calm tone",
                response_format: "wav",
                speed: 1.5,
                stream_format: "sse"
            };

            const result = await transformer.parseRequest(input);

            expect(result.instructions).toBe("Speak in a calm tone");
            expect(result.response_format).toBe("wav");
            expect(result.speed).toBe(1.5);
            expect(result.stream_format).toBe("sse");
        });

        it("should handle missing optional parameters", async () => {
            const input = {
                model: "tts-1-hd",
                input: "Minimal request",
                voice: "nova"
            };

            const result = await transformer.parseRequest(input);

            expect(result.instructions).toBeUndefined();
            expect(result.response_format).toBeUndefined();
            expect(result.speed).toBeUndefined();
            expect(result.stream_format).toBeUndefined();
        });
    });

    describe("transformRequest", () => {
        it("should create provider payload with required fields", async () => {
            const request = {
                model: "gpt-4o-mini-tts",
                input: "Hello from Plexus TTS!",
                voice: "shimmer"
            };

            const result = await transformer.transformRequest(request);

            expect(result.model).toBe("gpt-4o-mini-tts");
            expect(result.input).toBe("Hello from Plexus TTS!");
            expect(result.voice).toBe("shimmer");
            expect(result.response_format).toBe("mp3");
            expect(result.speed).toBe(1.0);
        });

        it("should include all optional parameters when provided", async () => {
            const request = {
                model: "tts-1" as const,
                input: "Fullfeatured request" as const,
                voice: "sage" as const,
                instructions: "British accent" as const,
                response_format: "opus" as const,
                speed: 0.75,
                stream_format: "audio" as const
            };

            const result = await transformer.transformRequest(request);

            expect(result.model).toBe("tts-1");
            expect(result.input).toBe("Fullfeatured request");
            expect(result.voice).toBe("sage");
            expect(result.instructions).toBe("British accent");
            expect(result.response_format).toBe("opus");
            expect(result.speed).toBe(0.75);
        });

        it("should use default values when not provided", async () => {
            const request = {
                model: "tts-1-hd" as const,
                input: "Defaults test" as const,
                voice: "onyx" as const
            };

            const result = await transformer.transformRequest(request);

            expect(result.response_format).toBe("mp3");
            expect(result.speed).toBe(1.0);
        });
    });

    describe("transformResponse", () => {
        it("should handle non-streamed binary response", async () => {
            const audioBuffer = Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00]);
            const options = { response_format: "mp3" };

            const result = await transformer.transformResponse(audioBuffer, options);

            expect(result.audio).toBe(audioBuffer);
            expect(result.stream).toBeUndefined();
            expect(result.isStreamed).toBe(false);
        });

        it("should handle streamed SSE response", async () => {
            const streamData = Buffer.from("event: speech.audio.delta\ndata: {\"type\":\"audio\"}\n\n");
            const options = { stream_format: "sse" };

            const result = await transformer.transformResponse(streamData, options);

            expect(result.audio).toBeUndefined();
            expect(result.stream).toBeDefined();
            expect(result.isStreamed).toBe(true);
        });
    });

    describe("formatResponse", () => {
        it("should return binary audio for non-streamed response", async () => {
            const audioBuffer = Buffer.from([0x52, 0x49, 0x46, 0x46]);
            const response = { audio: audioBuffer };

            const result = await transformer.formatResponse(response);

            expect(result).toBe(audioBuffer);
        });

        it("should return stream for streamed response", async () => {
            const mockStream = new ReadableStream();
            const response = { stream: mockStream };

            const result = await transformer.formatResponse(response);

            expect(result).toBe(mockStream);
        });
    });

    describe("getMimeType", () => {
        it("should return correct MIME types for all supported formats", () => {
            expect(transformer.getMimeType("mp3")).toBe("audio/mpeg");
            expect(transformer.getMimeType("opus")).toBe("audio/opus");
            expect(transformer.getMimeType("aac")).toBe("audio/aac");
            expect(transformer.getMimeType("flac")).toBe("audio/flac");
            expect(transformer.getMimeType("wav")).toBe("audio/wav");
            expect(transformer.getMimeType("pcm")).toBe("audio/basic");
        });

        it("should default to audio/mpeg for unknown formats", () => {
            expect(transformer.getMimeType("unknown")).toBe("audio/mpeg");
            expect(transformer.getMimeType(undefined)).toBe("audio/mpeg");
        });
    });

    describe("extractUsage", () => {
        it("should extract usage from speech.audio.done event", () => {
            const eventData = JSON.stringify({
                type: "speech.audio.done",
                usage: {
                    input_tokens: 10,
                    output_tokens: 20,
                    total_tokens: 30
                }
            });

            const result = transformer.extractUsage(eventData);

            expect(result?.input_tokens).toBe(10);
            expect(result?.output_tokens).toBe(20);
            expect(result?.total_tokens).toBe(30);
        });

        it("should return undefined for non-usage events", () => {
            const deltaEvent = JSON.stringify({
                type: "speech.audio.delta",
                audio: "base64data"
            });

            const result = transformer.extractUsage(deltaEvent);

            expect(result).toBeUndefined();
        });

        it("should return undefined for invalid JSON", () => {
            const invalidData = "not valid json";

            const result = transformer.extractUsage(invalidData);

            expect(result).toBeUndefined();
        });
    });

    describe("properties", () => {
        it("should have correct name and default endpoint", () => {
            expect(transformer.name).toBe("speech");
            expect(transformer.defaultEndpoint).toBe("/audio/speech");
        });
    });
});