/**
 * Inference Energy Estimator
 *
 * Estimates the GPU cluster energy consumed for an LLM inference request
 * based on input/output token counts, model architecture parameters, and
 * GPU hardware specifications.
 *
 * The calculation models tensor parallelism, KV cache memory, prefill/decode
 * throughput, and applies a PUE-equivalent wall-power multiplier of 1.4x.
 */

export interface ModelParams {
  total_params: number;
  active_params: number;
  layers: number;
  context_length: number;
  kv_lora_rank: number;
  qk_rope_head_dim: number;
  dtype_size?: number;
  heads: number;
}

export interface GpuParams {
  ram_gb: number;
  bandwidth_tb_s: number;
  flops_tflop: number;
  power_draw_watts: number;
}

export interface InferenceFootprint {
  tensor_parallelism: number;
  concurrent_users_limit: number;
  prefill_tps: number;
  decode_tps: number;
  cluster_seconds_used: number;
  energy_kwh_wall: number;
  system_power_kw: number;
}

// ─── GPU Presets ──────────────────────────
// GPU specifications based on official NVIDIA specs
// RAM in GB, bandwidth in TB/s, FLOPS in TFLOPs (FP8), power in watts

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

// Valid GPU profile names
export type GpuProfileName = keyof typeof GPU_PRESETS;

/**
 * Get GPU parameters from a preset name or custom parameters
 */
export function getGpuParams(
  profile?: string | GpuParams,
  customParams?: Partial<GpuParams>
): GpuParams {
  // Get base preset
  let baseGpu: GpuParams = GPU_PRESETS.H100!;

  // If it's a predefined profile name (must be a string)
  if (profile && typeof profile === 'string' && profile in GPU_PRESETS) {
    baseGpu = GPU_PRESETS[profile as GpuProfileName]!;
  } else if (profile && typeof profile === 'object') {
    // If it's already a full GpuParams object, use it as base
    baseGpu = profile as GpuParams;
  } else {
    // Default fallback (H100)
    baseGpu = GPU_PRESETS.H100!;
  }

  // Merge with custom params, using nullish coalescing to keep base values when custom is undefined
  return {
    ram_gb: customParams?.ram_gb ?? baseGpu.ram_gb,
    bandwidth_tb_s: customParams?.bandwidth_tb_s ?? baseGpu.bandwidth_tb_s,
    flops_tflop: customParams?.flops_tflop ?? baseGpu.flops_tflop,
    power_draw_watts: customParams?.power_draw_watts ?? baseGpu.power_draw_watts,
  };
}

/**
 * Returns available GPU preset options for UI dropdowns
 */
export function getGpuPresetOptions(): Array<{ value: string; label: string }> {
  return [
    { value: 'H100', label: 'NVIDIA H100 (80GB)' },
    { value: 'H200', label: 'NVIDIA H200 (141GB)' },
    { value: 'GH200', label: 'NVIDIA GH200 (144GB)' },
    { value: 'B200', label: 'NVIDIA B200 (192GB)' },
    { value: 'B300', label: 'NVIDIA B300 (288GB)' },
    { value: 'custom', label: 'Custom' },
  ];
}

// ----------------------------------------------------
// Default fallback profiles (DeepSeek R1 / H100-class cluster)
// These constants are used when no specific profile is provided
// --------------------------------------------

const DEFAULT_MODEL: ModelParams = {
  total_params: 1000, // In billions
  active_params: 32, // In billions
  layers: 61,
  context_length: 256000,
  kv_lora_rank: 512,
  qk_rope_head_dim: 64,
  dtype_size: 2, // FP16 = 2 bytes
  heads: 64,
};

const DEFAULT_GPU: GpuParams = {
  ram_gb: 192,
  bandwidth_tb_s: 8.0,
  flops_tflop: 9000,
  power_draw_watts: 14300,
};

/**
 * Calculates the estimated inference energy footprint for a number of
 * input and output tokens using a specific model and GPU hardware profile.
 */
export function calculateInferenceFootprint(
  modelParams: ModelParams,
  gpuParams: GpuParams,
  inputTokens: number,
  outputTokens: number
): InferenceFootprint {
  // Units
  const GB = 1_000_000_000;
  const GiB = 1024 ** 3;
  const TB = 1_000 * GB;
  const TFLOP = 1_000_000_000_000;
  // 1. Model Specifics
  const dtypeSize = modelParams.dtype_size ?? 2; // Default to FP16 (2 bytes)
  const weightSize = modelParams.total_params * GB * dtypeSize;
  const activeSize = modelParams.active_params * GB * dtypeSize;

  const kvCachePerUser =
    modelParams.layers *
    modelParams.context_length *
    (modelParams.kv_lora_rank + modelParams.heads * modelParams.qk_rope_head_dim) *
    dtypeSize;

  // 2. Hardware Topology (TP Calculation)
  const gpuRamTotal = gpuParams.ram_gb * GiB;
  const tpFloor = weightSize / gpuRamTotal;
  const tp = 2 ** Math.ceil(Math.log2(Math.max(1, tpFloor)));

  // 3. Concurrency (U_max)
  const totalUsableRam = tp * gpuRamTotal;
  const uMax = Math.max(1, Math.floor((totalUsableRam - weightSize) / kvCachePerUser));

  // 4. Throughput (TPS)
  const totalClusterFlops = gpuParams.flops_tflop * TFLOP * tp;
  const flopsPerToken = 2 * activeSize;
  const prefillTps = totalClusterFlops / flopsPerToken;

  const clusterBandwidth = gpuParams.bandwidth_tb_s * TB * tp;
  const passesPerSecond = clusterBandwidth / activeSize;
  const decodeTps = passesPerSecond * uMax;

  // 5. Workload Execution
  const clusterSeconds = inputTokens / prefillTps + outputTokens / decodeTps;

  // 6. Energy & Power
  // Scale power draw based on actual TP used (more GPUs = more power)
  const systemWatts = gpuParams.power_draw_watts * (tp / 8);
  const energyJoules = systemWatts * clusterSeconds;
  const energyKwhCluster = energyJoules / 3_600_000;
  // 1.4x wall-power multiplier (accounts for cooling / PUE overhead)
  const energyKwhWall = energyKwhCluster * 1.4;

  return {
    tensor_parallelism: tp,
    concurrent_users_limit: uMax,
    prefill_tps: Math.round(prefillTps * 100) / 100,
    decode_tps: Math.round(decodeTps * 100) / 100,
    cluster_seconds_used: Math.round(clusterSeconds * 100) / 100,
    energy_kwh_wall: Math.round(energyKwhWall * 10000) / 10000,
    system_power_kw: systemWatts / 1000,
  };
}

/**
 * Returns the number of toast-bread slices (2-slice toaster cycle ≈ 20 Wh)
 * equivalent to the given energy in kWh.
 */
export function toastBreadEquivalent(kwh: number): number {
  const kwhPerSlice = 0.01; // ~20Wh to toast 2 slices => 10Wh per slice
  return Math.round((kwh / kwhPerSlice) * 100) / 100;
}

/**
 * Options for estimateKwhUsed
 */
export interface EstimateKwhOptions {
  /** Model architecture parameters - merges with defaults */
  model?: Partial<ModelParams>;
  /** GPU profile name (preset) or full GPU parameters */
  gpu?: string | GpuParams;
  /** Custom GPU overrides when using a preset */
  gpuOverrides?: Partial<GpuParams>;
}

/**
 * Convenience wrapper: estimates wall-power kWh for a single request given
 * input and output token counts. Returns 0 for invalid/zero inputs.
 *
 * @param inputTokens - Number of input tokens
 * @param outputTokens - Number of output tokens
 * @param options - Optional model and GPU configuration
 */
export function estimateKwhUsed(
  inputTokens: number,
  outputTokens: number,
  options?: EstimateKwhOptions
): number {
  if (inputTokens <= 0 && outputTokens <= 0) return 0;

  // Merge model params with defaults
  const modelParams: ModelParams = {
    ...DEFAULT_MODEL,
    ...options?.model,
  };

  // Get GPU params from preset or custom
  const gpuParams = getGpuParams(options?.gpu, options?.gpuOverrides);

  const footprint = calculateInferenceFootprint(
    modelParams,
    gpuParams,
    Math.max(0, inputTokens),
    Math.max(0, outputTokens)
  );
  return footprint.energy_kwh_wall;
}

/**
 * Get the full inference footprint with detailed metrics
 */
export function getInferenceFootprint(
  inputTokens: number,
  outputTokens: number,
  options?: EstimateKwhOptions
): InferenceFootprint | null {
  if (inputTokens <= 0 && outputTokens <= 0) return null;

  const modelParams: ModelParams = {
    ...DEFAULT_MODEL,
    ...options?.model,
  };

  const gpuParams = getGpuParams(options?.gpu, options?.gpuOverrides);

  return calculateInferenceFootprint(
    modelParams,
    gpuParams,
    Math.max(0, inputTokens),
    Math.max(0, outputTokens)
  );
}
