import { expect, test, describe, mock } from "bun:test";
import { Router } from "../router";

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
        }
    };

    // Override getConfig for this test suite
    // Note: In Bun, we can mock module exports if we import * as ...
    // But since Router imports { getConfig }, we might need to mock the module differently or rely on Router using the exported function.
    // Let's try mocking the function directly on the module object if it's writable, or using mock.module
    
    // Simpler approach for Bun: 
    // We can't easily mock ESM imports of other files without `mock.module` which mocks the whole file path.
    // Let's use `mock.module`
    
    mock.module("../../config", () => ({
        getConfig: () => mockConfig
    }));

    test("routes aliased model to correct provider and target model", () => {
        const route = Router.resolve("gpt-4");
        expect(route.provider).toBe("openai");
        expect(route.model).toBe("gpt-4-turbo");
        expect(route.config.type).toBe("chat");
    });

    test("routes another aliased model correctly", () => {
        const route = Router.resolve("claude-3");
        expect(route.provider).toBe("anthropic");
        expect(route.model).toBe("claude-3-opus-20240229");
    });

    test("load balances between multiple targets", () => {
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
        
        mock.module("../../config", () => ({
            getConfig: () => configWithDirectModel
        }));

        expect(() => Router.resolve("gpt-3.5-turbo-direct")).toThrow(/not found/);
    });
});
