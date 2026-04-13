/**
 * Inference Energy Estimator
 *
 * Pure calculation module — takes fully-populated ModelParams and GpuParams,
 * returns energy metrics. No defaults, no resolution, no merging.
 * The caller is responsible for populating all fields before calling.
 */

import type { GpuParams, ModelParams, InferenceFootprint } from '@plexus/shared';

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
  const dtypeSize = modelParams.dtype_size ?? 1; // Default to FP8 (1 byte)
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
  // Total cluster power = per-GPU power × number of GPUs
  const systemWatts = gpuParams.power_draw_watts * tp;
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
 * Convenience wrapper: estimates wall-power kWh for a single request.
 * Returns 0 for invalid/zero inputs.
 *
 * Callers must provide fully-populated ModelParams and GpuParams.
 * Use DEFAULT_MODEL and DEFAULT_GPU_PARAMS from @plexus/shared to
 * fill in defaults before calling.
 */
export function estimateKwhUsed(
  inputTokens: number,
  outputTokens: number,
  modelParams: ModelParams,
  gpuParams: GpuParams
): number {
  if (inputTokens <= 0 && outputTokens <= 0) return 0;

  const footprint = calculateInferenceFootprint(
    modelParams,
    gpuParams,
    Math.max(0, inputTokens),
    Math.max(0, outputTokens)
  );
  return footprint.energy_kwh_wall;
}

/**
 * Get the full inference footprint with detailed metrics.
 * Returns null for invalid/zero inputs.
 *
 * Callers must provide fully-populated ModelParams and GpuParams.
 */
export function getInferenceFootprint(
  inputTokens: number,
  outputTokens: number,
  modelParams: ModelParams,
  gpuParams: GpuParams
): InferenceFootprint | null {
  if (inputTokens <= 0 && outputTokens <= 0) return null;

  return calculateInferenceFootprint(
    modelParams,
    gpuParams,
    Math.max(0, inputTokens),
    Math.max(0, outputTokens)
  );
}
