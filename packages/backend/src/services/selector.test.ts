import { describe, test, expect, beforeEach, mock } from "bun:test";
import { TargetSelector } from "./selector";
import type { TargetWithProvider } from "../types/routing";
import type { ProviderConfig } from "../types/config";
import { CostCalculator } from "./cost-calculator";
import { MetricsCollector } from "./metrics-collector";

describe("TargetSelector", () => {
  let mockProvider1: ProviderConfig;
  let mockProvider2: ProviderConfig;
  let mockProvider3: ProviderConfig;

  beforeEach(() => {
    mockProvider1 = {
      name: "provider-a",
      enabled: true,
      apiTypes: ["chat"],
      baseUrls: { chat: "https://api-a.com" },
      auth: { type: "bearer", apiKey: "{env:KEY_A}" },
      models: ["model-1"],
    } as ProviderConfig;

    mockProvider2 = {
      name: "provider-b",
      enabled: true,
      apiTypes: ["chat"],
      baseUrls: { chat: "https://api-b.com" },
      auth: { type: "bearer", apiKey: "{env:KEY_B}" },
      models: ["model-2"],
    } as ProviderConfig;

    mockProvider3 = {
      name: "provider-c",
      enabled: true,
      apiTypes: ["chat"],
      baseUrls: { chat: "https://api-c.com" },
      auth: { type: "bearer", apiKey: "{env:KEY_C}" },
      models: ["model-3"],
    } as ProviderConfig;
  });

  describe("random selector", () => {
    test("selects from available targets", () => {
      const selector = new TargetSelector();
      const targets: TargetWithProvider[] = [
        { provider: "provider-a", model: "model-1", providerConfig: mockProvider1, healthy: true },
        { provider: "provider-b", model: "model-2", providerConfig: mockProvider2, healthy: true },
      ];

      const selected = selector.select(targets, "random");
      expect(selected).not.toBeNull();
      expect(targets).toContainEqual(selected!);
    });

    test("respects weights when provided", () => {
      const selector = new TargetSelector();
      const targets: TargetWithProvider[] = [
        { provider: "provider-a", model: "model-1", providerConfig: mockProvider1, healthy: true, weight: 9 },
        { provider: "provider-b", model: "model-2", providerConfig: mockProvider2, healthy: true, weight: 1 },
      ];

      // Run multiple times to verify weighted distribution
      const selections = new Map<string, number>();
      for (let i = 0; i < 100; i++) {
        const selected = selector.select(targets, "random");
        const key = selected!.provider;
        selections.set(key, (selections.get(key) || 0) + 1);
      }

      // provider-a should be selected more often due to higher weight
      expect(selections.get("provider-a")!).toBeGreaterThan(selections.get("provider-b")!);
    });

    test("returns null for empty targets", () => {
      const selector = new TargetSelector();
      const selected = selector.select([], "random");
      expect(selected).toBeNull();
    });
  });

  describe("in_order selector", () => {
    test("selects first target when no previous attempts", () => {
      const selector = new TargetSelector();
      const targets: TargetWithProvider[] = [
        { provider: "provider-a", model: "model-1", providerConfig: mockProvider1, healthy: true },
        { provider: "provider-b", model: "model-2", providerConfig: mockProvider2, healthy: true },
      ];

      const selected = selector.select(targets, "in_order", {});
      expect(selected?.provider).toBe("provider-a");
    });

    test("skips previously attempted targets", () => {
      const selector = new TargetSelector();
      const targets: TargetWithProvider[] = [
        { provider: "provider-a", model: "model-1", providerConfig: mockProvider1, healthy: true },
        { provider: "provider-b", model: "model-2", providerConfig: mockProvider2, healthy: true },
        { provider: "provider-c", model: "model-3", providerConfig: mockProvider3, healthy: true },
      ];

      const selected = selector.select(targets, "in_order", {
        previousAttempts: [0, 1],
      });
      expect(selected?.provider).toBe("provider-c");
    });

    test("wraps around after all targets attempted", () => {
      const selector = new TargetSelector();
      const targets: TargetWithProvider[] = [
        { provider: "provider-a", model: "model-1", providerConfig: mockProvider1, healthy: true },
        { provider: "provider-b", model: "model-2", providerConfig: mockProvider2, healthy: true },
      ];

      const selected = selector.select(targets, "in_order", {
        previousAttempts: [0, 1],
      });
      expect(selected?.provider).toBe("provider-a");
    });
  });

  describe("cost selector", () => {
    test("selects cheapest provider based on metrics", () => {
      // Create a complete mock with all required methods
      const mockMetricsCollector = {
        getProviderCost: (provider: string) => {
          if (provider === "provider-a") return 5.0;
          if (provider === "provider-b") return 2.0;
          if (provider === "provider-c") return 8.0;
          return null;
        },
        getProviderLatency: () => null,
        getProviderPerformance: () => null,
        getProviderMetrics: () => null,
        getAllMetrics: () => new Map(),
        recordRequest: () => {},
        clear: () => {},
      } as any;

      const selector = new TargetSelector(undefined, mockMetricsCollector);
      const targets: TargetWithProvider[] = [
        { provider: "provider-a", model: "model-1", providerConfig: mockProvider1, healthy: true },
        { provider: "provider-b", model: "model-2", providerConfig: mockProvider2, healthy: true },
        { provider: "provider-c", model: "model-3", providerConfig: mockProvider3, healthy: true },
      ];

      const selected = selector.select(targets, "cost");
      expect(selected?.provider).toBe("provider-b");
    });

    test("falls back to random when no cost data available", () => {
      const mockMetricsCollector = {
        getProviderCost: () => null,
        getProviderLatency: () => null,
        getProviderPerformance: () => null,
        getProviderMetrics: () => null,
        getAllMetrics: () => new Map(),
        recordRequest: () => {},
        clear: () => {},
      } as any;

      const selector = new TargetSelector(undefined, mockMetricsCollector);
      const targets: TargetWithProvider[] = [
        { provider: "provider-a", model: "model-1", providerConfig: mockProvider1, healthy: true },
        { provider: "provider-b", model: "model-2", providerConfig: mockProvider2, healthy: true },
      ];

      const selected = selector.select(targets, "cost");
      expect(selected).not.toBeNull();
      expect(targets).toContainEqual(selected!);
    });

    test("falls back to random when no metrics collector", () => {
      const selector = new TargetSelector();
      const targets: TargetWithProvider[] = [
        { provider: "provider-a", model: "model-1", providerConfig: mockProvider1, healthy: true },
      ];

      const selected = selector.select(targets, "cost");
      expect(selected).not.toBeNull();
    });
  });

  describe("latency selector", () => {
    test("selects fastest provider based on metrics", () => {
      const mockMetricsCollector = {
        getProviderLatency: (provider: string) => {
          if (provider === "provider-a") return 500;
          if (provider === "provider-b") return 200;
          if (provider === "provider-c") return 800;
          return null;
        },
        getProviderCost: () => null,
        getProviderPerformance: () => null,
        getProviderMetrics: () => null,
        getAllMetrics: () => new Map(),
        recordRequest: () => {},
        clear: () => {},
      } as any;

      const selector = new TargetSelector(undefined, mockMetricsCollector);
      const targets: TargetWithProvider[] = [
        { provider: "provider-a", model: "model-1", providerConfig: mockProvider1, healthy: true },
        { provider: "provider-b", model: "model-2", providerConfig: mockProvider2, healthy: true },
        { provider: "provider-c", model: "model-3", providerConfig: mockProvider3, healthy: true },
      ];

      const selected = selector.select(targets, "latency");
      expect(selected?.provider).toBe("provider-b");
    });

    test("falls back to random when no latency data available", () => {
      const mockMetricsCollector = {
        getProviderLatency: () => null,
        getProviderCost: () => null,
        getProviderPerformance: () => null,
        getProviderMetrics: () => null,
        getAllMetrics: () => new Map(),
        recordRequest: () => {},
        clear: () => {},
      } as any;

      const selector = new TargetSelector(undefined, mockMetricsCollector);
      const targets: TargetWithProvider[] = [
        { provider: "provider-a", model: "model-1", providerConfig: mockProvider1, healthy: true },
        { provider: "provider-b", model: "model-2", providerConfig: mockProvider2, healthy: true },
      ];

      const selected = selector.select(targets, "latency");
      expect(selected).not.toBeNull();
    });
  });

  describe("performance selector", () => {
    test("selects provider with highest performance score", () => {
      const mockMetricsCollector = {
        getProviderPerformance: (provider: string) => {
          if (provider === "provider-a") return 0.5;
          if (provider === "provider-b") return 1.5;
          if (provider === "provider-c") return 0.8;
          return null;
        },
        getProviderLatency: () => null,
        getProviderCost: () => null,
        getProviderMetrics: () => null,
        getAllMetrics: () => new Map(),
        recordRequest: () => {},
        clear: () => {},
      } as any;

      const selector = new TargetSelector(undefined, mockMetricsCollector);
      const targets: TargetWithProvider[] = [
        { provider: "provider-a", model: "model-1", providerConfig: mockProvider1, healthy: true },
        { provider: "provider-b", model: "model-2", providerConfig: mockProvider2, healthy: true },
        { provider: "provider-c", model: "model-3", providerConfig: mockProvider3, healthy: true },
      ];

      const selected = selector.select(targets, "performance");
      expect(selected?.provider).toBe("provider-b");
    });

    test("falls back to random when no performance data available", () => {
      const mockMetricsCollector = {
        getProviderPerformance: () => null,
        getProviderLatency: () => null,
        getProviderCost: () => null,
        getProviderMetrics: () => null,
        getAllMetrics: () => new Map(),
        recordRequest: () => {},
        clear: () => {},
      } as any;

      const selector = new TargetSelector(undefined, mockMetricsCollector);
      const targets: TargetWithProvider[] = [
        { provider: "provider-a", model: "model-1", providerConfig: mockProvider1, healthy: true },
      ];

      const selected = selector.select(targets, "performance");
      expect(selected).not.toBeNull();
    });
  });
});
