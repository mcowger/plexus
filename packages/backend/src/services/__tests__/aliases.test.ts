import { describe, expect, test, beforeEach } from "bun:test";
import { Router } from "../router";
import { setConfigForTesting } from "../../config";

describe("Router Aliases", () => {
    const mockConfig = {
        providers: {
            "test-provider": {
                type: "openai",
                api_base_url: "http://localhost",
                models: {
                    "target-model": { pricing: { source: "simple", input: 0, output: 0 } }
                }
            }
        },
        models: {
            "canonical-model": {
                targets: [
                    { provider: "test-provider", model: "target-model" }
                ],
                additional_aliases: ["alias-1", "alias-2"]
            }
        },
        keys: {},
        adminKey: "secret"
    };

    beforeEach(() => {
        setConfigForTesting(mockConfig as any);
    });

    test("resolves canonical alias", () => {
        const result = Router.resolve("canonical-model");
        expect(result.provider).toBe("test-provider");
        expect(result.model).toBe("target-model");
        expect(result.incomingModelAlias).toBe("canonical-model");
        expect(result.canonicalModel).toBe("canonical-model");
    });

    test("resolves additional alias 1", () => {
        const result = Router.resolve("alias-1");
        expect(result.provider).toBe("test-provider");
        expect(result.model).toBe("target-model");
        expect(result.incomingModelAlias).toBe("alias-1");
        expect(result.canonicalModel).toBe("canonical-model");
    });

    test("resolves additional alias 2", () => {
        const result = Router.resolve("alias-2");
        expect(result.provider).toBe("test-provider");
        expect(result.model).toBe("target-model");
        expect(result.incomingModelAlias).toBe("alias-2");
        expect(result.canonicalModel).toBe("canonical-model");
    });

    test("throws on unknown model", () => {
        expect(() => Router.resolve("unknown-model")).toThrow();
    });
});

describe("Router Direct Provider/Model Routing", () => {
    const mockConfig = {
        providers: {
            "stima": {
                type: "openai",
                api_base_url: "http://localhost:8080",
                models: {
                    "gemini-2.5-flash": {
                        pricing: { source: "simple", input: 0.5, output: 1.5 }
                    },
                    "claude-3-opus": {
                        pricing: { source: "simple", input: 15.0, output: 75.0 }
                    }
                }
            },
            "disabled-provider": {
                type: "openai",
                api_base_url: "http://localhost:9090",
                enabled: false,
                models: ["some-model"]
            }
        },
        models: {
            "smart-model": {
                targets: [
                    { provider: "stima", model: "claude-3-opus" }
                ]
            }
        },
        keys: {},
        adminKey: "secret"
    };

    beforeEach(() => {
        setConfigForTesting(mockConfig as any);
    });

    test("resolves direct provider/model syntax", () => {
        const result = Router.resolve("stima/gemini-2.5-flash");
        expect(result.provider).toBe("stima");
        expect(result.model).toBe("gemini-2.5-flash");
        expect(result.incomingModelAlias).toBe("stima/gemini-2.5-flash");
        expect(result.canonicalModel).toBe("stima/gemini-2.5-flash");
        expect(result.config).toBeDefined();
        expect(result.modelConfig).toBeDefined();
        expect(result.modelConfig.pricing.input).toBe(0.5);
    });

    test("resolves direct routing without model config", () => {
        const result = Router.resolve("stima/unlisted-model");
        expect(result.provider).toBe("stima");
        expect(result.model).toBe("unlisted-model");
        expect(result.modelConfig).toBeUndefined();
    });

    test("throws on direct routing with unknown provider", () => {
        expect(() => Router.resolve("unknown-provider/some-model")).toThrow(
            "Direct routing failed: Provider 'unknown-provider' not found in configuration"
        );
    });

    test("throws on direct routing with disabled provider", () => {
        expect(() => Router.resolve("disabled-provider/some-model")).toThrow(
            "Direct routing failed: Provider 'disabled-provider' is disabled"
        );
    });

    test("direct routing bypasses alias system", () => {
        // Even though "stima/claude-3-opus" matches a target in "smart-model" alias,
        // direct routing should bypass the alias system entirely
        const result = Router.resolve("stima/claude-3-opus");
        expect(result.provider).toBe("stima");
        expect(result.model).toBe("claude-3-opus");
        expect(result.incomingModelAlias).toBe("stima/claude-3-opus");
        expect(result.canonicalModel).toBe("stima/claude-3-opus");
    });

    test("handles model names with multiple slashes", () => {
        // Split on first slash only, rest goes to model name
        const result = Router.resolve("stima/namespace/model-name");
        expect(result.provider).toBe("stima");
        expect(result.model).toBe("namespace/model-name");
    });
});
