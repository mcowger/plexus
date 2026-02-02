import { describe, it, expect } from "bun:test";
import { TranscriptionsTransformer } from "../transcriptions";

describe("TranscriptionsTransformer", () => {
    const transformer = new TranscriptionsTransformer();

    describe("parseRequest", () => {
        it("should parse basic request fields", async () => {
            const file = Buffer.from("test audio data");
            const fields = {
                model: "whisper-1",
                response_format: "json"
            };

            const result = await transformer.parseRequest(file, "test.mp3", "audio/mpeg", fields);

            expect(result.file).toBe(file);
            expect(result.filename).toBe("test.mp3");
            expect(result.mimeType).toBe("audio/mpeg");
            expect(result.model).toBe("whisper-1");
            expect(result.response_format).toBe("json");
        });

        it("should parse optional parameters", async () => {
            const file = Buffer.from("test audio data");
            const fields = {
                model: "gpt-4o-transcribe",
                language: "en",
                prompt: "Test prompt",
                temperature: "0.5",
                response_format: "text"
            };

            const result = await transformer.parseRequest(file, "test.wav", "audio/wav", fields);

            expect(result.language).toBe("en");
            expect(result.prompt).toBe("Test prompt");
            expect(result.temperature).toBe(0.5);
            expect(result.response_format).toBe("text");
        });

        it("should handle missing optional parameters", async () => {
            const file = Buffer.from("test audio data");
            const fields = {
                model: "whisper-1"
            };

            const result = await transformer.parseRequest(file, "test.mp3", "audio/mpeg", fields);

            expect(result.language).toBeUndefined();
            expect(result.prompt).toBeUndefined();
            expect(result.temperature).toBeUndefined();
            // response_format defaults to undefined if not specified
        });
    });

    describe("transformRequest", () => {
        it("should create FormData with file and required fields", async () => {
            const request = {
                file: Buffer.from("test audio"),
                filename: "test.mp3",
                mimeType: "audio/mpeg",
                model: "whisper-1",
                response_format: "json" as const
            };

            const formData = await transformer.transformRequest(request);

            expect(formData).toBeInstanceOf(FormData);
            // FormData doesn't expose getAll easily in Bun, so we verify it's created
            expect(formData.has('file')).toBe(true);
            expect(formData.has('model')).toBe(true);
        });

        it("should include optional parameters when provided", async () => {
            const request = {
                file: Buffer.from("test audio"),
                filename: "test.mp3",
                mimeType: "audio/mpeg",
                model: "whisper-1",
                language: "en",
                prompt: "Test prompt",
                temperature: 0.5,
                response_format: "json" as const
            };

            const formData = await transformer.transformRequest(request);

            expect(formData.has('language')).toBe(true);
            expect(formData.has('prompt')).toBe(true);
            expect(formData.has('temperature')).toBe(true);
            expect(formData.has('response_format')).toBe(true);
        });
    });

    describe("transformResponse", () => {
        it("should transform JSON response", async () => {
            const providerResponse = {
                text: "This is the transcription",
                usage: {
                    input_tokens: 100,
                    output_tokens: 20,
                    total_tokens: 120
                }
            };

            const result = await transformer.transformResponse(providerResponse, "json");

            expect(result.text).toBe("This is the transcription");
            expect(result.usage).toEqual({
                input_tokens: 100,
                output_tokens: 20,
                total_tokens: 120
            });
        });

        it("should transform text response", async () => {
            const providerResponse = "This is the transcription";

            const result = await transformer.transformResponse(providerResponse, "text");

            expect(result.text).toBe("This is the transcription");
            expect(result.usage).toBeUndefined();
        });

        it("should handle missing usage in JSON response", async () => {
            const providerResponse = {
                text: "This is the transcription"
            };

            const result = await transformer.transformResponse(providerResponse, "json");

            expect(result.text).toBe("This is the transcription");
            expect(result.usage).toBeUndefined();
        });

        it("should extract text from object in text mode", async () => {
            const providerResponse = {
                text: "This is the transcription"
            };

            const result = await transformer.transformResponse(providerResponse, "text");

            expect(result.text).toBe("This is the transcription");
        });
    });

    describe("formatResponse", () => {
        it("should format JSON response with usage", async () => {
            const unifiedResponse = {
                text: "This is the transcription",
                usage: {
                    input_tokens: 100,
                    output_tokens: 20,
                    total_tokens: 120
                }
            };

            const result = await transformer.formatResponse(unifiedResponse, "json");

            expect(result.text).toBe("This is the transcription");
            expect(result.usage).toEqual(unifiedResponse.usage);
        });

        it("should format JSON response without usage", async () => {
            const unifiedResponse = {
                text: "This is the transcription"
            };

            const result = await transformer.formatResponse(unifiedResponse, "json");

            expect(result.text).toBe("This is the transcription");
            expect(result.usage).toBeUndefined();
        });

        it("should return plain text for text format", async () => {
            const unifiedResponse = {
                text: "This is the transcription",
                usage: {
                    input_tokens: 100,
                    output_tokens: 20,
                    total_tokens: 120
                }
            };

            const result = await transformer.formatResponse(unifiedResponse, "text");

            expect(result).toBe("This is the transcription");
            expect(typeof result).toBe("string");
        });
    });

    describe("extractUsage", () => {
        it("should return undefined for transcriptions (no streaming in v1)", () => {
            const result = transformer.extractUsage("any event data");
            expect(result).toBeUndefined();
        });
    });

    describe("metadata", () => {
        it("should have correct name and endpoint", () => {
            expect(transformer.name).toBe("transcriptions");
            expect(transformer.defaultEndpoint).toBe("/audio/transcriptions");
        });
    });
});
