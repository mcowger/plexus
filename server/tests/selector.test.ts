import { test, expect, describe } from "bun:test";
import { TargetSelector } from "../services/selector";
import type { TargetWithProvider } from "../types/routing";
import type { ProviderConfig } from "../types/config";

const mockProvider1: ProviderConfig = {
  name: "provider1",
  enabled: true,
  baseUrls: { chat: { url: "https://api.provider1.com", enabled: true } },
  auth: { type: "bearer", apiKey: "{env:KEY1}" },
  models: ["model1"],
};

const mockProvider2: ProviderConfig = {
  name: "provider2",
  enabled: true,
  baseUrls: { chat: { url: "https://api.provider2.com", enabled: true } },
  auth: { type: "bearer", apiKey: "{env:KEY2}" },
  models: ["model2"],
};

describe("TargetSelector", () => {
  describe("Random Selection", () => {
    test("returns null for empty targets array", () => {
      const selector = new TargetSelector();
      const result = selector.select([], "random");
      expect(result).toBeNull();
    });

    test("returns single target when only one available", () => {
      const selector = new TargetSelector();
      const targets: TargetWithProvider[] = [
        {
          provider: "provider1",
          model: "model1",
          providerConfig: mockProvider1,
          healthy: true,
        },
      ];

      const result = selector.select(targets, "random");
      expect(result).toBeDefined();
      expect(result?.provider).toBe("provider1");
      expect(result?.model).toBe("model1");
    });

    test("uniformly distributes when no weights specified", () => {
      const selector = new TargetSelector();
      const targets: TargetWithProvider[] = [
        {
          provider: "provider1",
          model: "model1",
          providerConfig: mockProvider1,
          healthy: true,
        },
        {
          provider: "provider2",
          model: "model2",
          providerConfig: mockProvider2,
          healthy: true,
        },
      ];

      // Run selection many times and check distribution
      const counts = { provider1: 0, provider2: 0 };
      const iterations = 1000;

      for (let i = 0; i < iterations; i++) {
        const result = selector.select(targets, "random");
        if (result?.provider === "provider1") counts.provider1++;
        if (result?.provider === "provider2") counts.provider2++;
      }

      // Both should be selected roughly 50% of the time (with some tolerance)
      const ratio1 = counts.provider1 / iterations;
      const ratio2 = counts.provider2 / iterations;
      
      expect(ratio1).toBeGreaterThan(0.4);
      expect(ratio1).toBeLessThan(0.6);
      expect(ratio2).toBeGreaterThan(0.4);
      expect(ratio2).toBeLessThan(0.6);
    });

    test("respects weights when specified", () => {
      const selector = new TargetSelector();
      const targets: TargetWithProvider[] = [
        {
          provider: "provider1",
          model: "model1",
          weight: 70,
          providerConfig: mockProvider1,
          healthy: true,
        },
        {
          provider: "provider2",
          model: "model2",
          weight: 30,
          providerConfig: mockProvider2,
          healthy: true,
        },
      ];

      // Run selection many times and check distribution
      const counts = { provider1: 0, provider2: 0 };
      const iterations = 1000;

      for (let i = 0; i < iterations; i++) {
        const result = selector.select(targets, "random");
        if (result?.provider === "provider1") counts.provider1++;
        if (result?.provider === "provider2") counts.provider2++;
      }

      // Provider1 should be selected ~70% of the time
      const ratio1 = counts.provider1 / iterations;
      const ratio2 = counts.provider2 / iterations;
      
      expect(ratio1).toBeGreaterThan(0.6);
      expect(ratio1).toBeLessThan(0.8);
      expect(ratio2).toBeGreaterThan(0.2);
      expect(ratio2).toBeLessThan(0.4);
    });

    test("handles mixed weights (some specified, some default)", () => {
      const selector = new TargetSelector();
      const targets: TargetWithProvider[] = [
        {
          provider: "provider1",
          model: "model1",
          weight: 2,
          providerConfig: mockProvider1,
          healthy: true,
        },
        {
          provider: "provider2",
          model: "model2",
          // No weight specified - should default to 1
          providerConfig: mockProvider2,
          healthy: true,
        },
      ];

      // Run selection many times and check distribution
      const counts = { provider1: 0, provider2: 0 };
      const iterations = 1000;

      for (let i = 0; i < iterations; i++) {
        const result = selector.select(targets, "random");
        if (result?.provider === "provider1") counts.provider1++;
        if (result?.provider === "provider2") counts.provider2++;
      }

      // Provider1 should be selected ~66% (2/3) of the time
      const ratio1 = counts.provider1 / iterations;
      const ratio2 = counts.provider2 / iterations;
      
      expect(ratio1).toBeGreaterThan(0.55);
      expect(ratio1).toBeLessThan(0.75);
      expect(ratio2).toBeGreaterThan(0.25);
      expect(ratio2).toBeLessThan(0.45);
    });
  });

  describe("In-Order Selection", () => {
    test("always returns first target when no previous attempts", () => {
      const selector = new TargetSelector();
      const targets: TargetWithProvider[] = [
        {
          provider: "provider1",
          model: "model1",
          providerConfig: mockProvider1,
          healthy: true,
        },
        {
          provider: "provider2",
          model: "model2",
          providerConfig: mockProvider2,
          healthy: true,
        },
      ];

      for (let i = 0; i < 10; i++) {
        const result = selector.select(targets, "in_order");
        expect(result?.provider).toBe("provider1");
      }
    });

    test("skips previously attempted targets", () => {
      const selector = new TargetSelector();
      const targets: TargetWithProvider[] = [
        {
          provider: "provider1",
          model: "model1",
          providerConfig: mockProvider1,
          healthy: true,
        },
        {
          provider: "provider2",
          model: "model2",
          providerConfig: mockProvider2,
          healthy: true,
        },
      ];

      // First attempt already tried index 0
      const result = selector.select(targets, "in_order", {
        previousAttempts: [0],
      });
      expect(result?.provider).toBe("provider2");
    });

    test("returns first target when all have been attempted", () => {
      const selector = new TargetSelector();
      const targets: TargetWithProvider[] = [
        {
          provider: "provider1",
          model: "model1",
          providerConfig: mockProvider1,
          healthy: true,
        },
        {
          provider: "provider2",
          model: "model2",
          providerConfig: mockProvider2,
          healthy: true,
        },
      ];

      // All targets attempted
      const result = selector.select(targets, "in_order", {
        previousAttempts: [0, 1],
      });
      expect(result?.provider).toBe("provider1");
    });
  });

  describe("Future Selector Strategies", () => {
    test("cost selector falls back to random for now", () => {
      const selector = new TargetSelector();
      const targets: TargetWithProvider[] = [
        {
          provider: "provider1",
          model: "model1",
          providerConfig: mockProvider1,
          healthy: true,
        },
      ];

      const result = selector.select(targets, "cost");
      expect(result).toBeDefined();
      expect(result?.provider).toBe("provider1");
    });

    test("latency selector falls back to random for now", () => {
      const selector = new TargetSelector();
      const targets: TargetWithProvider[] = [
        {
          provider: "provider1",
          model: "model1",
          providerConfig: mockProvider1,
          healthy: true,
        },
      ];

      const result = selector.select(targets, "latency");
      expect(result).toBeDefined();
      expect(result?.provider).toBe("provider1");
    });

    test("performance selector falls back to random for now", () => {
      const selector = new TargetSelector();
      const targets: TargetWithProvider[] = [
        {
          provider: "provider1",
          model: "model1",
          providerConfig: mockProvider1,
          healthy: true,
        },
      ];

      const result = selector.select(targets, "performance");
      expect(result).toBeDefined();
      expect(result?.provider).toBe("provider1");
    });
  });
});
