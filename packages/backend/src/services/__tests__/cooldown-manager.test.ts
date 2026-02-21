import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { CooldownManager } from "../cooldown-manager";
import { setConfigForTesting } from "../../config";

describe("CooldownManager", () => {
  beforeEach(async () => {
    await CooldownManager.getInstance().clearCooldown();
  });

  afterEach(async () => {
    await CooldownManager.getInstance().clearCooldown();
  });

  describe("exponential backoff", () => {
    test("first failure uses initial duration (2 minutes default)", async () => {
      setConfigForTesting({
        providers: {},
        models: {},
        keys: {},
        adminKey: "test",
        failover: { enabled: false, retryableStatusCodes: [], retryableErrors: [] },
        quotas: [],
      } as any);

      const cm = CooldownManager.getInstance();
      const before = Date.now();
      
      await cm.markProviderFailure("test-provider", "test-model");
      
      const cooldowns = cm.getCooldowns();
      expect(cooldowns).toHaveLength(1);
      
      const cooldown = cooldowns[0]!;
      // First failure should be ~2 minutes (120 seconds), allowing some tolerance
      const duration = cooldown.expiry - before;
      expect(duration).toBeGreaterThanOrEqual(115000); // ~2 minutes
      expect(duration).toBeLessThanOrEqual(125000);
      expect(cooldown.consecutiveFailures).toBe(1);
    });

    test("second failure doubles the duration (4 minutes)", async () => {
      setConfigForTesting({
        providers: {},
        models: {},
        keys: {},
        adminKey: "test",
        failover: { enabled: false, retryableStatusCodes: [], retryableErrors: [] },
        quotas: [],
      } as any);

      const cm = CooldownManager.getInstance();
      
      // First failure
      await cm.markProviderFailure("test-provider", "test-model");
      
      // Clear and simulate second failure
      await cm.clearCooldown("test-provider", "test-model");
      await cm.markProviderFailure("test-provider", "test-model");
      await cm.markProviderFailure("test-provider", "test-model");
      
      const cooldowns = cm.getCooldowns();
      const cooldown = cooldowns[0]!;
      const duration = cooldown.expiry - Date.now();
      
      // Second failure should be ~4 minutes (240 seconds)
      expect(duration).toBeGreaterThanOrEqual(235000); // ~4 minutes
      expect(duration).toBeLessThanOrEqual(245000);
      expect(cooldown.consecutiveFailures).toBe(2);
    });

    test("exponential progression follows 2^n pattern", async () => {
      setConfigForTesting({
        providers: {},
        models: {},
        keys: {},
        adminKey: "test",
        cooldown: { initialMinutes: 1, maxMinutes: 60 },
        failover: { enabled: false, retryableStatusCodes: [], retryableErrors: [] },
        quotas: [],
      } as any);

      const cm = CooldownManager.getInstance();
      const provider = "exp-test";
      const model = "exp-model";
      
      // Expected durations with 1-minute initial, max 60 minutes
      // n=0: 1 min, n=1: 2 min, n=2: 4 min, n=3: 8 min, n=4: 16 min, n=5: 32 min, n=6: 60 min (capped)
      const expectedMinutes = [1, 2, 4, 8, 16, 32, 60, 60];
      
      for (let i = 0; i < expectedMinutes.length; i++) {
        await cm.clearCooldown(provider, model);
        
        // Mark failure i+1 times
        for (let j = 0; j <= i; j++) {
          await cm.markProviderFailure(provider, model);
        }
        
        const cooldowns = cm.getCooldowns().filter(c => c.provider === provider);
        expect(cooldowns).toHaveLength(1);
        
        const cooldown = cooldowns[0]!;
        const durationMinutes = Math.round(cooldown.timeRemainingMs / 60000);
        expect(durationMinutes).toBe(expectedMinutes[i]!);
        expect(cooldown.consecutiveFailures).toBe(i + 1);
      }
    });

    test("respects max cooldown cap from config", async () => {
      setConfigForTesting({
        providers: {},
        models: {},
        keys: {},
        adminKey: "test",
        cooldown: { initialMinutes: 2, maxMinutes: 10 }, // 10 minute cap
        failover: { enabled: false, retryableStatusCodes: [], retryableErrors: [] },
        quotas: [],
      } as any);

      const cm = CooldownManager.getInstance();
      const provider = "cap-test";
      const model = "cap-model";
      
      // Force many failures to hit the cap
      for (let i = 0; i < 10; i++) {
        await cm.markProviderFailure(provider, model);
      }
      
      const cooldowns = cm.getCooldowns().filter(c => c.provider === provider);
      const cooldown = cooldowns[0]!;
      const durationMinutes = Math.round(cooldown.timeRemainingMs / 60000);
      
      // Should be capped at 10 minutes, not 2^10 * 2 = 2048 minutes
      expect(durationMinutes).toBeLessThanOrEqual(10);
      expect(durationMinutes).toBeGreaterThanOrEqual(9);
    });
  });

  describe("markProviderSuccess", () => {
    test("resets consecutive failure count", async () => {
      setConfigForTesting({
        providers: {},
        models: {},
        keys: {},
        adminKey: "test",
        failover: { enabled: false, retryableStatusCodes: [], retryableErrors: [] },
        quotas: [],
      } as any);

      const cm = CooldownManager.getInstance();
      const provider = "success-test";
      const model = "success-model";
      
      // Create multiple failures
      await cm.markProviderFailure(provider, model);
      await cm.markProviderFailure(provider, model);
      await cm.markProviderFailure(provider, model);
      
      let cooldowns = cm.getCooldowns().filter(c => c.provider === provider);
      expect(cooldowns[0]!.consecutiveFailures).toBe(3);
      
      // Mark success
      await cm.markProviderSuccess(provider, model);
      
      // Cooldown should be cleared
      cooldowns = cm.getCooldowns().filter(c => c.provider === provider);
      expect(cooldowns).toHaveLength(0);
      
      // Next failure should be treated as first
      await cm.markProviderFailure(provider, model);
      cooldowns = cm.getCooldowns().filter(c => c.provider === provider);
      expect(cooldowns[0]!.consecutiveFailures).toBe(1);
    });

    test("success on non-cooled provider does nothing", async () => {
      const cm = CooldownManager.getInstance();
      
      // Should not throw
      await cm.markProviderSuccess("never-failed", "model");
      
      const cooldowns = cm.getCooldowns().filter(c => c.provider === "never-failed");
      expect(cooldowns).toHaveLength(0);
    });
  });

  describe("getCooldowns", () => {
    test("returns cooldown with consecutiveFailures", async () => {
      setConfigForTesting({
        providers: {},
        models: {},
        keys: {},
        adminKey: "test",
        failover: { enabled: false, retryableStatusCodes: [], retryableErrors: [] },
        quotas: [],
      } as any);

      const cm = CooldownManager.getInstance();
      
      await cm.markProviderFailure("p1", "m1");
      await cm.markProviderFailure("p1", "m1");
      await cm.markProviderFailure("p2", "m2");
      
      const cooldowns = cm.getCooldowns();
      
      const p1 = cooldowns.find(c => c.provider === "p1");
      const p2 = cooldowns.find(c => c.provider === "p2");
      
      expect(p1?.consecutiveFailures).toBe(2);
      expect(p2?.consecutiveFailures).toBe(1);
    });
  });

  describe("clearCooldown", () => {
    test("clears specific provider and model", async () => {
      const cm = CooldownManager.getInstance();
      
      await cm.markProviderFailure("p1", "m1");
      await cm.markProviderFailure("p1", "m2");
      await cm.markProviderFailure("p2", "m1");
      
      await cm.clearCooldown("p1", "m1");
      
      const cooldowns = cm.getCooldowns();
      expect(cooldowns).toHaveLength(2);
      expect(cooldowns.some(c => c.provider === "p1" && c.model === "m1")).toBe(false);
    });

    test("clears all cooldowns for a provider", async () => {
      const cm = CooldownManager.getInstance();
      
      await cm.markProviderFailure("p1", "m1");
      await cm.markProviderFailure("p1", "m2");
      await cm.markProviderFailure("p2", "m1");
      
      await cm.clearCooldown("p1");
      
      const cooldowns = cm.getCooldowns();
      expect(cooldowns).toHaveLength(1);
      expect(cooldowns[0]!.provider).toBe("p2");
    });

    test("clears all cooldowns when no args", async () => {
      const cm = CooldownManager.getInstance();
      
      await cm.markProviderFailure("p1", "m1");
      await cm.markProviderFailure("p2", "m2");
      
      await cm.clearCooldown();
      
      expect(cm.getCooldowns()).toHaveLength(0);
    });
  });
});
