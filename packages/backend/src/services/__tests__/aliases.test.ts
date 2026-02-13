import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test";
import { Router } from "../router";
import { setConfigForTesting } from "../../config";
import { CooldownManager } from "../cooldown-manager";

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

    test("resolves canonical alias", async () => {
        const result = await Router.resolve("canonical-model");
        expect(result.provider).toBe("test-provider");
        expect(result.model).toBe("target-model");
        expect(result.incomingModelAlias).toBe("canonical-model");
        expect(result.canonicalModel).toBe("canonical-model");
    });

    test("resolves additional alias 1", async () => {
        const result = await Router.resolve("alias-1");
        expect(result.provider).toBe("test-provider");
        expect(result.model).toBe("target-model");
        expect(result.incomingModelAlias).toBe("alias-1");
        expect(result.canonicalModel).toBe("canonical-model");
    });

    test("resolves additional alias 2", async () => {
        const result = await Router.resolve("alias-2");
        expect(result.provider).toBe("test-provider");
        expect(result.model).toBe("target-model");
        expect(result.incomingModelAlias).toBe("alias-2");
        expect(result.canonicalModel).toBe("canonical-model");
    });

    test("throws on unknown model", async () => {
        await expect(Router.resolve("unknown-model")).rejects.toThrow();
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

    test("resolves direct provider/model syntax", async () => {
        const result = await Router.resolve("direct/stima/gemini-2.5-flash");
        expect(result.provider).toBe("stima");
        expect(result.model).toBe("gemini-2.5-flash");
        expect(result.incomingModelAlias).toBe("direct/stima/gemini-2.5-flash");
        expect(result.canonicalModel).toBe("direct/stima/gemini-2.5-flash");
        expect(result.config).toBeDefined();
        expect(result.modelConfig).toBeDefined();
        expect(result.modelConfig.pricing.input).toBe(0.5);
    });

    test("resolves direct routing without model config", async () => {
        const result = await Router.resolve("direct/stima/unlisted-model");
        expect(result.provider).toBe("stima");
        expect(result.model).toBe("unlisted-model");
        expect(result.modelConfig).toBeUndefined();
    });

    test("throws on direct routing with unknown provider", async () => {
      await expect(Router.resolve("direct/unknown-provider/some-model")).rejects.toThrow(
            "Direct routing failed: Provider 'unknown-provider' not found in configuration"
        );
    });

    test("throws on direct routing with disabled provider", async () => {
        await expect(Router.resolve("direct/disabled-provider/some-model")).rejects.toThrow(
        "Direct routing failed: Provider 'disabled-provider' is disabled"
        );
    });

    test("throws on direct routing with invalid format (missing model)", async () => {
        await expect(Router.resolve("direct/stima")).rejects.toThrow(
            "Direct routing failed: Invalid format 'direct/stima'. Expected 'direct/provider/model'"
        );
    });

    test("direct routing bypasses alias system", async () => {
        // Even though "stima/claude-3-opus" matches a target in "smart-model" alias,
        // direct routing should bypass the alias system entirely
        const result = await Router.resolve("direct/stima/claude-3-opus");
        expect(result.provider).toBe("stima");
        expect(result.model).toBe("claude-3-opus");
        expect(result.incomingModelAlias).toBe("direct/stima/claude-3-opus");
        expect(result.canonicalModel).toBe("direct/stima/claude-3-opus");
    });

    test("handles model names with multiple slashes", async () => {
        // Split on first slash after "direct/" prefix, rest goes to model name
        const result = await Router.resolve("direct/stima/namespace/model-name");
        expect(result.provider).toBe("stima");
        expect(result.model).toBe("namespace/model-name");
    });

    test("model names with slashes are NOT treated as direct routing", async () => {
        // Model names containing "/" should NOT trigger direct routing without "direct/" prefix
        // This ensures models like "meta-llama/Llama-3-70b" work correctly through aliases
        await expect(Router.resolve("stima/gemini-2.5-flash")).rejects.toThrow(
            "Model 'stima/gemini-2.5-flash' not found in configuration"
        );
    });
});

describe("Router.resolveCandidates", () => {
    const cooldownManager = CooldownManager.getInstance();

    afterEach(() => {
        spyOn(cooldownManager, 'filterHealthyTargets').mockRestore();
    });

    test("returns empty array when model alias does not exist", async () => {
        setConfigForTesting({
            providers: {
                "p1": {
                    type: "openai",
                    api_base_url: "https://api.openai.com/v1",
                    models: { "m1": {} }
                }
            },
            models: {},
            keys: {},
            adminKey: "secret"
        } as any);

        const result = await Router.resolveCandidates("unknown-model");
        expect(result).toEqual([]);
    });

    test("returns empty array when alias has no targets", async () => {
        setConfigForTesting({
            providers: {
                "p1": {
                    type: "openai",
                    api_base_url: "https://api.openai.com/v1",
                    models: { "m1": {} }
                }
            },
            models: {
                "empty-model": {
                    targets: []
                }
            },
            keys: {},
            adminKey: "secret"
        } as any);

        const result = await Router.resolveCandidates("empty-model");
        expect(result).toEqual([]);
    });

    test("returns empty array when all targets are disabled", async () => {
        setConfigForTesting({
            providers: {
                "p1": {
                    type: "openai",
                    api_base_url: "https://api.openai.com/v1",
                    enabled: true,
                    models: { "m1": {} }
                },
                "p2": {
                    type: "openai",
                    api_base_url: "https://api.openai.com/v1",
                    enabled: false,
                    models: { "m2": {} }
                }
            },
            models: {
                "disabled-model": {
                    targets: [
                        { provider: "p1", model: "m1", enabled: false },
                        { provider: "p2", model: "m2" }
                    ]
                }
            },
            keys: {},
            adminKey: "secret"
        } as any);

        const result = await Router.resolveCandidates("disabled-model");
        expect(result).toEqual([]);
    });

    test("returns empty array when all targets are on cooldown", async () => {
        setConfigForTesting({
            providers: {
                "p1": {
                    type: "openai",
                    api_base_url: "https://api.openai.com/v1",
                    models: { "m1": {} }
                },
                "p2": {
                    type: "openai",
                    api_base_url: "https://api.openai.com/v1",
                    models: { "m2": {} }
                }
            },
            models: {
                "cooldown-model": {
                    selector: "in_order",
                    targets: [
                        { provider: "p1", model: "m1" },
                        { provider: "p2", model: "m2" }
                    ]
                }
            },
            keys: {},
            adminKey: "secret"
        } as any);

        spyOn(cooldownManager, 'filterHealthyTargets').mockResolvedValue([]);

        const result = await Router.resolveCandidates("cooldown-model");
        expect(result).toEqual([]);
    });

    test("returns only healthy enabled candidates in selector order with alias metadata", async () => {
        setConfigForTesting({
            providers: {
                "p1": {
                    type: "openai",
                    api_base_url: "https://api.openai.com/v1",
                    enabled: true,
                    models: { "m1": { pricing: { source: "simple", input: 1, output: 1 } } }
                },
                "p2": {
                    type: "openai",
                    api_base_url: "https://api.openai.com/v1",
                    enabled: true,
                    models: { "m2": { pricing: { source: "simple", input: 2, output: 2 } } }
                },
                "p3": {
                    type: "openai",
                    api_base_url: "https://api.openai.com/v1",
                    enabled: true,
                    models: { "m3": { pricing: { source: "simple", input: 3, output: 3 } } }
                }
            },
            models: {
                "canonical-candidates": {
                    selector: "in_order",
                    targets: [
                        { provider: "p1", model: "m1" },
                        { provider: "p2", model: "m2", enabled: false },
                        { provider: "p3", model: "m3" }
                    ],
                    additional_aliases: ["candidates-alias"]
                }
            },
            keys: {},
            adminKey: "secret"
        } as any);

        // Simulate p1 being unhealthy after disabled filtering
        spyOn(cooldownManager, 'filterHealthyTargets').mockResolvedValue([
            { provider: 'p3', model: 'm3' }
        ] as any);

        const result = await Router.resolveCandidates("candidates-alias");

        expect(result).toHaveLength(1);
        expect(result[0]?.provider).toBe("p3");
        expect(result[0]?.model).toBe("m3");
        expect(result[0]?.incomingModelAlias).toBe("candidates-alias");
        expect(result[0]?.canonicalModel).toBe("canonical-candidates");
        expect(result[0]?.modelConfig).toBeDefined();
    });
});
