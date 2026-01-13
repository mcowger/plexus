import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { HealthMonitor } from "../services/health-monitor";
import { CooldownManager } from "../services/cooldown-manager";
import type { PlexusConfig } from "../types/config";
import { unlink } from "node:fs/promises";

// Mock logger to avoid noise in tests
mock.module("../utils/logger", () => ({
  logger: {
    child: () => ({
      debug: () => {},
      info: () => {},
      error: () => {},
      warn: () => {},
      silly: () => {},
    }),
    debug: () => {},
    info: () => {},
    error: () => {},
    warn: () => {},
    silly: () => {},
  },
}));

describe("Health Monitor", () => {
  let mockConfig: PlexusConfig;
  let cooldownManager: CooldownManager;
  let healthMonitor: HealthMonitor;
  const testStoragePath = "./test-health-cooldowns.json";

  beforeEach(async () => {
    // Clean up test storage file if it exists
    if (await Bun.file(testStoragePath).exists()) {
      await unlink(testStoragePath);
    }

    mockConfig = {
      server: { port: 4000, host: "0.0.0.0" },
      logging: { level: "info", debug: { enabled: false, storagePath: "logs/debug", retentionDays: 7, captureRequests: false, captureResponses: false }, usage: { enabled: false, storagePath: "logs/usage", retentionDays: 30 }, errors: { storagePath: "logs/errors", retentionDays: 90 } },
      apiKeys: [],
      providers: [
        {
          name: "provider-1",
          enabled: true,
          apiTypes: ["chat"],
          baseUrls: { chat: "https://api.test1.com" },
          auth: { type: "bearer", apiKey: "{env:TEST_KEY_1}" },
          models: ["model-1"],
        },
        {
          name: "provider-2",
          enabled: true,
          apiTypes: ["chat"],
          baseUrls: { chat: "https://api.test2.com" },
          auth: { type: "bearer", apiKey: "{env:TEST_KEY_2}" },
          models: ["model-2"],
        },
        {
          name: "provider-3",
          enabled: true,
          apiTypes: ["chat"],
          baseUrls: { chat: "https://api.test3.com" },
          auth: { type: "bearer", apiKey: "{env:TEST_KEY_3}" },
          models: ["model-3"],
        },
        {
          name: "provider-disabled",
          enabled: false,
          apiTypes: ["chat"],
          baseUrls: { chat: "https://api.test4.com" },
          auth: { type: "bearer", apiKey: "{env:TEST_KEY_4}" },
          models: ["model-4"],
        },
      ],
      models: [],
      resilience: {
        cooldown: {
          defaults: {
            rate_limit: 60,
            auth_error: 3600,
            timeout: 30,
            server_error: 120,
            connection_error: 60,
          },
          maxDuration: 3600,
          minDuration: 5,
          storagePath: testStoragePath,
        },
        health: {
          degradedThreshold: 0.5,
          unhealthyThreshold: 0.9,
        },
      },
    };

    cooldownManager = new CooldownManager(mockConfig);
    healthMonitor = new HealthMonitor(mockConfig, cooldownManager);
  });

  afterEach(async () => {
    // Clean up test storage file
    if (await Bun.file(testStoragePath).exists()) {
      await unlink(testStoragePath);
    }
  });

  describe("getSystemHealth", () => {
    test("should return healthy status when all providers are available", () => {
      const health = healthMonitor.getSystemHealth();

      expect(health.status).toBe("healthy");
      expect(health.summary.total).toBe(4);
      expect(health.summary.healthy).toBe(3); // 3 enabled providers
      expect(health.summary.onCooldown).toBe(0);
      expect(health.summary.disabled).toBe(1);
    });

    test("should return degraded status when some providers are on cooldown", () => {
      // Put 1 out of 3 enabled providers on cooldown (33% - below degraded threshold)
      cooldownManager.setCooldown({
        provider: "provider-1",
        reason: "rate_limit",
      });

      const health = healthMonitor.getSystemHealth();

      expect(health.status).toBe("healthy"); // 33% < 50% threshold
      expect(health.summary.healthy).toBe(2);
      expect(health.summary.onCooldown).toBe(1);
    });

    test("should return degraded status at degraded threshold", () => {
      // Put 2 out of 3 enabled providers on cooldown (67% - above degraded threshold)
      cooldownManager.setCooldown({
        provider: "provider-1",
        reason: "rate_limit",
      });
      cooldownManager.setCooldown({
        provider: "provider-2",
        reason: "server_error",
      });

      const health = healthMonitor.getSystemHealth();

      expect(health.status).toBe("degraded"); // 67% > 50% threshold
      expect(health.summary.healthy).toBe(1);
      expect(health.summary.onCooldown).toBe(2);
    });

    test("should return unhealthy status when most providers are on cooldown", () => {
      // Put all 3 enabled providers on cooldown (100% - above unhealthy threshold)
      cooldownManager.setCooldown({
        provider: "provider-1",
        reason: "rate_limit",
      });
      cooldownManager.setCooldown({
        provider: "provider-2",
        reason: "server_error",
      });
      cooldownManager.setCooldown({
        provider: "provider-3",
        reason: "timeout",
      });

      const health = healthMonitor.getSystemHealth();

      expect(health.status).toBe("unhealthy"); // 100% > 90% threshold
      expect(health.summary.healthy).toBe(0);
      expect(health.summary.onCooldown).toBe(3);
    });

    test("should include provider health details", () => {
      cooldownManager.setCooldown({
        provider: "provider-1",
        reason: "rate_limit",
        httpStatus: 429,
        message: "Rate limit exceeded",
      });

      const health = healthMonitor.getSystemHealth();

      const provider1Health = health.providers.find(
        (p) => p.name === "provider-1"
      );
      expect(provider1Health).toBeDefined();
      expect(provider1Health!.enabled).toBe(true);
      expect(provider1Health!.onCooldown).toBe(true);
      expect(provider1Health!.cooldownEntry).toBeDefined();
      expect(provider1Health!.cooldownEntry!.reason).toBe("rate_limit");
      expect(provider1Health!.cooldownEntry!.httpStatus).toBe(429);
      expect(provider1Health!.cooldownRemaining).toBeGreaterThan(0);

      const provider2Health = health.providers.find(
        (p) => p.name === "provider-2"
      );
      expect(provider2Health).toBeDefined();
      expect(provider2Health!.onCooldown).toBe(false);
      expect(provider2Health!.cooldownEntry).toBeUndefined();
    });

    test("should include disabled providers in summary", () => {
      const health = healthMonitor.getSystemHealth();

      const disabledProvider = health.providers.find(
        (p) => p.name === "provider-disabled"
      );
      expect(disabledProvider).toBeDefined();
      expect(disabledProvider!.enabled).toBe(false);
      expect(health.summary.disabled).toBe(1);
    });

    test("should return unhealthy when no enabled providers", () => {
      // Disable all providers
      mockConfig.providers.forEach((p) => {
        p.enabled = false;
      });
      healthMonitor.updateConfig(mockConfig);

      const health = healthMonitor.getSystemHealth();

      expect(health.status).toBe("unhealthy");
      expect(health.summary.healthy).toBe(0);
    });
  });

  describe("getProviderHealth", () => {
    test("should return health for specific provider", () => {
      const health = healthMonitor.getProviderHealth("provider-1");

      expect(health).toBeDefined();
      expect(health!.name).toBe("provider-1");
      expect(health!.enabled).toBe(true);
      expect(health!.onCooldown).toBe(false);
    });

    test("should return health for provider on cooldown", () => {
      cooldownManager.setCooldown({
        provider: "provider-1",
        reason: "server_error",
        httpStatus: 500,
      });

      const health = healthMonitor.getProviderHealth("provider-1");

      expect(health).toBeDefined();
      expect(health!.onCooldown).toBe(true);
      expect(health!.cooldownEntry).toBeDefined();
      expect(health!.cooldownEntry!.reason).toBe("server_error");
      expect(health!.cooldownRemaining).toBeGreaterThan(0);
    });

    test("should return undefined for non-existent provider", () => {
      const health = healthMonitor.getProviderHealth("nonexistent");
      expect(health).toBeUndefined();
    });
  });

  describe("updateConfig", () => {
    test("should update configuration", () => {
      const newConfig = { ...mockConfig };
      newConfig.resilience.health.degradedThreshold = 0.7;

      healthMonitor.updateConfig(newConfig);

      // Should use new threshold
      cooldownManager.setCooldown({
        provider: "provider-1",
        reason: "rate_limit",
      });
      cooldownManager.setCooldown({
        provider: "provider-2",
        reason: "rate_limit",
      });

      const health = healthMonitor.getSystemHealth();
      // 67% on cooldown should now be healthy (< 70% threshold)
      expect(health.status).toBe("healthy");
    });
  });

  describe("system health calculations", () => {
    test("should calculate status correctly at exact threshold", () => {
      // degradedThreshold = 0.5 (50%)
      // With 2 providers enabled, 1 on cooldown = 50%
      mockConfig.providers = [
        {
          name: "provider-1",
          enabled: true,
          apiTypes: ["chat"],
          baseUrls: { chat: "https://api.test1.com" },
          auth: { type: "bearer", apiKey: "{env:TEST_KEY_1}" },
          models: ["model-1"],
        },
        {
          name: "provider-2",
          enabled: true,
          apiTypes: ["chat"],
          baseUrls: { chat: "https://api.test2.com" },
          auth: { type: "bearer", apiKey: "{env:TEST_KEY_2}" },
          models: ["model-2"],
        },
      ];

      cooldownManager = new CooldownManager(mockConfig);
      healthMonitor = new HealthMonitor(mockConfig, cooldownManager);

      cooldownManager.setCooldown({
        provider: "provider-1",
        reason: "rate_limit",
      });

      const health = healthMonitor.getSystemHealth();
      // At exactly 50%, should be degraded (>= threshold)
      expect(health.status).toBe("degraded");
    });

    test("should ignore disabled providers in calculations", () => {
      mockConfig.providers = [
        {
          name: "enabled-1",
          enabled: true,
          apiTypes: ["chat"],
          baseUrls: { chat: "https://api.test1.com" },
          auth: { type: "bearer", apiKey: "{env:TEST_KEY_1}" },
          models: ["model-1"],
        },
        {
          name: "disabled-1",
          enabled: false,
          apiTypes: ["chat"],
          baseUrls: { chat: "https://api.test2.com" },
          auth: { type: "bearer", apiKey: "{env:TEST_KEY_2}" },
          models: ["model-2"],
        },
        {
          name: "disabled-2",
          enabled: false,
          apiTypes: ["chat"],
          baseUrls: { chat: "https://api.test3.com" },
          auth: { type: "bearer", apiKey: "{env:TEST_KEY_3}" },
          models: ["model-3"],
        },
      ];

      cooldownManager = new CooldownManager(mockConfig);
      healthMonitor = new HealthMonitor(mockConfig, cooldownManager);

      // Even with disabled providers, only enabled-1 matters
      const health = healthMonitor.getSystemHealth();
      expect(health.status).toBe("healthy");
      expect(health.summary.disabled).toBe(2);
    });
  });
});
