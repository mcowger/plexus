// Types
export type {
  GpuParams,
  ModelParams,
  InferenceFootprint,
  GpuProfileOption,
} from './types';

// ModelArchitecture is exported from model-params.ts

// GPU presets, profile options, and GPU resolution
export {
  GPU_PRESETS,
  VALID_GPU_PROFILES,
  GPU_PROFILE_OPTIONS,
  DEFAULT_GPU_PARAMS,
  resolveGpuParams,
} from './gpu-profiles';

export type { GpuProfileName, GpuProfileType } from './gpu-profiles';

// Model params, dtype utilities, heuristics, and resolution helpers
export {
  DTYPE_SIZES,
  resolveDtypeSize,
  normalizeDtypeName,
  inferDataType,
  DEFAULT_MODEL,
  resolveModelParams,
  PROPRIETARY_MODEL_HEURISTICS,
  estimateTotalParamsFromConfig,
  estimateActiveParams,
} from './model-params';

export type {
  InferDtypeOptions,
  EstimateTotalParamsOptions,
  EstimateActiveParamsOptions,
  ModelParamsWithDtype,
  ModelArchitecture,
} from './model-params';
