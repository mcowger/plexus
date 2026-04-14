import type { ModelParams } from './types';

// ─── Data Type Sizes ──────────────────────────
// Common data type sizes in bytes — single source of truth
// Used by inference-energy, huggingface-model-fetcher, and usage-storage

export const DTYPE_SIZES: Record<string, number> = {
  fp32: 4,
  fp16: 2,
  bf16: 2,
  fp8: 1,
  fp8_e4m3: 1,
  fp8_e5m2: 1,
  nvfp4: 0.5,
  int4: 0.5,
  int8: 1,
  default: 1, // Default to FP8
};

/**
 * Resolve a normalized dtype string (key of DTYPE_SIZES) to its byte size.
 * Falls back to DTYPE_SIZES.default (1 = FP8) for unrecognized strings.
 */
export function resolveDtypeSize(dtype: string): number {
  return DTYPE_SIZES[dtype] ?? DTYPE_SIZES.default!;
}

// ─── Data Type Inference ──────────────────────────
// Unifies dtype inference from HuggingFace config (torch_dtype)
// and safetensors parameter distributions into a single canonical function.
// All returned values are keys of DTYPE_SIZES.

/** Lookup table for normalizing raw dtype strings to DTYPE_SIZES keys. */
const DTYPE_ALIASES: Record<string, string> = {
  // Config torch_dtype values (e.g. "bfloat16", "float8_e4m3fn")
  float32: 'fp32',
  float16: 'fp16',
  bfloat16: 'bf16',
  float8e4m3fn: 'fp8_e4m3',
  float8e4m3: 'fp8_e4m3',
  float8e5m2: 'fp8_e5m2',
  float8: 'fp8',
  // Safetensors parameter keys (e.g. "F16", "BF16", "F8_E4M3")
  f32: 'fp32',
  f16: 'fp16',
  bf16: 'bf16',
  f8e4m3: 'fp8_e4m3',
  f8e5m2: 'fp8_e5m2',
  f8: 'fp8',
  i32: 'int4', // int4 weights packed as int32 in safetensors
  i16: 'int8',
  i8: 'int8',
  // Already-normalized names (pass through)
  fp32: 'fp32',
  fp16: 'fp16',
  fp8: 'fp8',
  fp8e4m3: 'fp8_e4m3',
  fp8e5m2: 'fp8_e5m2',
  nvfp4: 'nvfp4',
  int4: 'int4',
  int8: 'int8',
};

/**
 * Normalize a raw dtype string to one of the DTYPE_SIZES keys.
 *
 * Handles both HuggingFace config formats (e.g. "bfloat16", "float8_e4m3fn")
 * and safetensors parameter keys (e.g. "F16", "BF16", "F8_E4M3", "I32").
 *
 * Returns null if the dtype cannot be recognized.
 */
export function normalizeDtypeName(raw: string): string | null {
  const normalized = raw.toLowerCase().replace(/[-_]/g, '');
  return DTYPE_ALIASES[normalized] ?? null;
}

/** Options for inferring a model's data type from available metadata. */
export interface InferDtypeOptions {
  /** torch_dtype from HuggingFace config.json (e.g. "bfloat16", "float16") */
  torch_dtype?: string;
  /** Safetensors parameter distribution (dtype key → param count), e.g. { F8_E4M3: 1.2e9, BF16: 3e8 } */
  safetensors?: Record<string, number>;
}

/**
 * Infer a model's data type from available HuggingFace metadata.
 *
 * Priority order:
 *  1. Config's torch_dtype (explicit declaration by model author)
 *  2. Safetensors dominant dtype (the dtype with the most parameters)
 *  3. Default: fp8
 *
 * Always returns a key of DTYPE_SIZES.
 */
export function inferDataType(options: InferDtypeOptions): string {
  const { torch_dtype, safetensors } = options;

  // 1. Config's torch_dtype — most authoritative signal
  if (torch_dtype) {
    const normalized = normalizeDtypeName(torch_dtype);
    if (normalized) return normalized;
  }

  // 2. Safetensors dominant dtype
  if (safetensors) {
    const dtype = inferDtypeFromSafetensors(safetensors);
    if (dtype) return dtype;
  }

  // 3. Default
  return 'fp8';
}

/**
 * Infer dtype from safetensors parameter distribution by finding
 * the dtype key with the most parameters.
 */
function inferDtypeFromSafetensors(params: Record<string, number>): string | null {
  const nonZero = Object.entries(params).filter(([_, count]) => count > 0);
  if (nonZero.length === 0) return null;

  // Find the dtype with the most parameters
  let dominantKey = '';
  let dominantCount = 0;
  for (const [key, count] of nonZero) {
    if (count > dominantCount) {
      dominantCount = count;
      dominantKey = key;
    }
  }

  if (!dominantKey) return null;

  // Energy estimation heuristic: F32-dominant models are treated as fp16
  // (full fp32 inference is extremely rare in production)
  const normalized = normalizeDtypeName(dominantKey);
  if (normalized === 'fp32') return 'fp16';
  if (normalized) return normalized;

  // Fallback: if any F8_E5M2 params exist, use fp8
  if ((params.F8_E5M2 ?? 0) > 0 || (params.f8_e5m2 ?? 0) > 0) return 'fp8';

  return null;
}

// ─── Type Split: Backend vs UI ───────────────────────────────
//
// ModelParams (backend): Used for energy calculations, memory estimation, etc.
//   - Contains dtype_size (number) for computations
//   - All fields are required
//
// ModelParamsWithDtype (UI): Used for display, configuration, API responses
//   - Contains dtype (string) for user-friendly display ("FP8", "BF16", etc.) because figuring out dtype from dtype_size is intractable.
//   - Also has dtype_size for when computations are needed
//   - This is the "resolved" type returned by the HuggingFace model fetcher
//
// ModelArchitecture (config): User-supplied partial configuration
//   - All fields are optional
//   - Used in config files, API requests for model overrides
//   - Resolved to ModelParamsWithDtype via resolveModelParams()
//
// ─── ModelParams ───────────────────────────────────────────
// Backend type: used for all computational logic (energy, memory, etc.)
// Contains dtype_size (numeric byte size) for calculations.

// ─── ModelParamsWithDtype ──────────────────────────────────
// UI type: ModelParams with an explicit dtype string for display.
// Used by the HuggingFace model fetcher, heuristics, and anywhere
// the dtype name needs to travel alongside the numeric params.

export interface ModelParamsWithDtype extends ModelParams {
  dtype: string; // Key of DTYPE_SIZES (e.g., 'fp8', 'bf16', 'int4')
}

// ─── ModelArchitecture ───────────────────────────────────
// User-supplied model architecture in config files and API requests.
// All fields are optional - resolved to full ModelParamsWithDtype via resolveModelParams().

export type ModelArchitecture = Partial<ModelParamsWithDtype>;

// ─── Default Model Parameters ──────────────────────────
// Fallback model architecture for energy estimation when no
// model_architecture is provided.

export const DEFAULT_MODEL: ModelParamsWithDtype = {
  total_params: 1000, // In billions
  active_params: 32, // In billions
  layers: 61,
  context_length: 256000,
  kv_lora_rank: 512,
  qk_rope_head_dim: 64,
  dtype: 'fp8',
  dtype_size: resolveDtypeSize('fp8'),
  heads: 64,
};

/**
 * Resolve fully-populated ModelParamsWithDtype from a ModelArchitecture
 * (which may have partial/optional fields) by filling in defaults
 * and looking up dtype/dtype_size.
 */
export function resolveModelParams(arch?: ModelArchitecture): ModelParamsWithDtype {
  const resolvedDtype = arch?.dtype ?? DEFAULT_MODEL.dtype;
  return {
    total_params: arch?.total_params ?? DEFAULT_MODEL.total_params,
    active_params: arch?.active_params ?? arch?.total_params ?? DEFAULT_MODEL.active_params,
    layers: arch?.layers ?? DEFAULT_MODEL.layers,
    context_length: arch?.context_length ?? DEFAULT_MODEL.context_length,
    kv_lora_rank: arch?.kv_lora_rank ?? DEFAULT_MODEL.kv_lora_rank,
    qk_rope_head_dim: arch?.qk_rope_head_dim ?? DEFAULT_MODEL.qk_rope_head_dim,
    dtype: resolvedDtype,
    dtype_size: DTYPE_SIZES[resolvedDtype] ?? DTYPE_SIZES.default!,
    heads: arch?.heads ?? DEFAULT_MODEL.heads,
  };
}

// ─── Parameter Estimation from Config ───────────────────
// Pure functions for estimating model parameters from HuggingFace config.

/** Options for estimating total parameters from config. */
export interface EstimateTotalParamsOptions {
  vocab_size?: number;
  hidden_size?: number;
  num_hidden_layers?: number;
  intermediate_size?: number;
}

/**
 * Estimate total parameters in billions from model config.
 *
 * Uses the standard transformer formula.
 *
 * Returns estimated total params in billions, rounded to 1 decimal place,
 * or undefined if required config fields are missing.
 */
export function estimateTotalParamsFromConfig(
  options: EstimateTotalParamsOptions
): number | undefined {
  const { vocab_size, hidden_size, num_hidden_layers, intermediate_size } = options;

  if (!vocab_size || !hidden_size || !num_hidden_layers || !intermediate_size) {
    return undefined;
  }

  const vocabEmbed = vocab_size * hidden_size * 4;
  const perLayer = hidden_size * (4 * hidden_size + intermediate_size + 2 * hidden_size);
  const total = (vocabEmbed + num_hidden_layers * perLayer) / 1e9;

  return Math.round(total * 10) / 10;
}

/** Options for estimating active (non-embedding) parameters. */
export interface EstimateActiveParamsOptions {
  /** Total parameters in billions (from safetensors or estimateTotalParamsFromConfig) */
  totalParams: number;
  /** Number of local experts in MoE (e.g. Mixtral has 8) */
  numLocalExperts?: number;
  /** Number of experts activated per token (e.g. Mixtral uses 2) */
  numExpertsPerTok?: number;
}

/**
 * Estimate active (non-embedding) parameters in billions.
 *
 * For MoE models: (total_params / num_local_experts) * num_experts_per_tok
 * For dense models: returns total_params
 *
 * Returns estimated active params in billions, rounded to 1 decimal place.
 */
export function estimateActiveParams(options: EstimateActiveParamsOptions): number {
  const { totalParams, numLocalExperts, numExpertsPerTok } = options;

  // MoE with explicit expert configuration
  if (totalParams && numLocalExperts && numExpertsPerTok) {
    const paramsPerExpert = totalParams / numLocalExperts;
    return Math.round(paramsPerExpert * numExpertsPerTok * 10) / 10;
  }

  // Dense model: active equals total
  return totalParams || 0.1;
}

// ─── Proprietary Model Heuristics ──────────────────────────
// Architecture estimates for proprietary models not on Hugging Face.
// Used by the HuggingFace model fetcher as a fallback when the model
// isn't available on the Hub.
//
// Each entry is a complete ModelParamsWithDtype — no conversion needed
// at lookup time. Just spread and override dtype_size if the caller
// specifies a different dtype.

export const PROPRIETARY_MODEL_HEURISTICS: Record<string, ModelParamsWithDtype> = {
  // Anthropic Claude 4 Series (Frontier Reasoning)
  // Claude 4.6 (Released Feb 2026): 1M Context + Adaptive Thinking
  'claude-4-6-opus': {
    total_params: 4500, // ~4.5T total
    active_params: 340, // 30B base * ~11x output price premium
    layers: 136,
    heads: 112,
    kv_lora_rank: 256,
    qk_rope_head_dim: 128,
    context_length: 1000000,
    dtype_size: resolveDtypeSize('fp8'),
    dtype: 'fp8',
  },
  'claude-4-6-sonnet': {
    total_params: 1400,
    active_params: 110, // 15B base * ~7x output price premium
    layers: 96,
    heads: 80,
    kv_lora_rank: 128,
    qk_rope_head_dim: 96,
    context_length: 1000000,
    dtype_size: resolveDtypeSize('fp8'),
    dtype: 'fp8',
  },
  'claude-4-6-haiku': {
    total_params: 350,
    active_params: 24, // 8B base * ~3x output price premium
    layers: 64,
    heads: 64,
    kv_lora_rank: 64,
    qk_rope_head_dim: 64,
    context_length: 200000,
    dtype_size: resolveDtypeSize('fp8'),
    dtype: 'fp8',
  },

  // Claude 4.5 (Released Nov 2025)
  'claude-4-5-opus': {
    total_params: 3800,
    active_params: 300,
    layers: 128,
    heads: 96,
    kv_lora_rank: 128,
    qk_rope_head_dim: 96,
    context_length: 200000,
    dtype_size: resolveDtypeSize('fp8'),
    dtype: 'fp8',
  },
  'claude-4-5-sonnet': {
    total_params: 1200,
    active_params: 90,
    layers: 90,
    heads: 64,
    kv_lora_rank: 128,
    qk_rope_head_dim: 64,
    context_length: 200000,
    dtype_size: resolveDtypeSize('fp8'),
    dtype: 'fp8',
  },
  'claude-4-5-haiku': {
    total_params: 250,
    active_params: 18,
    layers: 60,
    heads: 48,
    kv_lora_rank: 64,
    qk_rope_head_dim: 64,
    context_length: 200000,
    dtype_size: resolveDtypeSize('fp8'),
    dtype: 'fp8',
  },

  // Claude 4.1 / 4.0 (Mid-2025 Series)
  'claude-4-1-opus': {
    total_params: 2800,
    active_params: 250,
    layers: 120,
    heads: 96,
    kv_lora_rank: 128,
    qk_rope_head_dim: 96,
    context_length: 200000,
    dtype_size: resolveDtypeSize('fp8'),
    dtype: 'fp8',
  },
  'claude-4-sonnet': {
    total_params: 800,
    active_params: 75,
    layers: 90,
    heads: 64,
    kv_lora_rank: 128,
    qk_rope_head_dim: 64,
    context_length: 200000,
    dtype_size: resolveDtypeSize('fp8'),
    dtype: 'fp8',
  },
  'claude-4-haiku': {
    total_params: 150,
    active_params: 12,
    layers: 48,
    heads: 32,
    kv_lora_rank: 32,
    qk_rope_head_dim: 64,
    context_length: 200000,
    dtype_size: resolveDtypeSize('fp8'),
    dtype: 'fp8',
  },

  // OpenAI GPT-5 Series (Agentic & Reasoning)
  // GPT-5.4 (Released March 2026): Configurable Reasoning & 1M Context
  'gpt-5-4-pro': {
    total_params: 4000,
    active_params: 320, // High-effort reasoning activation
    layers: 144,
    heads: 128,
    kv_lora_rank: 512,
    qk_rope_head_dim: 128,
    context_length: 1048576,
    dtype_size: resolveDtypeSize('fp8'),
    dtype: 'fp8',
  },
  'gpt-5': {
    total_params: 1500,
    active_params: 100, // Standard routing for general chat
    layers: 112,
    heads: 96,
    kv_lora_rank: 256,
    qk_rope_head_dim: 128,
    context_length: 400000,
    dtype_size: resolveDtypeSize('fp8'),
    dtype: 'fp8',
  },

  // GPT-5 Codex (Agentic Coding Specialists)
  'gpt-5-codex-max': {
    total_params: 3200,
    active_params: 280, // Heavy attention activation for massive codebases
    layers: 128,
    heads: 128,
    kv_lora_rank: 512,
    qk_rope_head_dim: 128,
    context_length: 400000,
    dtype_size: resolveDtypeSize('fp8'),
    dtype: 'fp8',
  },
  'gpt-5-codex-mini': {
    total_params: 300,
    active_params: 20, // Mini/Haiku scale for autocomplete tasks
    layers: 64,
    heads: 48,
    kv_lora_rank: 64,
    qk_rope_head_dim: 48,
    context_length: 128000,
    dtype_size: resolveDtypeSize('fp8'),
    dtype: 'fp8',
  },

  // Legacy GPT-4 Series
  'gpt-4o': {
    total_params: 1760,
    active_params: 110, // Likely 2 experts out of 16 active
    layers: 120,
    heads: 96,
    kv_lora_rank: 128,
    qk_rope_head_dim: 96,
    context_length: 128000,
    dtype_size: resolveDtypeSize('fp8'),
    dtype: 'fp8',
  },
};
