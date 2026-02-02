import { describe, it, expect, beforeEach } from "bun:test";
import { SpeechTransformer } from "../../../transformers/speech";

describe("Speech Route Handler", () => {
    describe("SpeechTransformer integration", () => {
        let transformer: SpeechTransformer;

        beforeEach(() => {
            transformer = new SpeechTransformer();
        });

        describe("parseRequest", () => {
            it("should parse valid OpenAI speech request", async () => {
                const request = {
                    model: "gpt-4o-mini-tts",
                    input: "Hello, this is a test.",
                    voice: "alloy"
                };

                const result = await transformer.parseRequest(request);

                expect(result.model).toBe("gpt-4o-mini-tts");
                expect(result.input).toBe("Hello, this is a test.");
                expect(result.voice).toBe("alloy");
            });

            it("should parse all optional parameters", async () => {
                const request = {
                    model: "tts-1",
                    input: "Full test",
                    voice: "echo",
                    instructions: "Softly spoken",
                    response_format: "wav",
                    speed: 0.8,
                    stream_format: "sse"
                };

                const result = await transformer.parseRequest(request);

                expect(result.instructions).toBe("Softly spoken");
                expect(result.response_format).toBe("wav");
                expect(result.speed).toBe(0.8);
                expect(result.stream_format).toBe("sse");
            });
        });

        describe("transformRequest", () => {
            it("should transform request for provider", async () => {
                const request = {
                    model: "gpt-4o-mini-tts",
                    input: "Text to convert",
                    voice: "onyx"
                };

                const result = await transformer.transformRequest(request);

                expect(result.model).toBe("gpt-4o-mini-tts");
                expect(result.input).toBe("Text to convert");
                expect(result.voice).toBe("onyx");
                expect(result.response_format).toBe("mp3");
                expect(result.speed).toBe(1.0);
            });
        });

        describe("transformResponse", () => {
            it("should handle binary audio response", async () => {
                const audioData = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x57, 0x41, 0x56, 0x45]);

                const result = await transformer.transformResponse(audioData, { response_format: "wav" });

                expect(result.audio).toBe(audioData);
                expect(result.isStreamed).toBe(false);
            });
        });

        describe("getMimeType", () => {
            it("should return correct MIME types", () => {
                expect(transformer.getMimeType("mp3")).toBe("audio/mpeg");
                expect(transformer.getMimeType("opus")).toBe("audio/opus");
                expect(transformer.getMimeType("aac")).toBe("audio/aac");
                expect(transformer.getMimeType("flac")).toBe("audio/flac");
                expect(transformer.getMimeType("wav")).toBe("audio/wav");
                expect(transformer.getMimeType("pcm")).toBe("audio/basic");
            });

            it("should default to audio/mpeg", () => {
                expect(transformer.getMimeType()).toBe("audio/mpeg");
                expect(transformer.getMimeType("invalid")).toBe("audio/mpeg");
            });
        });
    });

    describe("Request validation", () => {
        const transformer = new SpeechTransformer();

        it("should handle missing model field", async () => {
            const request = {
                input: "Test",
                voice: "alloy"
            };

            const result = await transformer.parseRequest(request);

            expect(result.model).toBeUndefined();
        });

        it("should handle missing voice field", async () => {
            const request = {
                model: "tts-1",
                input: "Test"
            };

            const result = await transformer.parseRequest(request);

            expect(result.voice).toBeUndefined();
        });

        it("should handle empty input", async () => {
            const request = {
                model: "tts-1",
                input: "",
                voice: "nova"
            };

            const result = await transformer.parseRequest(request);

            expect(result.input).toBe("");
        });

        it("should handle long input", async () => {
            const longInput = "A".repeat(4096);
            const request = {
                model: "tts-1-hd",
                input: longInput,
                voice: "sage"
            };

            const result = await transformer.parseRequest(request);

            expect(result.input.length).toBe(4096);
        });
    });

    describe("Response handling", () => {
        const transformer = new SpeechTransformer();

        it("should format binary response correctly", async () => {
            const audio = Buffer.from([0x01, 0x02, 0x03, 0x04]);
            const response = { audio };

            const result = await transformer.formatResponse(response);

            expect(result).toBe(audio);
        });

        it("should format stream response correctly", async () => {
            const stream = new ReadableStream();
            const response = { stream };

            const result = await transformer.formatResponse(response);

            expect(result).toBe(stream);
        });

        it("should extract usage from SSE events", () => {
            const usageEvent = JSON.stringify({
                type: "speech.audio.done",
                usage: {
                    input_tokens: 15,
                    output_tokens: 100,
                    total_tokens: 115
                }
            });

            const result = transformer.extractUsage(usageEvent);

            expect(result?.input_tokens).toBe(15);
            expect(result?.output_tokens).toBe(100);
            expect(result?.total_tokens).toBe(115);
        });

        it("should not extract usage from delta events", () => {
            const deltaEvent = JSON.stringify({
                type: "speech.audio.delta",
                audio: "base64encodeddata"
            });

            const result = transformer.extractUsage(deltaEvent);

            expect(result).toBeUndefined();
        });
    });
});