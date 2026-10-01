import type { CompactionSettings } from './settings';
import type {
  AutoCapabilityTier,
  AutoReasoningSuitability,
  AutoRoutingConfig,
  AutoTargetProfile,
} from '@plexus/shared';

export type { AutoCapabilityTier, AutoReasoningSuitability, AutoRoutingConfig, AutoTargetProfile };

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

export interface PiCatalogRefreshSummary {
  refreshed: number;
  errors: Record<string, string>;
}

export interface VersionRefreshSummary {
  previous: string;
  current: string;
  error?: string;
}

export interface CatalogRefreshAllResult {
  success: boolean;
  message: string;
  trigger: 'manual';
  refreshedAt: string;
  durationMs: number;
  hadErrors: boolean;
  metadata: ModelMetadataRefreshResult;
  piCatalog: PiCatalogRefreshSummary;
  versions: {
    codex: VersionRefreshSummary;
    claudeCode: VersionRefreshSummary;
  };
}

export interface CatalogStatusSource {
  initialized: boolean;
  count: number;
}

export interface CatalogStatus {
  intervals: {
    metadataMinutes: number;
    piCatalogMs: number;
    versionMinutes: number;
  };
  versions: {
    codex: string;
    claudeCode: string;
  };
  metadata: {
    openrouter: CatalogStatusSource;
    modelsDev: CatalogStatusSource;
    catwalk: CatalogStatusSource;
  };
  piCatalog: { modelCount: number };
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
    /** Local capability qualification for the `auto` policy. */
    auto_profile?: AutoTargetProfile;
  }>;
}

export type PreferredApiValue = 'chat_completions' | 'messages' | 'gemini' | 'responses';

export interface Alias {
  id: string;
  aliases?: string[];
  priority?: 'selector' | 'api_match';
  type?: 'text' | 'embeddings' | 'transcriptions' | 'speech' | 'image' | 'decisions';
  target_groups: AliasTargetGroup[];
  /** Alias-scoped scoring/switching policy for the `auto` selector. */
  auto_routing?: AutoRoutingConfig;
  advanced?: AliasBehavior[];
  metadata?: AliasMetadata;
  use_image_fallthrough?: boolean;
  enforce_limits?: boolean;
  sticky_session?: boolean;
  synthetic_safeguard_approval?: boolean;
  preferred_api?: Array<PreferredApiValue>;
  pi_model?: { provider: string; model_id: string };
  extraBody?: Record<string, unknown>;
  compaction?: CompactionSettings;
}

// ─── Auto routing preview API ─────────────────────────────────
// Proposed parent backend contract:
//   POST /v0/management/models/auto-routing/preview
// The response shape below is intentionally lenient; the parent backend aligns
// the exact fields and the UI renders whatever it receives.

export type AutoJudgmentSource = 'fresh' | 'exact_cache' | 'cache' | 'continuation' | 'unavailable';

/**
 * Typed judgment answers produced by the classifier. Fields are optional so a
 * partial or provider-specific answer can still be displayed without trusting
 * it as routing authority.
 */
export interface AutoJudgment {
  task_kind?: string;
  task_kind_confidence?: number;
  complexity?: number;
  complexity_confidence?: number;
  capability_required?: number;
  capability_required_confidence?: number;
  /** Noul likelihood; normalized to 0–1 by the backend only when verifiable. */
  deep_reasoning?: number;
  /** Optional uncalibrated confidence; missing is neutral. */
  confidence?: number;
  [key: string]: unknown;
}

export interface AutoRoutingPreviewAnalysis {
  judgment?: AutoJudgment;
  source: AutoJudgmentSource;
  reason?: string;
  latencyMs: number;
  /** Classifier cost in USD; absent or null when unknown (never treated as zero). */
  cost?: number | null;
}

/**
 * One expanded provider/model leaf reachable from a logical target, in the
 * order the ordinary child policy would dispatch it. Alias-reference targets
 * carry these so the preview can show what the outer profile actually covers.
 */
export interface AutoRoutingPreviewLeaf {
  id: string;
  provider?: string;
  model?: string;
  eligible?: boolean;
  reason?: string | null;
  /** Alias chain that produced this leaf, outer-most first. */
  provenance?: string[];
  rank?: number;
  /** Estimated leaf cost in USD; absent or null when unknown. */
  estimatedCostUsd?: number | null;
  cacheState?: 'cold' | 'warm' | 'unknown' | string;
  [key: string]: unknown;
}

export interface AutoRoutingPreviewTarget {
  id: string;
  provider?: string;
  model?: string;
  alias?: string;
  profile?: AutoTargetProfile | null;
  rank?: number;
  eligible?: boolean;
  suitable?: boolean;
  reason?: string;
  decision?: string;
  requiredTier?: AutoCapabilityTier;
  demand?: number;
  preference?: number;
  /** Estimated cost in USD; absent or null when unknown. */
  estimatedCostUsd?: number | null;
  cacheState?: 'cold' | 'warm' | 'unknown' | string;
  /** Expanded alias-reference leaves, in ordinary child policy order. */
  leaves?: AutoRoutingPreviewLeaf[];
  [key: string]: unknown;
}

export interface AutoRoutingPreviewGroup {
  name: string;
  decision: string;
  targets: AutoRoutingPreviewTarget[];
}

export interface AutoRoutingPreviewResponse {
  judgment_handle?: string;
  analysis: AutoRoutingPreviewAnalysis;
  groups: AutoRoutingPreviewGroup[];
  /** Explicit simulation assumptions; null/absent when the backend omits them. */
  assumptions?: string[];
}

/**
 * Simulation scenario supplied to the preview. All cache observations are
 * assumptions, never measured provider cache hits.
 */
export interface AutoRoutingPreviewScenario {
  incumbent?: { provider: string; model: string };
  input_tokens?: number;
  cache_state?: 'cold' | 'warm' | 'unknown';
}

export interface AutoRoutingPreviewRequest {
  /** Validated draft model config. */
  alias: Record<string, unknown>;
  alias_name?: string;
  prompt: string;
  /** Retained judgment handle so tuning weights does not reclassify. */
  judgment_handle?: string;
  scenario?: AutoRoutingPreviewScenario;
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
