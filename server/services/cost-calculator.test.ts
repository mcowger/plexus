import { describe, test, expect, beforeEach } from "bun:test";
import { CostCalculator } from "./cost-calculator";
import type { PricingConfigType } from "../types/config";
import type { ConfigManager } from "./config-manager";

describe("CostCalculator", () => {
  let calculator: CostCalculator;
  let pricingConfig: PricingConfigType;
  let mockConfigManager: ConfigManager;

  beforeEach(() => {
    pricingConfig = {
      models: {
        "gpt-4o": {
          inputPer1M: 2.50,
          outputPer1M: 10.00,
          cachedPer1M: 1.25,
          reasoningPer1M: 5.00,
        },
        "gpt-4o-mini": {
          inputPer1M: 0.15,
          outputPer1M: 0.60,
          cachedPer1M: 0.075,
        },
      },
      tiered: {
        "gpt-4-turbo": [
          {
            maxInputTokens: 128000,
            inputPer1M: 10.00,
            outputPer1M: 30.00,
          },
        ],
      },
      discounts: {
        "azure-openai": 0.85,
      },
    };
    
    // Create mock ConfigManager
    mockConfigManager = {
      getCurrentConfig: () => ({ pricing: pricingConfig }),
    } as unknown as ConfigManager;
    
    calculator = new CostCalculator(mockConfigManager);
  });

  describe("calculateCost", () => {
    test("calculates cost for simple pricing", async () => {
      const result = await calculator.calculateCost({
        model: "gpt-4o",
        provider: "openai",
        inputTokens: 1000,
        outputTokens: 500,
        cachedTokens: 0,
        reasoningTokens: 0,
      });

      expect(result.inputCost).toBeCloseTo(0.0025, 5); // (1000 / 1M) * 2.50
      expect(result.outputCost).toBeCloseTo(0.005, 5); // (500 / 1M) * 10.00
      expect(result.cachedCost).toBe(0);
      expect(result.reasoningCost).toBe(0);
      expect(result.totalCost).toBeCloseTo(0.0075, 5);
      expect(result.source).toBe("config");
      expect(result.discount).toBe(1.0);
    });

    test("calculates cost with cached tokens", async () => {
      const result = await calculator.calculateCost({
        model: "gpt-4o",
        provider: "openai",
        inputTokens: 1000,
        outputTokens: 500,
        cachedTokens: 200,
        reasoningTokens: 0,
      });

      expect(result.cachedCost).toBeCloseTo(0.00025, 5); // (200 / 1M) * 1.25
      expect(result.totalCost).toBeCloseTo(0.00775, 5); // 0.0025 + 0.005 + 0.00025
    });

    test("calculates cost with reasoning tokens", async () => {
      const result = await calculator.calculateCost({
        model: "gpt-4o",
        provider: "openai",
        inputTokens: 1000,
        outputTokens: 500,
        cachedTokens: 0,
        reasoningTokens: 300,
      });

      expect(result.reasoningCost).toBeCloseTo(0.0015, 5); // (300 / 1M) * 5.00
      expect(result.totalCost).toBeCloseTo(0.009, 5); // 0.0025 + 0.005 + 0.0015
    });

    test("applies provider discount", async () => {
      const result = await calculator.calculateCost({
        model: "gpt-4o",
        provider: "azure-openai",
        inputTokens: 1000,
        outputTokens: 500,
        cachedTokens: 0,
        reasoningTokens: 0,
      });

      expect(result.discount).toBe(0.85);
      expect(result.totalCost).toBeCloseTo(0.006375, 5); // 0.0075 * 0.85
    });

    test("uses tiered pricing based on input tokens", async () => {
      const result = await calculator.calculateCost({
        model: "gpt-4-turbo",
        provider: "openai",
        inputTokens: 100000,
        outputTokens: 1000,
        cachedTokens: 0,
        reasoningTokens: 0,
      });

      expect(result.inputCost).toBeCloseTo(1.0, 5); // (100000 / 1M) * 10.00
      expect(result.outputCost).toBeCloseTo(0.03, 5); // (1000 / 1M) * 30.00
      expect(result.totalCost).toBeCloseTo(1.03, 5);
      expect(result.source).toBe("config");
    });

    test("uses estimation for unknown model", async () => {
      const result = await calculator.calculateCost({
        model: "unknown-model",
        provider: "unknown-provider",
        inputTokens: 1000,
        outputTokens: 500,
        cachedTokens: 0,
        reasoningTokens: 0,
      });

      expect(result.source).toBe("estimated");
      expect(result.totalCost).toBeGreaterThan(0);
    });
  });

  describe("getEstimatedCostPer1M", () => {
    test("returns average of input and output costs for configured model", async () => {
      const cost = await calculator.getEstimatedCostPer1M("gpt-4o", "openai");
      expect(cost).toBeCloseTo(6.25, 2); // (2.50 + 10.00) / 2
    });

    test("applies discount to estimated cost", async () => {
      const cost = await calculator.getEstimatedCostPer1M("gpt-4o", "azure-openai");
      expect(cost).toBeCloseTo(5.3125, 2); // ((2.50 + 10.00) / 2) * 0.85
    });

    test("returns fallback estimate for unknown model", async () => {
      const cost = await calculator.getEstimatedCostPer1M("unknown", "openai");
      expect(cost).toBeGreaterThan(0);
    });
  });

  describe("updateConfig", () => {
    test("updates pricing configuration via ConfigManager", async () => {
      const newConfig: PricingConfigType = {
        models: {
          "new-model": {
            inputPer1M: 1.00,
            outputPer1M: 2.00,
          },
        },
      };

      // Update the mock ConfigManager to return new config
      (mockConfigManager as any).getCurrentConfig = () => ({ pricing: newConfig });

      // Test that new config is used
      const cost = await calculator.getEstimatedCostPer1M("new-model", "openai");
      expect(cost).toBeCloseTo(1.5, 2); // (1.00 + 2.00) / 2
    });
  });
});
