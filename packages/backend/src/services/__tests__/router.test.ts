import { expect, test, describe } from "bun:test";
import { Router } from "../router";
import { setConfigForTesting } from "../../config";

describe("Router", () => {
    
    const mockConfig = {
        providers: {
            "openai": { type: "chat", api_base_url: "https://api.openai.com/v1" },
            "anthropic": { type: "messages", api_base_url: "https://api.anthropic.com/v1" },
            "kilo": { type: "openrouter", api_base_url: "https://api.kilocode.ai/api/openrouter" }
        },
        models: {
            "gpt-4": { 
                targets: [{ provider: "openai", model: "gpt-4-turbo" }]
            },
            "claude-3": {
                targets: [{ provider: "anthropic", model: "claude-3-opus-20240229" }]
            },
            "balanced-model": {
                targets: [
                    { provider: "openai", model: "gpt-4-balanced" },
                    { provider: "anthropic", model: "claude-3-balanced" }
                ]
            }
        },
        keys: {},
        adminKey: "secret"
    };

    test("routes aliased model to correct provider and target model", () => {
        setConfigForTesting(mockConfig as any);
        const route = Router.resolve("gpt-4");
        expect(route.provider).toBe("openai");
        expect(route.model).toBe("gpt-4-turbo");
        expect(route.config.type).toBe("chat");
    });

    test("routes another aliased model correctly", () => {
        setConfigForTesting(mockConfig as any);
        const route = Router.resolve("claude-3");
        expect(route.provider).toBe("anthropic");
        expect(route.model).toBe("claude-3-opus-20240229");
    });

    test("load balances between multiple targets", () => {
        setConfigForTesting(mockConfig as any);
        // This is probabilistic, so we run it multiple times to ensure we see both at least once?
        // Or mock Math.random.
        const originalRandom = Math.random;
        
        // Force 0 (first item)
        Math.random = () => 0;
        const route1 = Router.resolve("balanced-model");
        expect(route1.provider).toBe("openai");

        // Force 0.9 (second item)
        Math.random = () => 0.9;
        const route2 = Router.resolve("balanced-model");
        expect(route2.provider).toBe("anthropic");

        Math.random = originalRandom;
    });

    test("throws error for unknown model", () => {
        setConfigForTesting(mockConfig as any);
        expect(() => Router.resolve("unknown-model")).toThrow(/not found/);
    });

    test("throws error if model exists in provider but not as alias", () => {
        // We need to add a model to a provider in the mock config that isn't in 'models' alias list
        const configWithDirectModel = {
            ...mockConfig,
            providers: {
                ...mockConfig.providers,
                "openai": { 
                    ...mockConfig.providers.openai,
                    models: ["gpt-3.5-turbo-direct"]
                }
            }
        };
        
        setConfigForTesting(configWithDirectModel as any);

        expect(() => Router.resolve("gpt-3.5-turbo-direct")).toThrow(/not found/);
    });

    test("cost selector prefers provider with no pricing (treated as $0)", () => {
        const costSelectorConfig = {
            providers: {
                "expensive": { 
                    type: "chat", 
                    api_base_url: "https://api.expensive.com/v1",
                    models: {
                        "expensive-model": {
                            pricing: {
                                source: "simple",
                                input: 10.0,
                                output: 20.0
                            }
                        }
                    }
                },
                "free": { 
                    type: "chat", 
                    api_base_url: "https://api.free.com/v1",
                    models: ["free-model"]  // No pricing configured
                }
            },
            models: {
                "select-by-cost": {
                    selector: "cost",
                    targets: [
                        { provider: "expensive", model: "expensive-model" },
                        { provider: "free", model: "free-model" }
                    ]
                }
            },
            keys: {},
            adminKey: "secret"
        };
        
        setConfigForTesting(costSelectorConfig as any);

        const route = Router.resolve("select-by-cost");
        expect(route.provider).toBe("free");
        expect(route.model).toBe("free-model");
    });
});