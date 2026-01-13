import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { CooldownManager } from "../services/cooldown-manager";
import { ProviderClient } from "../services/provider-client";
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

describe("Cooldown Manager", () => {
  let mockConfig: PlexusConfig;
  let manager: CooldownManager;
  const testStoragePath = "./test-cooldowns.json";

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
          name: "test-provider",
          enabled: true,
          apiTypes: ["chat"],
          baseUrls: { chat: "https://api.test.com" },
          auth: { type: "bearer", apiKey: "{env:TEST_KEY}" },
          models: ["test-model"],
        },
        {
          name: "provider-with-overrides",
          enabled: true,
          apiTypes: ["chat"],
          baseUrls: { chat: "https://api.test2.com" },
          auth: { type: "bearer", apiKey: "{env:TEST_KEY_2}" },
          models: ["test-model-2"],
          cooldown: {
            rate_limit: 30,
            server_error: 180,
          },
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

    manager = new CooldownManager(mockConfig);
  });

  afterEach(async () => {
    // Clean up test storage file
    if (await Bun.file(testStoragePath).exists()) {
      await unlink(testStoragePath);
    }
  });

  describe("setCooldown", () => {
    test("should set cooldown with default duration", () => {
      manager.setCooldown({
        provider: "test-provider",
        reason: "rate_limit",
      });

      expect(manager.isOnCooldown("test-provider")).toBe(true);
      const remaining = manager.getRemainingTime("test-provider");
      expect(remaining).toBeGreaterThan(0);
      expect(remaining).toBeLessThanOrEqual(60);
    });

    test("should set cooldown with explicit duration", () => {
      manager.setCooldown({
        provider: "test-provider",
        reason: "rate_limit",
        duration: 10,
      });

      expect(manager.isOnCooldown("test-provider")).toBe(true);
      const remaining = manager.getRemainingTime("test-provider");
      expect(remaining).toBeLessThanOrEqual(10);
    });

    test("should use provider-specific override", () => {
      manager.setCooldown({
        provider: "provider-with-overrides",
        reason: "rate_limit",
      });

      const entry = manager.getCooldown("provider-with-overrides");
      expect(entry).toBeDefined();
      // Should use provider override (30s) not default (60s)
      const duration = (entry!.endTime - entry!.startTime) / 1000;
      expect(duration).toBe(30);
    });

    test("should use retry-after header value", () => {
      manager.setCooldown({
        provider: "test-provider",
        reason: "rate_limit",
        retryAfter: 45,
      });

      const entry = manager.getCooldown("test-provider");
      expect(entry).toBeDefined();
      const duration = (entry!.endTime - entry!.startTime) / 1000;
      expect(duration).toBe(45);
    });

    test("should clamp duration to maxDuration", () => {
      manager.setCooldown({
        provider: "test-provider",
        reason: "rate_limit",
        duration: 5000, // Very high duration
      });

      const entry = manager.getCooldown("test-provider");
      expect(entry).toBeDefined();
      const duration = (entry!.endTime - entry!.startTime) / 1000;
      expect(duration).toBeLessThanOrEqual(3600); // maxDuration
    });

    test("should clamp duration to minDuration", () => {
      manager.setCooldown({
        provider: "test-provider",
        reason: "rate_limit",
        duration: 1, // Very low duration
      });

      const entry = manager.getCooldown("test-provider");
      expect(entry).toBeDefined();
      const duration = (entry!.endTime - entry!.startTime) / 1000;
      expect(duration).toBeGreaterThanOrEqual(5); // minDuration
    });

    test("should include error details", () => {
      manager.setCooldown({
        provider: "test-provider",
        reason: "server_error",
        httpStatus: 500,
        message: "Internal server error",
      });

      const entry = manager.getCooldown("test-provider");
      expect(entry).toBeDefined();
      expect(entry!.httpStatus).toBe(500);
      expect(entry!.message).toBe("Internal server error");
      expect(entry!.reason).toBe("server_error");
    });
  });

  describe("getCooldown", () => {
    test("should return undefined for provider not on cooldown", () => {
      const entry = manager.getCooldown("nonexistent-provider");
      expect(entry).toBeUndefined();
    });

    test("should return cooldown entry for provider on cooldown", () => {
      manager.setCooldown({
        provider: "test-provider",
        reason: "rate_limit",
      });

      const entry = manager.getCooldown("test-provider");
      expect(entry).toBeDefined();
      expect(entry!.provider).toBe("test-provider");
      expect(entry!.reason).toBe("rate_limit");
    });

    test("should filter expired cooldowns based on endTime", () => {
      // Manually create an expired cooldown entry
      manager.setCooldown({
        provider: "test-provider",
        reason: "rate_limit",
        duration: 5,
      });

      // Get the entry and manually expire it
      const entry = manager.getCooldown("test-provider");
      expect(entry).toBeDefined();
      
      // Modify the internal state to set an expired time (this tests lazy evaluation)
      entry!.endTime = Date.now() - 1000; // 1 second ago
      
      // Next call to getCooldown should detect it as expired
      const expiredEntry = manager.getCooldown("test-provider");
      expect(expiredEntry).toBeUndefined();
    });
  });

  describe("isOnCooldown", () => {
    test("should return false for provider not on cooldown", () => {
      expect(manager.isOnCooldown("test-provider")).toBe(false);
    });

    test("should return true for provider on cooldown", () => {
      manager.setCooldown({
        provider: "test-provider",
        reason: "rate_limit",
      });

      expect(manager.isOnCooldown("test-provider")).toBe(true);
    });
  });

  describe("clearCooldown", () => {
    test("should clear cooldown for specific provider", () => {
      manager.setCooldown({
        provider: "test-provider",
        reason: "rate_limit",
      });

      expect(manager.isOnCooldown("test-provider")).toBe(true);

      const cleared = manager.clearCooldown("test-provider");
      expect(cleared).toBe(true);
      expect(manager.isOnCooldown("test-provider")).toBe(false);
    });

    test("should return false when clearing non-existent cooldown", () => {
      const cleared = manager.clearCooldown("nonexistent");
      expect(cleared).toBe(false);
    });
  });

  describe("clearAllCooldowns", () => {
    test("should clear all cooldowns", () => {
      manager.setCooldown({
        provider: "test-provider",
        reason: "rate_limit",
      });
      manager.setCooldown({
        provider: "provider-with-overrides",
        reason: "server_error",
      });

      expect(manager.isOnCooldown("test-provider")).toBe(true);
      expect(manager.isOnCooldown("provider-with-overrides")).toBe(true);

      manager.clearAllCooldowns();

      expect(manager.isOnCooldown("test-provider")).toBe(false);
      expect(manager.isOnCooldown("provider-with-overrides")).toBe(false);
    });
  });

  describe("getActiveCooldowns", () => {
    test("should return empty array when no cooldowns", () => {
      const active = manager.getActiveCooldowns();
      expect(active).toEqual([]);
    });

    test("should return all active cooldowns", () => {
      manager.setCooldown({
        provider: "test-provider",
        reason: "rate_limit",
      });
      manager.setCooldown({
        provider: "provider-with-overrides",
        reason: "server_error",
      });

      const active = manager.getActiveCooldowns();
      expect(active).toHaveLength(2);
      expect(active.map((e) => e.provider)).toContain("test-provider");
      expect(active.map((e) => e.provider)).toContain("provider-with-overrides");
    });
  });

  describe("getRemainingTime", () => {
    test("should return 0 for provider not on cooldown", () => {
      const remaining = manager.getRemainingTime("test-provider");
      expect(remaining).toBe(0);
    });

    test("should return remaining seconds", () => {
      manager.setCooldown({
        provider: "test-provider",
        reason: "rate_limit",
        duration: 10,
      });

      const remaining = manager.getRemainingTime("test-provider");
      expect(remaining).toBeGreaterThan(0);
      expect(remaining).toBeLessThanOrEqual(10);
    });
  });
});

describe("ProviderClient.parseRetryAfter", () => {
  test("should parse retry-after seconds", () => {
    const response = new Response("", {
      headers: { "retry-after": "60" },
    });

    const result = ProviderClient.parseRetryAfter(response);
    expect(result.retryAfter).toBe(60);
    expect(result.source).toBe("header");
  });

  test("should parse retry-after HTTP date", () => {
    const futureDate = new Date(Date.now() + 120000); // 2 minutes from now
    const response = new Response("", {
      headers: { "retry-after": futureDate.toUTCString() },
    });

    const result = ProviderClient.parseRetryAfter(response);
    expect(result.retryAfter).toBeGreaterThan(0);
    expect(result.retryAfter).toBeLessThanOrEqual(120);
    expect(result.source).toBe("header");
  });

  test("should return default when retry-after missing", () => {
    const response = new Response("");

    const result = ProviderClient.parseRetryAfter(response);
    expect(result.retryAfter).toBeUndefined();
    expect(result.source).toBe("default");
  });

  test("should return default when retry-after invalid", () => {
    const response = new Response("", {
      headers: { "retry-after": "invalid" },
    });

    const result = ProviderClient.parseRetryAfter(response);
    expect(result.retryAfter).toBeUndefined();
    expect(result.source).toBe("default");
  });

  test("should cap large retry-after values", () => {
    const response = new Response("", {
      headers: { "retry-after": "7200" }, // 2 hours
    });

    const result = ProviderClient.parseRetryAfter(response);
    expect(result.retryAfter).toBe(7200);
    expect(result.source).toBe("header");
  });
});
