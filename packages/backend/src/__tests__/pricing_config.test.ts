import { describe, it, expect } from "bun:test";
import { validateConfig } from "../config";

describe("Config Pricing Schema", () => {
  it("should validate config with openrouter pricing", () => {
    const yamlContent = `
providers:
  synthetic:
    type: chat
    display_name: Synthetic
    api_base_url: https://api.synthetic.new/openai/v1
    models:
      hf:MiniMaxAI/MiniMax-M2.1:
        pricing:
          source: openrouter
          slug: minimax/minimax-m2.1
models:
  test-model:
    targets:
      - provider: synthetic
        model: hf:MiniMaxAI/MiniMax-M2.1
`;
    const config = validateConfig(yamlContent);
    expect(config.providers.synthetic.models).toBeDefined();
    const models = config.providers.synthetic.models as any;
    expect(models["hf:MiniMaxAI/MiniMax-M2.1"].pricing.source).toBe("openrouter");
  });

  it("should validate config with defined pricing ranges", () => {
    const yamlContent = `
providers:
  synthetic:
    type: chat
    display_name: Synthetic
    api_base_url: https://api.synthetic.new/openai/v1
    models:
      hf:othermodel/model:
        pricing:
          source: defined
          range:
            - lower_bound: 0
              upper_bound: 200000
              input_per_m: 0.15
              output_per_m: 0.15
            - lower_bound: 200000
              upper_bound: .inf
              input_per_m: 0.25
              output_per_m: 0.90
models:
  test-model:
    targets:
      - provider: synthetic
        model: hf:othermodel/model
`;
    const config = validateConfig(yamlContent);
    const models = config.providers.synthetic.models as any;
    const ranges = models["hf:othermodel/model"].pricing.range;
    expect(ranges).toHaveLength(2);
    expect(ranges[1].upper_bound).toBe(Infinity);
  });

  it("should still validate legacy array models", () => {
    const yamlContent = `
providers:
  openai:
    type: chat
    api_base_url: https://api.openai.com/v1
    models:
      - gpt-4
models:
  test-model:
    targets:
      - provider: openai
        model: gpt-4
`;
    const config = validateConfig(yamlContent);
    expect(Array.isArray(config.providers.openai.models)).toBe(true);
  });

  it("should fail if source is openrouter but slug is missing", () => {
    const yamlContent = `
providers:
  synthetic:
    type: chat
    api_base_url: https://api.synthetic.new/openai/v1
    models:
      hf:model:
        pricing:
          source: openrouter
models: {}
`;
    expect(() => validateConfig(yamlContent)).toThrow();
  });

  it("should fail if source is defined but range is missing", () => {
    const yamlContent = `
providers:
  synthetic:
    type: chat
    api_base_url: https://api.synthetic.new/openai/v1
    models:
      hf:model:
        pricing:
          source: defined
models: {}
`;
    expect(() => validateConfig(yamlContent)).toThrow();
  });
});
