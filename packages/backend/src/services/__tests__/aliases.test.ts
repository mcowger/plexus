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
