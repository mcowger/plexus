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
import type { ModelParams, ModelParamsWithDtype } from '@plexus/shared';
import {
  DEFAULT_MODEL,
  DTYPE_SIZES,
  estimateActiveParams,
  estimateTotalParamsFromConfig,
  inferDataType,
  PROPRIETARY_MODEL_HEURISTICS,
  resolveDtypeSize,
} from '@plexus/shared';

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

// ─── Intermediate fetch result types ──────────────────────────
// Raw data returned by fetchModelData before translation to ModelParams.

interface HuggingFaceModelData {
  source: 'huggingface';
  /** Safetensors dtype→param-count distribution (undefined values stripped). */
  safetensorsParams?: Record<string, number>;
  /** Total parameters in billions (computed from safetensors). */
  totalParams?: number;
  /** Parsed config.json from the model repository. */
  config?: HuggingFaceConfig;
}

interface HeuristicModelData {
  source: 'heuristic';
  heuristic: ModelParamsWithDtype;
}

type FetchedModelData = HuggingFaceModelData | HeuristicModelData;

// ─── Fetcher Implementation ──────────────────────────

export class HuggingFaceModelFetcher {
  private static instance: HuggingFaceModelFetcher;
  private cache: Map<string, ModelParamsWithDtype> = new Map();

  private constructor() {}

  public static getInstance(): HuggingFaceModelFetcher {
    if (!HuggingFaceModelFetcher.instance) {
      HuggingFaceModelFetcher.instance = new HuggingFaceModelFetcher();
    }
    return HuggingFaceModelFetcher.instance;
  }

  /**
   * Reset the singleton (used in tests).
   */
  public static resetForTesting(): void {
    HuggingFaceModelFetcher.instance = new HuggingFaceModelFetcher();
  }

  // ─── Public API ──────────────────────────────────────

  /**
   * Get fully-resolved ModelParams for a model.
   *
   * Fetches architecture data from HuggingFace or falls back to proprietary
   * model heuristics, then translates the result into a complete ModelParams
   * object (filling in defaults for any missing fields) and caches it.
   *
   * @param modelId  Exact HuggingFace model identifier (e.g. "org/model-name").
   *                 No prefix stripping or normalization is performed.
   * @param dtype    Optional dtype override (e.g. "fp8", "bf16").
   */
  public async getModelParams(
    modelId: string,
    dtype?: string
  ): Promise<{
    params: ModelParamsWithDtype;
    source: 'huggingface' | 'heuristic' | 'default';
    dtype: string;
  }> {
    const cacheKey = `${modelId}:${dtype || 'default'}`;
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return { params: cached, source: 'huggingface', dtype: cached.dtype };
    }

    const modelData = await this.fetchModelData(modelId);

    if (!modelData) {
      // No data found anywhere — return defaults
      const finalDtype = dtype || DEFAULT_MODEL.dtype;

      // Return DEFAULT_MODEL directly if no dtype override, otherwise clone with new dtype/dtype_size
      const params = dtype
        ? { ...DEFAULT_MODEL, dtype: finalDtype, dtype_size: resolveDtypeSize(finalDtype) }
        : DEFAULT_MODEL;

      this.cache.set(cacheKey, params);
      return { params, source: 'default', dtype: finalDtype };
    }

    // Determine params and dtype based on source
    let partialParams: Partial<ModelParamsWithDtype>;
    let inferredDtype: string;

    if (modelData.source === 'heuristic') {
      // Heuristic source — already has complete params with dtype
      partialParams = modelData.heuristic;
      inferredDtype = modelData.heuristic.dtype;
    } else {
      // HuggingFace source — parseConfig already did dtype inference
      partialParams = this.parseConfig(modelData);
      inferredDtype = partialParams.dtype!;
    }

    const finalDtype = dtype || inferredDtype;
    const params: ModelParamsWithDtype = {
      ...DEFAULT_MODEL,
      ...partialParams,
      dtype: finalDtype,
      dtype_size: resolveDtypeSize(finalDtype),
    };
    this.cache.set(cacheKey, params);
    return { params, source: modelData.source, dtype: finalDtype };
  }

  // ─── Data Fetching ───────────────────────────────────

  /**
   * Fetch model architecture data from HuggingFace, falling back to
   * proprietary model heuristics if the model is not found.
   *
   * This method only fetches and parses — no translation to ModelParams.
   *
   * @param modelId  Exact HuggingFace model identifier (e.g. "org/model-name").
   */
  private async fetchModelData(modelId: string): Promise<FetchedModelData | null> {
    const hfResult = await this.fetchFromHuggingFace(modelId);
    if (hfResult) return hfResult;

    // Fall back to proprietary model heuristics
    const heuristic = this.matchHeuristic(modelId);
    if (heuristic) {
      logger.debug(`[HuggingFaceModelFetcher] Using heuristic for ${modelId}`);
      return { source: 'heuristic', heuristic };
    }

    return null;
  }

  /**
   * Fetch raw model data from the two HuggingFace endpoints:
   *  1. /api/models/{modelId}  — safetensors parameter distribution
   *  2. /{modelId}/resolve/main/config.json — architecture config
   *
   * Returns partial data if only one endpoint succeeds.
   * Returns null only if both endpoints fail.
   */
  private async fetchFromHuggingFace(modelId: string): Promise<HuggingFaceModelData | null> {
    try {
      // Fetch the HF API endpoint for safetensors parameter info
      const apiUrl = `https://huggingface.co/api/models/${modelId}`;
      logger.debug(`[HuggingFaceModelFetcher] Fetching API data from ${apiUrl}`);

      const apiResponse = await fetch(apiUrl, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });

      let safetensorsParams: Record<string, number> | undefined;
      let totalParams: number | undefined;

      if (apiResponse.ok) {
        const apiData: HuggingFaceApiResponse = await apiResponse.json();

        if (apiData.safetensors?.parameters) {
          // Strip undefined values so inferDataType gets Record<string, number>
          safetensorsParams = Object.fromEntries(
            Object.entries(apiData.safetensors.parameters).filter(
              (e): e is [string, number] => e[1] !== undefined
            )
          );

          const totalFromSafetensors = Object.values(safetensorsParams).reduce(
            (sum, count) => sum + count,
            0
          );

          if (totalFromSafetensors > 0) {
            totalParams = Math.round((totalFromSafetensors / 1e9) * 10) / 10;
          }
        }
      }

      // Fetch config.json for architecture details
      const configUrl = `https://huggingface.co/${modelId}/resolve/main/config.json`;
      logger.debug(`[HuggingFaceModelFetcher] Fetching config from ${configUrl}`);

      const configResponse = await fetch(configUrl, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });

      let config: HuggingFaceConfig | undefined;
      if (configResponse.ok) {
        config = await configResponse.json();
      } else {
        logger.debug(`[HuggingFaceModelFetcher] Config not found: ${configResponse.status}`);
      }

      // Return whatever we got — even partial data (safetensors-only) is useful
      if (safetensorsParams || config) {
        logger.info(`[HuggingFaceModelFetcher] Fetched data for ${modelId}`);
        return { source: 'huggingface', safetensorsParams, totalParams, config };
      }

      return null;
    } catch (error) {
      logger.debug(`[HuggingFaceModelFetcher] Error fetching model data: ${error}`);
      return null;
    }
  }

  // ─── Config Parsing ─────────────────────────────────

  /**
   * Parse HuggingFace model data into partial ModelParamsWithDtype.
   *
   * Extracts architecture fields (layers, heads, context length, etc.)
   * and estimates total/active params from the config or safetensors data.
   * Also infers the dtype from config and safetensors parameters.
   *
   * If no config is available, returns total_params = active_params from safetensors.
   */
  private parseConfig(modelData: HuggingFaceModelData): Partial<ModelParamsWithDtype> {
    const { safetensorsParams, totalParams, config } = modelData;

    // Infer dtype from config and safetensors
    const inferredDtype = inferDataType({
      torch_dtype: config?.torch_dtype,
      safetensors: safetensorsParams,
    });

    // No config available — fall back to safetensors total params
    if (!config) {
      return {
        total_params: totalParams,
        active_params: totalParams,
        dtype: inferredDtype,
        dtype_size: resolveDtypeSize(inferredDtype),
      };
    }

    const params: Partial<ModelParamsWithDtype> = {
      dtype: inferredDtype,
      dtype_size: resolveDtypeSize(inferredDtype),
    };

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
      config.max_position_embeddings || config.max_sequence_length || config.ctx_length || 4096;

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
    if (totalParams) {
      params.total_params = totalParams;
    } else {
      params.total_params = estimateTotalParamsFromConfig({
        vocab_size: config.vocab_size,
        hidden_size: config.hidden_size,
        num_hidden_layers: config.num_hidden_layers,
        intermediate_size: config.intermediate_size,
      });
    }

    // Calculate active params based on MoE configuration
    const textConfig = config.text_config || {};
    const numLocalExperts =
      config.num_local_experts ||
      config.n_routed_experts ||
      textConfig.num_local_experts ||
      textConfig.n_routed_experts;
    const numExpertsPerTok = config.num_experts_per_tok || textConfig.num_experts_per_tok;

    params.active_params = estimateActiveParams({
      totalParams: params.total_params || 0,
      numLocalExperts,
      numExpertsPerTok,
    });

    return params;
  }

  // ─── Heuristic Matching ──────────────────────────────

  /**
   * Match a model ID against proprietary model heuristics.
   *
   * Performs a simple case-insensitive substring match against the
   * known heuristic keys (e.g. "claude-4-6-opus", "gpt-5").
   */
  private matchHeuristic(modelId: string): ModelParamsWithDtype | null {
    const lower = modelId.toLowerCase();
    // Sort keys by length descending so more-specific keys match first.
    // Without this, 'gpt-5' would match 'gpt-5-codex-max' before 'gpt-5-codex-max' could.
    const entries = Object.entries(PROPRIETARY_MODEL_HEURISTICS).sort(
      (a, b) => b[0].length - a[0].length
    );
    for (const [key, heuristic] of entries) {
      if (lower.includes(key)) {
        return heuristic;
      }
    }
    return null;
  }

  // ─── Utilities ──────────────────────────────────────

  /**
   * Clear cache (useful for testing or after config changes).
   */
  public clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get available dtype options for UI.
   * Automatically pulled from DTYPE_SIZES in @plexus/shared.
   */
  public static getDtypeOptions(): Array<{ value: string; label: string; bytes: number }> {
    return Object.entries(DTYPE_SIZES)
      .filter(([key]) => key !== 'default')
      .map(([value, bytes]) => ({
        value,
        label: this.formatDtypeLabel(value),
        bytes,
      }));
  }

  /**
   * Format a dtype key into a human-readable label.
   * E.g., 'fp8_e4m3' -> 'FP8 E4M3'
   */
  private static formatDtypeLabel(dtype: string): string {
    return dtype.replace(/_/g, ' ').toUpperCase();
  }
}
