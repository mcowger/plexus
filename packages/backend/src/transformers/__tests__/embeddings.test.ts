import { test, expect, describe } from "bun:test";
import { EmbeddingsTransformer } from "../embeddings";

describe("EmbeddingsTransformer", () => {
    const transformer = new EmbeddingsTransformer();

    describe("parseRequest", () => {
        test("should parse single text input", async () => {
            const input = {
                model: "text-embedding-3-small",
                input: "Hello world"
            };

            const result = await transformer.parseRequest(input);

            expect(result.model).toBe("text-embedding-3-small");
            expect(result.input).toBe("Hello world");
        });

        test("should parse array of texts", async () => {
            const input = {
                model: "text-embedding-3-small",
                input: ["Text 1", "Text 2", "Text 3"]
            };

            const result = await transformer.parseRequest(input);

            expect(result.model).toBe("text-embedding-3-small");
            expect(result.input).toEqual(["Text 1", "Text 2", "Text 3"]);
        });

        test("should parse optional parameters", async () => {
            const input = {
                model: "text-embedding-3-large",
                input: "Test",
                encoding_format: "float" as const,
                dimensions: 256,
                user: "user-123"
            };

            const result = await transformer.parseRequest(input);

            expect(result.encoding_format).toBe("float");
            expect(result.dimensions).toBe(256);
            expect(result.user).toBe("user-123");
        });
    });

    describe("transformRequest", () => {
        test("should pass through request unchanged", async () => {
            const request = {
                model: "text-embedding-3-small",
                input: "Test text",
                encoding_format: "float" as const,
                dimensions: 512
            };

            const result = await transformer.transformRequest(request);

            expect(result.model).toBe(request.model);
            expect(result.input).toBe(request.input);
            expect(result.encoding_format).toBe(request.encoding_format);
            expect(result.dimensions).toBe(request.dimensions);
        });

        test("should handle array input", async () => {
            const request = {
                model: "text-embedding-3-small",
                input: ["A", "B", "C"]
            };

            const result = await transformer.transformRequest(request);

            expect(result.input).toEqual(["A", "B", "C"]);
        });
    });

    describe("transformResponse", () => {
        test("should transform single embedding response", async () => {
            const response = {
                object: "list",
                data: [
                    {
                        object: "embedding",
                        embedding: [0.1, 0.2, 0.3],
                        index: 0
                    }
                ],
                model: "text-embedding-3-small",
                usage: {
                    prompt_tokens: 5,
                    total_tokens: 5
                }
            };

            const result = await transformer.transformResponse(response);

            expect(result.object).toBe("list");
            expect(result.data).toHaveLength(1);
            expect(result.data[0]!.embedding).toEqual([0.1, 0.2, 0.3]);
            expect(result.model).toBe("text-embedding-3-small");
            expect(result.usage.prompt_tokens).toBe(5);
        });

        test("should transform batch embedding response", async () => {
            const response = {
                object: "list",
                data: [
                    { object: "embedding", embedding: [0.1], index: 0 },
                    { object: "embedding", embedding: [0.2], index: 1 },
                    { object: "embedding", embedding: [0.3], index: 2 }
                ],
                model: "text-embedding-3-small",
                usage: {
                    prompt_tokens: 15,
                    total_tokens: 15
                }
            };

            const result = await transformer.transformResponse(response);

            expect(result.data).toHaveLength(3);
            expect(result.data[0]!.index).toBe(0);
            expect(result.data[1]!.index).toBe(1);
            expect(result.data[2]!.index).toBe(2);
        });
    });

    describe("formatResponse", () => {
        test("should format response for client", async () => {
            const response = {
                object: "list" as const,
                data: [
                    {
                        object: "embedding" as const,
                        embedding: [0.5, -0.3, 0.8],
                        index: 0
                    }
                ],
                model: "text-embedding-3-small",
                usage: {
                    prompt_tokens: 10,
                    total_tokens: 10
                }
            };

            const result = await transformer.formatResponse(response);

            expect(result.object).toBe("list");
            expect(result.data).toEqual(response.data);
            expect(result.model).toBe("text-embedding-3-small");
            expect(result.usage).toEqual(response.usage);
        });
    });

    describe("extractUsage", () => {
        test("should return undefined (embeddings don't stream)", () => {
            const result = transformer.extractUsage("any event data");
            expect(result).toBeUndefined();
        });
    });

    describe("properties", () => {
        test("should have correct name", () => {
            expect(transformer.name).toBe("embeddings");
        });

        test("should have correct endpoint", () => {
            expect(transformer.defaultEndpoint).toBe("/embeddings");
        });
    });
});
