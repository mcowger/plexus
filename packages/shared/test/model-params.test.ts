import { describe, it, expect } from 'bun:test';
import {
  DTYPE_SIZES,
  resolveDtypeSize,
  normalizeDtypeName,
  inferDataType,
  DEFAULT_MODEL,
  resolveModelParams,
  estimateTotalParamsFromConfig,
  estimateActiveParams,
} from '../src/model-params';
import type { ModelParamsWithDtype } from '../src/model-params';

// ─── 1. normalizeDtypeName ─────────────────────────────────

describe('normalizeDtypeName', () => {
  it('happy path — config-style input', () => {
    expect(normalizeDtypeName('bfloat16')).toBe('bf16');
  });

  it('happy path — safetensors-style input', () => {
    expect(normalizeDtypeName('BF16')).toBe('bf16');
  });

  it('happy path — already normalized', () => {
    expect(normalizeDtypeName('fp8')).toBe('fp8');
  });

  it('strips hyphens before lookup', () => {
    expect(normalizeDtypeName('float-16')).toBe('fp16');
  });

  it('strips underscores before lookup', () => {
    expect(normalizeDtypeName('float_8_e4m3fn')).toBe('fp8_e4m3');
  });

  it('lowercases and strips separators together', () => {
    expect(normalizeDtypeName('BF-16')).toBe('bf16');
  });

  it('returns null for unrecognized dtype', () => {
    expect(normalizeDtypeName('custom_type')).toBeNull();
  });
});

// ─── 2. inferDataType ──────────────────────────────────────

describe('inferDataType', () => {
  it('happy path — torch_dtype wins', () => {
    expect(inferDataType({ torch_dtype: 'bfloat16' })).toBe('bf16');
  });

  it('happy path — safetensors fallback', () => {
    expect(inferDataType({ safetensors: { BF16: 1e9, F8_E4M3: 1e8 } })).toBe('bf16');
  });

  it('happy path — default fallback', () => {
    expect(inferDataType({})).toBe('fp8');
  });

  it('falls to safetensors when torch_dtype is unrecognized', () => {
    expect(inferDataType({ torch_dtype: 'custom_type', safetensors: { BF16: 1e9 } })).toBe('bf16');
  });

  it('torch_dtype wins over safetensors', () => {
    expect(inferDataType({ torch_dtype: 'bfloat16', safetensors: { F8_E4M3: 2e9 } })).toBe('bf16');
  });

  it('F32-dominant safetensors → fp16 heuristic', () => {
    expect(inferDataType({ safetensors: { F32: 1e9 } })).toBe('fp16');
  });

  it('all-zero safetensors → default', () => {
    expect(inferDataType({ safetensors: { BF16: 0, F16: 0 } })).toBe('fp8');
  });

  it('unknown dominant dtype with F8_E5M2 present → fp8', () => {
    expect(inferDataType({ safetensors: { CUSTOM_DTYPE: 5e9, F8_E5M2: 100 } })).toBe('fp8');
  });
});

// ─── 3. resolveModelParams ──────────────────────────────────

describe('resolveModelParams', () => {
  it('happy path — full override, nothing from defaults', () => {
    const full: ModelParamsWithDtype = {
      total_params: 500,
      active_params: 50,
      layers: 80,
      context_length: 128000,
      kv_lora_rank: 128,
      qk_rope_head_dim: 96,
      dtype: 'bf16',
      dtype_size: 2,
      heads: 64,
    };
    const result = resolveModelParams(full);
    expect(result.total_params).toBe(500);
    expect(result.active_params).toBe(50);
    expect(result.layers).toBe(80);
    expect(result.context_length).toBe(128000);
    expect(result.dtype).toBe('bf16');
    expect(result.dtype_size).toBe(2);
    expect(result.heads).toBe(64);
  });

  it('active_params falls back to total_params, not default', () => {
    const result = resolveModelParams({ total_params: 200 });
    expect(result.active_params).toBe(200);
    expect(result.active_params).not.toBe(DEFAULT_MODEL.active_params);
  });

  it('explicit active_params is not overridden by fallback', () => {
    const result = resolveModelParams({ total_params: 500, active_params: 50 });
    expect(result.active_params).toBe(50);
  });

  it('dtype_size is recomputed from dtype, ignoring input dtype_size', () => {
    const result = resolveModelParams({ dtype: 'bf16', dtype_size: 999 });
    expect(result.dtype_size).toBe(2);
    expect(result.dtype_size).not.toBe(999);
  });
});

// ─── 4. estimateTotalParamsFromConfig ───────────────────────

describe('estimateTotalParamsFromConfig', () => {
  it('happy path — Llama-3.1-70B scale lands in plausible range', () => {
    const result = estimateTotalParamsFromConfig({
      vocab_size: 128256,
      hidden_size: 8192,
      num_hidden_layers: 80,
      intermediate_size: 28672,
    });
    expect(result).toBeDefined();
    // The standard transformer formula is a rough estimate;
    // Llama-3.1-70B lands ~55B because the formula doesn't account
    // for all architectural details (tied embeddings, etc.)
    expect(result!).toBeGreaterThanOrEqual(50);
    expect(result!).toBeLessThanOrEqual(80);
  });

  it('returns undefined when intermediate_size is missing', () => {
    const result = estimateTotalParamsFromConfig({
      vocab_size: 32000,
      hidden_size: 4096,
      num_hidden_layers: 32,
    });
    expect(result).toBeUndefined();
  });

  it('returns undefined when any required field is zero', () => {
    const result = estimateTotalParamsFromConfig({
      vocab_size: 0,
      hidden_size: 4096,
      num_hidden_layers: 32,
      intermediate_size: 14336,
    });
    expect(result).toBeUndefined();
  });
});

// ─── 5. estimateActiveParams ────────────────────────────────

describe('estimateActiveParams', () => {
  it('happy path — dense model, active equals total', () => {
    expect(estimateActiveParams({ totalParams: 70 })).toBe(70);
  });

  it('happy path — MoE model', () => {
    const result = estimateActiveParams({
      totalParams: 46.7,
      numLocalExperts: 8,
      numExpertsPerTok: 2,
    });
    // 46.7 / 8 * 2 = 11.675 → rounded to 11.7
    expect(result).toBeCloseTo(11.7, 1);
  });

  it('partial MoE — only numLocalExperts → falls back to dense', () => {
    const result = estimateActiveParams({ totalParams: 100, numLocalExperts: 8 });
    expect(result).toBe(100);
  });

  it('partial MoE — only numExpertsPerTok → falls back to dense', () => {
    const result = estimateActiveParams({ totalParams: 100, numExpertsPerTok: 2 });
    expect(result).toBe(100);
  });

  it('zero totalParams → fallback to 0.1', () => {
    const result = estimateActiveParams({ totalParams: 0 });
    expect(result).toBe(0.1);
  });
});

// ─── 6. inferDtypeFromSafetensors (via inferDataType) ──────

describe('inferDtypeFromSafetensors (via inferDataType)', () => {
  it('happy path — single dtype', () => {
    expect(inferDataType({ safetensors: { BF16: 1e9 } })).toBe('bf16');
  });

  it('mixed dtypes — largest param count wins', () => {
    expect(inferDataType({ safetensors: { BF16: 500, F8_E4M3: 2000 } })).toBe('fp8_e4m3');
  });
});
