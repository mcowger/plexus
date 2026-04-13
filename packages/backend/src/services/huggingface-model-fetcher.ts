/**
 * HuggingFace Model Fetcher
 *
 * Fetches model architecture configuration from Hugging Face model repositories
 * and provides heuristics for proprietary models that aren't on Hugging Face.
 *
 * Used by the inference energy calculator to get accurate model parameters
 * (layers, heads, hidden_size, context_length, etc.) for energy estimation.
 */

import { logger } from '../utils/logger';
import type { ModelParams } from '@plexus/shared';
import { DTYPE_SIZES } from '@plexus/shared';

// DTYPE_SIZES is imported from @plexus/shared (single source of truth)

// ─── HuggingFace API Response Types ──────────────────────────

interface HuggingFaceConfig {
  // General model info
  model_type?: string;
  architectures?: string[];

  // Architecture parameters
  hidden_size?: number;
  num_hidden_layers?: number;
  num_attention_heads?: number;
  num_key_value_heads?: number; // For GQA/MQA
  intermediate_size?: number;

  // Context length
  max_position_embeddings?: number;
  max_sequence_length?: number;
  ctx_length?: number;

  // KV cache / RoPE parameters
  kv_lora_rank?: number;
  qk_lora_rank?: number;
  rope_theta?: number;
  rope_scaling?: {
    type?: string;
    factor?: number;
    original_max_position_embeddings?: number;
  };

  // Attention
  attention_bias?: boolean;
  attention_dropout?: number;

  // Vocab
  vocab_size?: number;

  // Other
  torch_dtype?: string;
  transformers_version?: string;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

interface HuggingFaceApiResponse {
  id: string;
  modelId: string;
  safetensors?: {
    parameters: {
      F32?: number;
      F16?: number;
      BF16?: number;
      F8_E4M3?: number;
      F8_E5M2?: number;
      I32?: number; // int4 stored as int32
      I16?: number;
      I8?: number;
      [key: string]: number | undefined;
    };
    total: number;
  };
  config?: HuggingFaceConfig;
}

// ─── Proprietary Model Heuristics ──────────────────────────
// Heuristics for estimating architecture of proprietary models not on Hugging Face

interface ModelFamilyHeuristic {
  // Architecture estimation
  total_params: number; // In billions
  active_params: number; // In billions (for MoE)
  layers: number;
  heads: number;
  kv_lora_rank: number;
  qk_rope_head_dim: number;
  context_length: number;
  // Assumed dtype for energy calc
  default_dtype: string;
}

const PROPRIETARY_MODEL_HEURISTICS: Record<string, ModelFamilyHeuristic> = {
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
    default_dtype: 'fp8',
  },
  'claude-4-6-sonnet': {
    total_params: 1400,
    active_params: 110, // 15B base * ~7x output price premium
    layers: 96,
    heads: 80,
    kv_lora_rank: 128,
    qk_rope_head_dim: 96,
    context_length: 1000000,
    default_dtype: 'fp8',
  },
  'claude-4-6-haiku': {
    total_params: 350,
    active_params: 24, // 8B base * ~3x output price premium
    layers: 64,
    heads: 64,
    kv_lora_rank: 64,
    qk_rope_head_dim: 64,
    context_length: 200000,
    default_dtype: 'fp8',
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
    default_dtype: 'fp8',
  },
  'claude-4-5-sonnet': {
    total_params: 1200,
    active_params: 90,
    layers: 90,
    heads: 64,
    kv_lora_rank: 128,
    qk_rope_head_dim: 64,
    context_length: 200000,
    default_dtype: 'fp8',
  },
  'claude-4-5-haiku': {
    total_params: 250,
    active_params: 18,
    layers: 60,
    heads: 48,
    kv_lora_rank: 64,
    qk_rope_head_dim: 64,
    context_length: 200000,
    default_dtype: 'fp8',
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
    default_dtype: 'fp8',
  },
  'claude-4-sonnet': {
    total_params: 800,
    active_params: 75,
    layers: 90,
    heads: 64,
    kv_lora_rank: 128,
    qk_rope_head_dim: 64,
    context_length: 200000,
    default_dtype: 'fp8',
  },
  'claude-4-haiku': {
    total_params: 150,
    active_params: 12,
    layers: 48,
    heads: 32,
    kv_lora_rank: 32,
    qk_rope_head_dim: 64,
    context_length: 200000,
    default_dtype: 'fp8',
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
    default_dtype: 'fp8',
  },
  'gpt-5': {
    total_params: 1500,
    active_params: 100, // Standard routing for general chat
    layers: 112,
    heads: 96,
    kv_lora_rank: 256,
    qk_rope_head_dim: 128,
    context_length: 400000,
    default_dtype: 'fp8',
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
    default_dtype: 'fp8',
  },
  'gpt-5-codex-mini': {
    total_params: 300,
    active_params: 20, // Mini/Haiku scale for autocomplete tasks
    layers: 64,
    heads: 48,
    kv_lora_rank: 64,
    qk_rope_head_dim: 48,
    context_length: 128000,
    default_dtype: 'fp8',
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
    default_dtype: 'fp8',
  },
};

// ─── Default Fallback ──────────────────────────

const DEFAULT_MODEL_PARAMS: ModelParams = {
  total_params: 1000, // Represented as billions
  active_params: 32, // Represented as billions
  layers: 61,
  context_length: 256000,
  kv_lora_rank: 512,
  qk_rope_head_dim: 64,
  dtype_size: 2, // FP16 = 2 bytes
  heads: 64,
};

// ─── Fetcher Implementation ──────────────────────────

export class HuggingFaceModelFetcher {
  private static instance: HuggingFaceModelFetcher;
  private cache: Map<string, ModelParams> = new Map();
  private dtypeCache: Map<string, string> = new Map();

  private constructor() {}

  public static getInstance(): HuggingFaceModelFetcher {
    if (!HuggingFaceModelFetcher.instance) {
      HuggingFaceModelFetcher.instance = new HuggingFaceModelFetcher();
    }
    return HuggingFaceModelFetcher.instance;
  }

  /**
   * Reset the singleton (used in tests)
   */
  public static resetForTesting(): void {
    HuggingFaceModelFetcher.instance = new HuggingFaceModelFetcher();
  }

  /**
   * Try to fetch model architecture from Hugging Face,
   * fall back to heuristics, then fall back to defaults.
   */
  public async getModelParams(
    modelId: string,
    dtype?: string
  ): Promise<{
    params: ModelParams;
    source: 'huggingface' | 'heuristic' | 'default';
    dtype: string;
  }> {
    // Normalize model ID (remove org prefix if present for heuristic matching)
    const normalizedId = modelId
      .toLowerCase()
      .replace(/^models:\/\//, '')
      .replace(/^hf_/, '');
    const baseModelId = normalizedId.split('/').pop() || normalizedId;

    // Check cache first
    const cacheKey = `${modelId}:${dtype || 'default'}`;
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return { params: cached, source: 'huggingface', dtype: dtype || 'fp16' };
    }

    // Try Hugging Face first
    const hfResult = await this.fetchFromHuggingFace(modelId);
    if (hfResult) {
      const finalDtype = dtype || hfResult.dtype;
      const params: ModelParams = {
        total_params: hfResult.params.total_params ?? DEFAULT_MODEL_PARAMS.total_params,
        active_params: hfResult.params.active_params ?? DEFAULT_MODEL_PARAMS.active_params,
        layers: hfResult.params.layers ?? DEFAULT_MODEL_PARAMS.layers,
        heads: hfResult.params.heads ?? DEFAULT_MODEL_PARAMS.heads,
        kv_lora_rank: hfResult.params.kv_lora_rank ?? DEFAULT_MODEL_PARAMS.kv_lora_rank,
        qk_rope_head_dim: hfResult.params.qk_rope_head_dim ?? DEFAULT_MODEL_PARAMS.qk_rope_head_dim,
        context_length: hfResult.params.context_length ?? DEFAULT_MODEL_PARAMS.context_length,
        dtype_size: DTYPE_SIZES[finalDtype] || DTYPE_SIZES.default,
      };
      this.cache.set(cacheKey, params);
      return { params, source: 'huggingface', dtype: finalDtype };
    }

    // Fall back to heuristics for proprietary models
    const heuristicResult = this.getHeuristicParams(baseModelId);
    if (heuristicResult) {
      const finalDtype = dtype || heuristicResult.dtype;
      const params: ModelParams = {
        total_params: heuristicResult.params.total_params ?? DEFAULT_MODEL_PARAMS.total_params,
        active_params: heuristicResult.params.active_params ?? DEFAULT_MODEL_PARAMS.active_params,
        layers: heuristicResult.params.layers ?? DEFAULT_MODEL_PARAMS.layers,
        heads: heuristicResult.params.heads ?? DEFAULT_MODEL_PARAMS.heads,
        kv_lora_rank: heuristicResult.params.kv_lora_rank ?? DEFAULT_MODEL_PARAMS.kv_lora_rank,
        qk_rope_head_dim:
          heuristicResult.params.qk_rope_head_dim ?? DEFAULT_MODEL_PARAMS.qk_rope_head_dim,
        context_length:
          heuristicResult.params.context_length ?? DEFAULT_MODEL_PARAMS.context_length,
        dtype_size: DTYPE_SIZES[finalDtype] || DTYPE_SIZES.default,
      };
      this.cache.set(cacheKey, params);
      return { params, source: 'heuristic', dtype: finalDtype };
    }

    // Fall back to defaults
    const finalDtype = dtype || 'fp16';
    const params: ModelParams = {
      ...DEFAULT_MODEL_PARAMS,
      dtype_size: DTYPE_SIZES[finalDtype] || DTYPE_SIZES.default,
    };
    this.cache.set(cacheKey, params);
    return { params, source: 'default', dtype: finalDtype };
  }

  /**
   * Fetch model config from Hugging Face
   */
  private async fetchFromHuggingFace(
    modelId: string
  ): Promise<{ params: Partial<ModelParams>; dtype: string } | null> {
    // Normalize model ID for URL
    const normalizedModelId = modelId.replace(/^models:\/\//, '').replace(/^hf_/, '');

    try {
      // First, fetch the HF API endpoint to get safetensors parameter info
      const apiUrl = `https://huggingface.co/api/models/${normalizedModelId}`;
      logger.debug(`[HuggingFaceModelFetcher] Fetching API data from ${apiUrl}`);

      const apiResponse = await fetch(apiUrl, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
      });

      let totalParams: number | undefined;
      let inferredDtype: string | undefined;

      if (apiResponse.ok) {
        const apiData: HuggingFaceApiResponse = await apiResponse.json();

        // Use safetensors info to get total params
        // safetensors.parameters contains the actual parameter counts (not bytes)
        if (apiData.safetensors?.parameters) {
          const params = apiData.safetensors.parameters;

          // Sum all dtype parameter counts to get total params
          const fp8Params = params.F8_E4M3 || 0;
          const i32Params = params.I32 || 0; // int4 stored as int32
          const bf16Params = params.BF16 || 0;
          const fp32Params = params.F32 || 0;
          const fp16Params = params.F16 || 0;
          const f8E5m2Params = params.F8_E5M2 || 0;

          const totalFromSafetensors =
            fp8Params + i32Params + bf16Params + fp32Params + fp16Params + f8E5m2Params;

          if (totalFromSafetensors > 0) {
            totalParams = Math.round((totalFromSafetensors / 1e9) * 10) / 10;

            // Determine dominant dtype
            if (
              i32Params > fp8Params &&
              i32Params > bf16Params &&
              i32Params > fp32Params &&
              i32Params > fp16Params &&
              i32Params > f8E5m2Params
            ) {
              inferredDtype = 'int4';
            } else if (
              fp8Params > bf16Params &&
              fp8Params > fp32Params &&
              fp8Params > fp16Params &&
              fp8Params > f8E5m2Params
            ) {
              inferredDtype = 'fp8';
            } else if (bf16Params > fp32Params && bf16Params > fp16Params) {
              inferredDtype = 'bf16';
            } else if (fp16Params > fp32Params) {
              inferredDtype = 'fp16';
            } else if (fp32Params > 0) {
              inferredDtype = 'fp16'; // Use fp16 for energy calc (fp32 is rare)
            } else if (f8E5m2Params > 0) {
              inferredDtype = 'fp8';
            }
          }
        }
      }

      // Then fetch the config.json for architecture details
      const configUrl = `https://huggingface.co/${normalizedModelId}/resolve/main/config.json`;
      logger.debug(`[HuggingFaceModelFetcher] Fetching config from ${configUrl}`);

      const configResponse = await fetch(configUrl, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
      });

      if (!configResponse.ok) {
        logger.debug(`[HuggingFaceModelFetcher] Config not found: ${configResponse.status}`);
        // If we have safetensors data but no config, still return what we have
        if (totalParams) {
          return {
            params: { total_params: totalParams, active_params: totalParams },
            dtype: inferredDtype || 'fp8',
          };
        }
        return null;
      }

      const config: HuggingFaceConfig = await configResponse.json();
      const parsedParams = this.parseConfig(config, totalParams);
      const dtype = inferredDtype || this.inferDtype(config);

      logger.info(`[HuggingFaceModelFetcher] Successfully fetched config for ${modelId}`);
      return { params: parsedParams, dtype };
    } catch (error) {
      logger.debug(`[HuggingFaceModelFetcher] Error fetching config: ${error}`);
      return null;
    }
  }

  /**
   * Parse HuggingFace config into ModelParams
   */
  private parseConfig(
    config: HuggingFaceConfig,
    safetensorsTotalParams?: number
  ): Partial<ModelParams> {
    const params: Partial<ModelParams> = {};

    // Layers
    if (config.num_hidden_layers) {
      params.layers = config.num_hidden_layers;
    }

    // Heads
    if (config.num_attention_heads) {
      params.heads = config.num_attention_heads;
    }

    // KV heads (for GQA/MQA)
    const kvHeads = config.num_key_value_heads || config.num_attention_heads;

    // Calculate hidden size per head for qk_rope_head_dim
    if (config.hidden_size && config.num_attention_heads) {
      const dimPerHead = config.hidden_size / config.num_attention_heads;
      params.qk_rope_head_dim = Math.floor(dimPerHead);
    }

    // Context length - try multiple fields
    params.context_length =
      config.max_position_embeddings || config.max_sequence_length || config.ctx_length || 4096; // Default

    // RoPE scaling can extend context length
    if (config.rope_scaling?.factor && config.rope_scaling?.original_max_position_embeddings) {
      params.context_length = Math.max(
        params.context_length,
        config.rope_scaling.original_max_position_embeddings * config.rope_scaling.factor
      );
    }

    // KV cache rank (specific to some architectures like Mixtral)
    if (config.kv_lora_rank) {
      params.kv_lora_rank = config.kv_lora_rank;
    }

    // Use safetensors total params if available (more accurate), otherwise estimate from config
    if (safetensorsTotalParams) {
      params.total_params = safetensorsTotalParams;
    } else if (
      config.vocab_size &&
      config.hidden_size &&
      config.num_hidden_layers &&
      config.intermediate_size
    ) {
      // Fallback: estimate from vocab and hidden size
      // Formula: vocab_size * hidden_size * 4 (embed + output) + layers * hidden_size * (4*hidden_size + intermediate_size)
      const vocabEmbed = config.vocab_size * config.hidden_size * 4;
      const perLayer =
        config.hidden_size *
        (4 * config.hidden_size + config.intermediate_size + 2 * config.hidden_size);
      const total = (vocabEmbed + config.num_hidden_layers * perLayer) / 1e9; // Convert to billions
      params.total_params = Math.round(total * 10) / 10; // Round to 1 decimal
    }

    // Calculate active params based on MoE configuration
    // Check for expert config in both top-level and nested (some models like Kimi have it in text_config)
    const textConfig = config.text_config || {};
    const numLocalExperts =
      config.num_local_experts ||
      config.n_routed_experts ||
      textConfig.num_local_experts ||
      textConfig.n_routed_experts;
    const numExpertsPerTok = config.num_experts_per_tok || textConfig.num_experts_per_tok;

    if (params.total_params && numLocalExperts && numExpertsPerTok) {
      // MoE: active_params = (total_params / num_local_experts) * num_experts_per_tok
      const paramsPerExpert = params.total_params / numLocalExperts;
      params.active_params = Math.round(paramsPerExpert * numExpertsPerTok * 10) / 10;
    } else if (config.model_type?.includes('mixtral') || config.model_type?.includes('moe')) {
      // MoE models without explicit expert config: assume ~5-15% active params
      params.active_params = Math.round(params.total_params! * 0.1 * 10) / 10;
    } else {
      // Dense model: all params are active
      params.active_params = params.total_params || 0.1;
    }

    return params;
  }

  /**
   * Infer likely dtype from model config or defaults
   */
  private inferDtype(config: HuggingFaceConfig): string {
    if (config.torch_dtype) {
      const dtype = config.torch_dtype.toLowerCase();
      if (dtype.includes('float16') || dtype.includes('fp16')) return 'fp16';
      if (dtype.includes('bfloat16') || dtype.includes('bf16')) return 'bf16';
      if (dtype.includes('float8') || dtype.includes('fp8')) return 'fp8';
      if (dtype.includes('int8')) return 'int8';
      if (dtype.includes('int4')) return 'int4';
    }

    // Model type based inference
    const modelType = config.model_type?.toLowerCase() || '';
    if (
      modelType.includes('llama') ||
      modelType.includes('mistral') ||
      modelType.includes('qwen')
    ) {
      // Modern models often use FP8
      return 'fp8';
    }

    return 'fp16'; // Default
  }

  /**
   * Get heuristic parameters for known proprietary model families
   */
  private getHeuristicParams(
    modelId: string
  ): { params: Partial<ModelParams>; dtype: string } | null {
    const normalizedId = modelId.toLowerCase();

    // Try exact match first
    for (const [key, heuristic] of Object.entries(PROPRIETARY_MODEL_HEURISTICS)) {
      if (normalizedId.includes(key.replace(/-/g, '').replace(/_/g, ''))) {
        // Check for exact match or prefix match (for models like "together-")
        if (key.endsWith('-')) {
          // Prefix match - only match if model ID starts with the prefix
          if (normalizedId.startsWith(key.slice(0, -1))) {
            return this.heuristicToModelParams(heuristic);
          }
        } else if (normalizedId.includes(key)) {
          return this.heuristicToModelParams(heuristic);
        }
      }
    }

    return null;
  }

  /**
   * Convert heuristic to ModelParams
   */
  private heuristicToModelParams(heuristic: ModelFamilyHeuristic): {
    params: Partial<ModelParams>;
    dtype: string;
  } {
    return {
      params: {
        total_params: heuristic.total_params,
        active_params: heuristic.active_params,
        layers: heuristic.layers,
        heads: heuristic.heads,
        kv_lora_rank: heuristic.kv_lora_rank,
        qk_rope_head_dim: heuristic.qk_rope_head_dim,
        context_length: heuristic.context_length,
      },
      dtype: heuristic.default_dtype,
    };
  }

  /**
   * Clear cache (useful for testing or after config changes)
   */
  public clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get available dtype options for UI
   */
  public static getDtypeOptions(): Array<{ value: string; label: string; bytes: number }> {
    return [
      { value: 'fp16', label: 'FP16 (Float16)', bytes: 2 },
      { value: 'bf16', label: 'BF16 (BFloat16)', bytes: 2 },
      { value: 'fp8', label: 'FP8 (Float8)', bytes: 1 },
      { value: 'fp8_e4m3', label: 'FP8 E4M3', bytes: 1 },
      { value: 'fp8_e5m2', label: 'FP8 E5M2', bytes: 1 },
      { value: 'nvfp4', label: 'NVFP4', bytes: 0.5 },
      { value: 'int4', label: 'INT4', bytes: 0.5 },
      { value: 'int8', label: 'INT8', bytes: 1 },
    ];
  }
}
