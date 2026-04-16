/**
 * GPU hardware specification parameters.
 * Each preset defines per-GPU specs — the energy calculator scales
 * by tensor parallelism (number of GPUs) at calculation time.
 */
export interface GpuParams {
  ram_gb: number;
  bandwidth_tb_s: number;
  flops_tflop: number;
  power_draw_watts: number;
}

/**
 * Model architecture parameters for inference energy estimation.
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

/**
 * Inference footprint result — detailed metrics from energy calculation.
 */
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
 * GPU profile option for UI dropdowns and API responses.
 * Preset profiles include hardware specs; 'custom' does not.
 */
export interface GpuProfileOption {
  value: string;
  label: string;
  ram_gb?: number;
  bandwidth_tb_s?: number;
  flops_tflop?: number;
  power_draw_watts?: number;
}
