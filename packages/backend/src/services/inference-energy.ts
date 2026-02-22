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

/**
 * Calculates the estimated inference energy footprint for a given number of
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
  const dtypeSize = modelParams.dtype_size ?? 1;
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
  const tp = 2 ** Math.ceil(Math.log2(tpFloor));

  // 3. Concurrency (U_max)
  const totalUsableRam = tp * gpuRamTotal;
  const uMax = Math.floor((totalUsableRam - weightSize) / kvCachePerUser);

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
  const kwhPerToast = 0.02; // ~20Wh to toast 2 slices
  return Math.round((kwh / kwhPerToast) * 100) / 100;
}

// ----------------------------------------------------
// Hardcoded hardware profile (DeepSeek R1 / H100-class cluster)
// These constants intentionally remain fixed; swap them out when a better
// profiling approach is in place.
// --------------------------------------------

const DEFAULT_MODEL: ModelParams = {
  total_params: 1000,
  active_params: 32,
  layers: 61,
  context_length: 256000,
  kv_lora_rank: 512,
  qk_rope_head_dim: 64,
  dtype_size: 1,
  heads: 64,
};

const DEFAULT_GPU: GpuParams = {
  ram_gb: 192,
  bandwidth_tb_s: 8.0,
  flops_tflop: 9000,
  power_draw_watts: 14300,
};

/**
 * Convenience wrapper: estimates wall-power kWh for a single request given
 * input and output token counts. Returns 0 for invalid/zero inputs.
 */
export function estimateKwhUsed(inputTokens: number, outputTokens: number): number {
  if (inputTokens <= 0 && outputTokens <= 0) return 0;
  const footprint = calculateInferenceFootprint(
    DEFAULT_MODEL,
    DEFAULT_GPU,
    Math.max(0, inputTokens),
    Math.max(0, outputTokens)
  );
  return footprint.energy_kwh_wall;
}
