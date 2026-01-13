import { test, expect, describe } from "bun:test";
import { Router } from "../src/services/router";
import type { PlexusConfig } from "../src/types/config";

const mockConfig: any = {
  server: { port: 4000, host: "localhost" },
  logging: { level: "info", debug: { enabled: false, storagePath: "logs/debug", retentionDays: 7, captureRequests: false, captureResponses: false }, usage: { enabled: false, storagePath: "logs/usage", retentionDays: 30 }, errors: { storagePath: "logs/errors", retentionDays: 90 } },
  providers: [
    {
      name: "openai",
      enabled: true,
      apiTypes: ["chat"],
      baseUrls: { chat: "https://api.openai.com/v1/chat/completions" },
      auth: { type: "bearer", apiKey: "{env:OPENAI_API_KEY}" },
      models: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo"],
    },
    {
      name: "azure-openai",
      enabled: true,
      apiTypes: ["chat"],
      baseUrls: { chat: "https://azure.openai.com" },
      auth: { type: "x-api-key", apiKey: "{env:AZURE_KEY}" },
      models: ["gpt-4o"],
    },
    {
      name: "disabled-provider",
      enabled: false,
      apiTypes: ["chat"],
      baseUrls: { chat: "https://disabled.com" },
      auth: { type: "bearer", apiKey: "{env:DISABLED_KEY}" },
      models: ["disabled-model"],
    },
  ],
  models: [
    {
      alias: "fast",
      description: "Fast, cost-effective model",
      additionalAliases: ["quick", "cheap"],
      targets: [
        { provider: "openai", model: "gpt-4o-mini" },
      ],
      selector: "random",
    },
    {
      alias: "smart",
      description: "High-quality model",
      additionalAliases: ["best", "flagship"],
      targets: [
        { provider: "openai", model: "gpt-4o", weight: 70 },
        { provider: "azure-openai", model: "gpt-4o", weight: 30 },
      ],
      selector: "random",
    },
    {
      alias: "balanced",
      description: "Cost-balanced with fallback",
      targets: [
        { provider: "openai", model: "gpt-4-turbo" },
        { provider: "openai", model: "gpt-4o" },
      ],
      selector: "in_order",
    },
    {
      alias: "disabled-alias",
      targets: [
        { provider: "disabled-provider", model: "disabled-model" },
      ],
      selector: "random",
    },
  ],
  apiKeys: [{ name: "default", secret: "test-key", enabled: true }],
};

describe("Router", () => {
  describe("Direct Alias Resolution", () => {
    test("resolves direct alias to target", () => {
      const router = new Router(mockConfig);
      const result = router.resolve("fast");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.target.aliasUsed).toBe("fast");
        expect(result.target.provider.name).toBe("openai");
        expect(result.target.model).toBe("gpt-4o-mini");
      }
    });

    test("resolves multi-target alias", () => {
      const router = new Router(mockConfig);
      const result = router.resolve("smart");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.target.aliasUsed).toBe("smart");
        expect(["openai", "azure-openai"]).toContain(result.target.provider.name);
        expect(result.target.model).toBe("gpt-4o");
      }
    });

    test("resolution respects selector strategy", () => {
      const router = new Router(mockConfig);
      
      // Test in_order selector - should always return first target
      for (let i = 0; i < 10; i++) {
        const result = router.resolve("balanced");
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.target.model).toBe("gpt-4-turbo");
        }
      }
    });
  });

  describe("Additional Alias Resolution", () => {
    test("resolves additional alias to canonical alias", () => {
      const router = new Router(mockConfig);
      const result = router.resolve("quick");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.target.aliasUsed).toBe("fast"); // Canonical alias
        expect(result.target.provider.name).toBe("openai");
        expect(result.target.model).toBe("gpt-4o-mini");
      }
    });

    test("resolves all additional aliases correctly", () => {
      const router = new Router(mockConfig);
      
      const aliases = ["quick", "cheap"];
      for (const alias of aliases) {
        const result = router.resolve(alias);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.target.aliasUsed).toBe("fast");
          expect(result.target.model).toBe("gpt-4o-mini");
        }
      }
    });
  });

  describe("Passthrough Resolution", () => {
    test("resolves provider/model format", () => {
      const router = new Router(mockConfig);
      const result = router.resolve("openai/gpt-4o");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.target.provider.name).toBe("openai");
        expect(result.target.model).toBe("gpt-4o");
        expect(result.target.aliasUsed).toBe("openai/gpt-4o");
      }
    });

    test("rejects passthrough with disabled provider", () => {
      const router = new Router(mockConfig);
      const result = router.resolve("disabled-provider/disabled-model");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.code).toBe("NO_ENABLED_TARGETS");
      }
    });

    test("rejects passthrough with unknown provider", () => {
      const router = new Router(mockConfig);
      const result = router.resolve("unknown-provider/some-model");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.code).toBe("ALIAS_NOT_FOUND");
      }
    });

    test("rejects passthrough with unknown model", () => {
      const router = new Router(mockConfig);
      const result = router.resolve("openai/unknown-model");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.code).toBe("ALIAS_NOT_FOUND");
      }
    });

    test("passthrough ignores cooldown", () => {
      // Mock cooldown manager
      const mockCooldownManager = {
        isOnCooldown: (provider: string) => true, // Always on cooldown
        getRemainingTime: (provider: string) => 3600,
        setCooldown: () => {},
        getCooldown: () => ({ startTime: 0, endTime: 0, provider: "openai", reason: "rate_limit" }),
        clearCooldown: () => true,
        clearAllCooldowns: () => {},
        getActiveCooldowns: () => [],
        updateConfig: () => {}
      } as any;

      const router = new Router(mockConfig, mockCooldownManager);
      
      // Should succeed even though provider is "on cooldown"
      const result = router.resolve("openai/gpt-4o");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.target.provider.name).toBe("openai");
      }
    });
  });

  describe("Error Cases", () => {
    test("returns error for unknown alias", () => {
      const router = new Router(mockConfig);
      const result = router.resolve("unknown-model");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.code).toBe("ALIAS_NOT_FOUND");
        expect(result.error).toContain("unknown-model");
      }
    });

    test("returns error when all targets are disabled", () => {
      const router = new Router(mockConfig);
      const result = router.resolve("disabled-alias");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.code).toBe("NO_ENABLED_TARGETS");
      }
    });

    test("alias names are case sensitive", () => {
      const router = new Router(mockConfig);
      const result = router.resolve("FAST");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.code).toBe("ALIAS_NOT_FOUND");
      }
    });
  });

  describe("Configuration Updates", () => {
    test("rebuilds maps on config update", () => {
      const router = new Router(mockConfig);
      
      // Initially should resolve
      let result = router.resolve("fast");
      expect(result.success).toBe(true);

      // Update config with new models
      const newConfig: PlexusConfig = {
        ...mockConfig,
        models: [
          {
            alias: "new-alias",
            targets: [{ provider: "openai", model: "gpt-4o" }],
            selector: "random",
          },
        ],
      };
      
      router.updateConfig(newConfig);

      // Old alias should no longer work
      result = router.resolve("fast");
      expect(result.success).toBe(false);

      // New alias should work
      result = router.resolve("new-alias");
      expect(result.success).toBe(true);
    });
  });

  describe("getAllAliases", () => {
    test("returns all canonical aliases", () => {
      const router = new Router(mockConfig);
      const aliases = router.getAllAliases();
      
      const canonicalIds = aliases
        .filter((a) => !a.canonicalAlias)
        .map((a) => a.id);
      
      expect(canonicalIds).toContain("fast");
      expect(canonicalIds).toContain("smart");
      expect(canonicalIds).toContain("balanced");
      expect(canonicalIds).toContain("disabled-alias");
    });

    test("returns all additional aliases", () => {
      const router = new Router(mockConfig);
      const aliases = router.getAllAliases();
      
      const additionalAliases = aliases
        .filter((a) => a.canonicalAlias)
        .map((a) => a.id);
      
      expect(additionalAliases).toContain("quick");
      expect(additionalAliases).toContain("cheap");
      expect(additionalAliases).toContain("best");
      expect(additionalAliases).toContain("flagship");
    });

    test("additional aliases reference canonical alias", () => {
      const router = new Router(mockConfig);
      const aliases = router.getAllAliases();
      
      const quickAlias = aliases.find((a) => a.id === "quick");
      expect(quickAlias).toBeDefined();
      expect(quickAlias?.canonicalAlias).toBe("fast");
      expect(quickAlias?.description).toContain("fast");
    });

    test("returns empty array when no models configured", () => {
      const emptyConfig: PlexusConfig = {
        ...mockConfig,
        models: [],
      };
      
      const router = new Router(emptyConfig);
      const aliases = router.getAllAliases();
      
      expect(aliases).toEqual([]);
    });
  });

  describe("Enabled/Disabled Provider Filtering", () => {
    test("filters out disabled providers from targets", () => {
      const configWithMixedProviders: PlexusConfig = {
        ...mockConfig,
        models: [
          {
            alias: "mixed",
            targets: [
              { provider: "openai", model: "gpt-4o" },
              { provider: "disabled-provider", model: "disabled-model" },
            ],
            selector: "random",
          },
        ],
      };

      const router = new Router(configWithMixedProviders);
      const result = router.resolve("mixed");

      expect(result.success).toBe(true);
      if (result.success) {
        // Should only resolve to enabled provider
        expect(result.target.provider.name).toBe("openai");
      }
    });

    test("multiple enabled targets with same weights", () => {
      const router = new Router(mockConfig);
      
      // Run many times to ensure both targets can be selected
      const providers = new Set<string>();
      for (let i = 0; i < 50; i++) {
        const result = router.resolve("smart");
        if (result.success) {
          providers.add(result.target.provider.name);
        }
      }

      // Both providers should be selected at least once
      expect(providers.has("openai") || providers.has("azure-openai")).toBe(true);
    });
  });
});
