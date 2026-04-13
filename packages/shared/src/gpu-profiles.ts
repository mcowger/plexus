import type { GpuParams, GpuProfileOption, ModelParams, ModelArchitecture } from './types';

// ─── GPU Presets ──────────────────────────
// GPU specifications based on official NVIDIA specs
// RAM in GB, bandwidth in TB/s, FLOPS in TFLOPs (FP8), power in watts
// All values are per-individual-GPU; the energy calculator scales by TP.

export const GPU_PRESETS: Record<string, GpuParams> = {
  // H100 (80GB HBM3)
  H100: {
    ram_gb: 80,
    bandwidth_tb_s: 3.35,
    flops_tflop: 1979, // FP8 Dense
    power_draw_watts: 700,
  },
  // H200 (141GB HBM3e)
  H200: {
    ram_gb: 141,
    bandwidth_tb_s: 4.8,
    flops_tflop: 1979, // Same core as H100
    power_draw_watts: 700,
  },
  // GH200 (Grace Hopper Superchip - 144GB HBM3e)
  GH200: {
    ram_gb: 144, // GPU-side HBM
    bandwidth_tb_s: 4.8, // HBM3e peak
    flops_tflop: 1979,
    power_draw_watts: 1000, // Total Superchip TDP
  },
  // B200 (Blackwell GPU - 192GB HBM3e)
  B200: {
    ram_gb: 192,
    bandwidth_tb_s: 8.0,
    flops_tflop: 4500, // FP8 Dense (9000 Sparse)
    power_draw_watts: 1000,
  },
  // B300 (Blackwell Ultra - 288GB HBM3e)
  B300: {
    ram_gb: 288,
    bandwidth_tb_s: 8.0, // Standard B300 Ultra; 12.0 for experimental
    flops_tflop: 7000, // FP8 Dense (approx 14k-15k Sparse)
    power_draw_watts: 1400,
  },
};

// Valid GPU profile names (keys of GPU_PRESETS)
export type GpuProfileName = keyof typeof GPU_PRESETS;

// GPU profile values (GPU_PRESETS keys + 'custom') for Zod enums and validation
export const VALID_GPU_PROFILES = [...(Object.keys(GPU_PRESETS) as string[]), 'custom'] as const;
export type GpuProfileType = (typeof VALID_GPU_PROFILES)[number];

// Pre-built GPU profile options derived from GPU_PRESETS (single source of truth)
export const GPU_PROFILE_OPTIONS: GpuProfileOption[] = [
  ...Object.entries(GPU_PRESETS).map(([key, params]) => ({
    value: key,
    label: `NVIDIA ${key} (${params.ram_gb}GB)`,
    ...params,
  })),
  { value: 'custom', label: 'Custom' },
];

/** Default GPU parameters (H100) — used as fallback when no GPU profile is configured. */
export const DEFAULT_GPU_PARAMS: GpuParams = { ...GPU_PRESETS.H100! };

/**
 * Resolve a GPU profile name (and optional overrides) into concrete GpuParams.
 * Returns H100 defaults if the profile name is unknown or omitted.
 */
export function resolveGpuParams(profile?: string, overrides?: Partial<GpuParams>): GpuParams {
  const base =
    profile && profile in GPU_PRESETS ? GPU_PRESETS[profile as GpuProfileName]! : GPU_PRESETS.H100!;
  return {
    ram_gb: overrides?.ram_gb ?? base.ram_gb,
    bandwidth_tb_s: overrides?.bandwidth_tb_s ?? base.bandwidth_tb_s,
    flops_tflop: overrides?.flops_tflop ?? base.flops_tflop,
    power_draw_watts: overrides?.power_draw_watts ?? base.power_draw_watts,
  };
}

// ─── Default Model Parameters ──────────────────────────
// Fallback model architecture for energy estimation when no
// model_architecture is provided.

export const DEFAULT_MODEL: ModelParams = {
  total_params: 1000, // In billions
  active_params: 32, // In billions
  layers: 61,
  context_length: 256000,
  kv_lora_rank: 512,
  qk_rope_head_dim: 64,
  dtype_size: 1, // FP8 = 1 byte
  heads: 64,
};

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
 * Resolve fully-populated ModelParams from a ModelArchitecture
 * (which may have partial/optional fields) by filling in defaults
 * and looking up dtype_size.
 */
export function resolveModelParams(arch?: ModelArchitecture): ModelParams {
  return {
    total_params: arch?.total_params ?? DEFAULT_MODEL.total_params,
    active_params: arch?.active_params ?? arch?.total_params ?? DEFAULT_MODEL.active_params,
    layers: arch?.layers ?? DEFAULT_MODEL.layers,
    context_length: arch?.context_length ?? DEFAULT_MODEL.context_length,
    kv_lora_rank: arch?.kv_lora_rank ?? DEFAULT_MODEL.kv_lora_rank,
    qk_rope_head_dim: arch?.qk_rope_head_dim ?? DEFAULT_MODEL.qk_rope_head_dim,
    dtype_size: DTYPE_SIZES[arch?.dtype ?? 'default'] ?? DTYPE_SIZES.default!,
    heads: arch?.heads ?? DEFAULT_MODEL.heads,
  };
}
