import { describe, it, expect, beforeEach } from 'bun:test';
import { HuggingFaceModelFetcher } from '../../src/services/huggingface-model-fetcher';
import { PROPRIETARY_MODEL_HEURISTICS, resolveDtypeSize } from '@plexus/shared';

// ─── 7. matchHeuristic ──────────────────────────────────────

describe('matchHeuristic', () => {
  let fetcher: HuggingFaceModelFetcher;

  beforeEach(() => {
    HuggingFaceModelFetcher.resetForTesting();
    fetcher = HuggingFaceModelFetcher.getInstance();
  });

  // @ts-ignore — accessing private method for testing
  const callMatchHeuristic = (f: HuggingFaceModelFetcher, id: string) => f.matchHeuristic(id);

  it('happy path — exact match', () => {
    const result = callMatchHeuristic(fetcher, 'claude-4-6-opus');
    expect(result).not.toBeNull();
    expect(result!.total_params).toBe(
      PROPRIETARY_MODEL_HEURISTICS['claude-4-6-opus']!.total_params
    );
  });

  it('happy path — substring match with prefix', () => {
    const result = callMatchHeuristic(fetcher, 'anthropic/claude-4-6-sonnet-2026');
    expect(result).not.toBeNull();
    expect(result!.total_params).toBe(
      PROPRIETARY_MODEL_HEURISTICS['claude-4-6-sonnet']!.total_params
    );
  });

  it('gpt-5-codex-max matches the more-specific key, not gpt-5', () => {
    const result = callMatchHeuristic(fetcher, 'gpt-5-codex-max');
    expect(result).not.toBeNull();
    // Keys are sorted by length descending, so 'gpt-5-codex-max' is
    // checked before 'gpt-5', and the more-specific match wins.
    expect(result!.total_params).toBe(
      PROPRIETARY_MODEL_HEURISTICS['gpt-5-codex-max']!.total_params
    );
  });

  it('claude-4-5-opus matches opus, not sonnet', () => {
    const result = callMatchHeuristic(fetcher, 'claude-4-5-opus');
    expect(result).not.toBeNull();
    expect(result!.total_params).toBe(
      PROPRIETARY_MODEL_HEURISTICS['claude-4-5-opus']!.total_params
    );
  });

  it('returns null for unmatched model', () => {
    const result = callMatchHeuristic(fetcher, 'unknown-model-v1');
    expect(result).toBeNull();
  });

  it('case-insensitive match', () => {
    const result = callMatchHeuristic(fetcher, 'GPT-5');
    expect(result).not.toBeNull();
    expect(result!.total_params).toBe(PROPRIETARY_MODEL_HEURISTICS['gpt-5']!.total_params);
  });
});

// ─── 8. parseConfig ──────────────────────────────────────────

describe('parseConfig', () => {
  let fetcher: HuggingFaceModelFetcher;

  beforeEach(() => {
    HuggingFaceModelFetcher.resetForTesting();
    fetcher = HuggingFaceModelFetcher.getInstance();
  });

  // @ts-ignore — accessing private method for testing
  const callParseConfig = (f: HuggingFaceModelFetcher, data: any) => f.parseConfig(data);

  it('happy path — full Llama-style config', () => {
    const modelData = {
      source: 'huggingface' as const,
      safetensorsParams: { BF16: 70e9 },
      totalParams: 70.0,
      config: {
        hidden_size: 8192,
        num_hidden_layers: 80,
        num_attention_heads: 64,
        num_key_value_heads: 8,
        intermediate_size: 28672,
        max_position_embeddings: 131072,
        vocab_size: 128256,
        torch_dtype: 'bfloat16',
      },
    };

    const result = callParseConfig(fetcher, modelData);

    expect(result.layers).toBe(80);
    expect(result.heads).toBe(64);
    expect(result.context_length).toBe(131072);
    expect(result.dtype).toBe('bf16');
    expect(result.qk_rope_head_dim).toBe(128);
    // total_params should come from safetensors (more accurate), not config estimate
    expect(result.total_params).toBe(70.0);
    expect(result.active_params).toBeDefined();
  });

  it('RoPE scaling extends context beyond max_position_embeddings', () => {
    const modelData = {
      source: 'huggingface' as const,
      config: {
        max_position_embeddings: 4096,
        rope_scaling: {
          factor: 4,
          original_max_position_embeddings: 8192,
        },
      },
    };

    const result = callParseConfig(fetcher, modelData);

    // 8192 * 4 = 32768, which is > 4096 → Math.max picks 32768
    expect(result.context_length).toBe(32768);
  });

  it('qk_rope_head_dim uses Math.floor on hidden_size / num_attention_heads', () => {
    const modelData = {
      source: 'huggingface' as const,
      config: {
        hidden_size: 4096,
        num_attention_heads: 32,
      },
    };

    const result = callParseConfig(fetcher, modelData);

    expect(result.qk_rope_head_dim).toBe(128);
  });

  it('MoE fields nested in text_config are used', () => {
    const modelData = {
      source: 'huggingface' as const,
      totalParams: 46.7,
      config: {
        hidden_size: 4096,
        num_hidden_layers: 32,
        num_attention_heads: 32,
        text_config: {
          num_local_experts: 8,
          num_experts_per_tok: 2,
        },
      },
    };

    const result = callParseConfig(fetcher, modelData);

    // active_params should reflect MoE: 46.7 / 8 * 2 ≈ 11.7
    expect(result.active_params).toBeCloseTo(11.7, 1);
  });

  it('n_routed_experts works as alias for num_local_experts', () => {
    const modelData = {
      source: 'huggingface' as const,
      totalParams: 46.7,
      config: {
        hidden_size: 4096,
        num_hidden_layers: 32,
        num_attention_heads: 32,
        n_routed_experts: 8,
        num_experts_per_tok: 2,
      },
    };

    const result = callParseConfig(fetcher, modelData);

    // Same MoE calculation as num_local_experts
    expect(result.active_params).toBeCloseTo(11.7, 1);
  });

  it('context_length picks max_position_embeddings over other fields', () => {
    const modelData = {
      source: 'huggingface' as const,
      config: {
        max_position_embeddings: 8192,
        max_sequence_length: 4096,
        ctx_length: 2048,
      },
    };

    const result = callParseConfig(fetcher, modelData);

    expect(result.context_length).toBe(8192);
  });

  it('no config — safetensors-only data', () => {
    const modelData = {
      source: 'huggingface' as const,
      safetensorsParams: { BF16: 1e9 },
      totalParams: 1.0,
      config: undefined,
    };

    const result = callParseConfig(fetcher, modelData);

    expect(result.total_params).toBe(1.0);
    expect(result.active_params).toBe(1.0);
    expect(result.dtype).toBe('bf16');
    expect(result.dtype_size).toBe(resolveDtypeSize('bf16'));
  });

  it('safetensors total takes priority over config estimate', () => {
    const modelData = {
      source: 'huggingface' as const,
      safetensorsParams: { BF16: 70e9 },
      totalParams: 70.0,
      config: {
        vocab_size: 128256,
        hidden_size: 8192,
        num_hidden_layers: 80,
        intermediate_size: 28672,
        num_attention_heads: 64,
      },
    };

    const result = callParseConfig(fetcher, modelData);

    // total_params should be 70.0 from safetensors, not the config estimate
    expect(result.total_params).toBe(70.0);
  });
});
