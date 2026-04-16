import type { GpuParams, GpuProfileOption, ModelArchitecture } from './types';
import { DTYPE_SIZES, DEFAULT_MODEL } from './model-params';

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

/**
 * Resolve fully-populated ModelParams from a ModelArchitecture
 * (which may have partial/optional fields) by filling in defaults
 * and looking up dtype_size.
 *
 * Re-exported from model-params.ts for backward compatibility.
 */
export { DEFAULT_MODEL, resolveModelParams } from './model-params';

/**
 * Re-export dtype utilities from model-params.ts for backward compatibility.
 */
export { DTYPE_SIZES, resolveDtypeSize, normalizeDtypeName, inferDataType } from './model-params';

export type { InferDtypeOptions } from './model-params';
