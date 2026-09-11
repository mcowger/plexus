import type { CompactionSettings } from './settings';

export interface Model {
  id: string;
  name: string;
  providerId: string;
  pricingSource?: string;
  type?: 'text' | 'embeddings' | 'transcriptions' | 'speech' | 'image';
}

// ─── Alias advanced behaviors ────────────────────────────────
// Mirror of the backend ModelBehaviorSchema discriminated union.
// Add new variants here as new behavior types are introduced in config.ts.

export interface StripAdaptiveThinkingBehavior {
  type: 'strip_adaptive_thinking';
  enabled: boolean;
}

export type AliasBehavior = StripAdaptiveThinkingBehavior; // | NextBehavior | ...

export type CatalogMetadataSource = 'openrouter' | 'models.dev' | 'catwalk';
export type MetadataSource = CatalogMetadataSource | 'auto' | 'disabled' | 'custom';

export interface MetadataOverrides {
  name?: string;
  description?: string;
  context_length?: number;
  pricing?: {
    prompt?: string;
    completion?: string;
    input_cache_read?: string;
    input_cache_write?: string;
  };
  architecture?: {
    input_modalities?: string[];
    output_modalities?: string[];
    tokenizer?: string;
  };
  supported_parameters?: string[];
  top_provider?: {
    context_length?: number;
    max_completion_tokens?: number;
  };
}

/**
 * Mirror of the backend `NormalizedModelMetadata` shape. Returned by
 * `GET /v1/metadata/lookup` and used to pre-fill the override form.
 */
export interface NormalizedModelMetadata {
  id: string;
  name: string;
  description?: string;
  context_length?: number;
  architecture?: {
    input_modalities?: string[];
    output_modalities?: string[];
    tokenizer?: string;
    instruct_type?: string | null;
  };
  pricing?: {
    prompt?: string;
    completion?: string;
    input_cache_read?: string;
    input_cache_write?: string;
  };
  supported_parameters?: string[];
  top_provider?: {
    context_length?: number;
    max_completion_tokens?: number;
  };
}

export interface ModelMetadataRefreshSourceSummary {
  source: CatalogMetadataSource;
  initialized: boolean;
  count: number;
  error?: string;
}

export interface ModelMetadataRefreshResult {
  success: boolean;
  message: string;
  trigger: 'startup' | 'scheduled' | 'manual';
  refreshedAt: string;
  durationMs: number;
  intervalMinutes: number;
  hadErrors: boolean;
  sources: {
    openrouter: ModelMetadataRefreshSourceSummary;
    modelsDev: ModelMetadataRefreshSourceSummary;
    catwalk: ModelMetadataRefreshSourceSummary;
  };
}

// Discriminated union mirrors backend validation: catalog-backed sources
// must carry a non-empty source_path; 'custom' may omit it but MUST carry
// an overrides blob with a non-empty `name` (there is no catalog fallback).
export type AliasMetadata =
  | {
      source: CatalogMetadataSource;
      source_path: string;
      overrides?: MetadataOverrides;
    }
  | {
      source: 'auto';
      overrides?: MetadataOverrides;
    }
  | {
      source: 'disabled';
    }
  | {
      source: 'custom';
      source_path?: string;
      overrides: MetadataOverrides & { name: string };
    };

export interface AliasTargetGroup {
  name: string;
  selector: string;
  targets: Array<{
    provider?: string;
    model?: string;
    alias?: string;
    apiType?: string[];
    enabled?: boolean;
  }>;
}

export type PreferredApiValue = 'chat_completions' | 'messages' | 'gemini' | 'responses';

export interface Alias {
  id: string;
  aliases?: string[];
  priority?: 'selector' | 'api_match';
  type?: 'text' | 'embeddings' | 'transcriptions' | 'speech' | 'image';
  target_groups: AliasTargetGroup[];
  advanced?: AliasBehavior[];
  metadata?: AliasMetadata;
  use_image_fallthrough?: boolean;
  enforce_limits?: boolean;
  sticky_session?: boolean;
  preferred_api?: Array<PreferredApiValue>;
  pi_model?: { provider: string; model_id: string };
  extraBody?: Record<string, unknown>;
  compaction?: CompactionSettings;
}

export interface ModelResolutionPreview {
  canonical_model: {
    provider?: string;
    model: string;
    basis: 'pi_model' | 'target' | 'alias';
  };
  pi_model: { provider: string; model_id: string; name: string } | null;
  metadata: {
    source: CatalogMetadataSource | 'heuristic';
    source_path?: string;
    name: string;
  } | null;
  preferred_api: PreferredApiValue[] | null;
}
