import { logger } from '../utils/logger';
import type { MetadataOverrides } from '../config';

type MetadataSourceId = 'openrouter' | 'models.dev' | 'catwalk';

interface MetadataCatalogSources {
  openrouter: string;
  modelsDev: string;
  catwalk: string;
}

export interface MetadataSourceRefreshSummary {
  source: MetadataSourceId;
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
    openrouter: MetadataSourceRefreshSummary;
    modelsDev: MetadataSourceRefreshSummary;
    catwalk: MetadataSourceRefreshSummary;
  };
}

const DEFAULT_METADATA_SOURCES: MetadataCatalogSources = {
  openrouter: 'https://openrouter.ai/api/v1/models',
  modelsDev: 'https://models.dev/api.json',
  catwalk: 'https://catwalk.charm.sh/v2/providers',
};

// ─── Normalized model metadata (OpenRouter-style) ──────────────────────────
// All three sources are normalized into this shape.

export interface NormalizedModelMetadata {
  /** Source-native ID (for reference) */
  id: string;
  /** Human-readable display name */
  name: string;
  /** Model description */
  description?: string;
  /** Maximum context window in tokens */
  context_length?: number;
  architecture?: {
    modality?: string;
    input_modalities?: string[];
    output_modalities?: string[];
    tokenizer?: string;
    instruct_type?: string | null;
  };
  pricing?: {
    /** Cost per token (as a decimal string), e.g. "0.000003" = $3/M tokens */
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

// ─── Source-specific raw shapes ──────────────────────────

interface OpenRouterRawModel {
  id: string;
  name?: string;
  description?: string;
  context_length?: number;
  architecture?: {
    modality?: string;
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
    [key: string]: string | undefined;
  };
  supported_parameters?: string[];
  top_provider?: {
    context_length?: number;
    max_completion_tokens?: number;
  };
  supported_frame_images?: string[];
  generate_audio?: boolean | null;
}

interface OpenRouterResponse {
  data: OpenRouterRawModel[];
}

type OpenRouterCatalogKind = 'models' | 'embeddings' | 'videos';

interface ModelsDevModel {
  id: string;
  name?: string;
  reasoning?: boolean;
  tool_call?: boolean;
  temperature?: boolean;
  attachment?: boolean;
  modalities?: {
    input?: string[];
    output?: string[];
  };
  cost?: {
    input?: number; // $ per million tokens
    output?: number;
    cache_read?: number;
    cache_write?: number;
  };
  limit?: {
    context?: number;
    output?: number;
  };
  [key: string]: unknown;
}

interface ModelsDevProvider {
  id: string;
  models?: Record<string, ModelsDevModel> | ModelsDevModel[];
  [key: string]: unknown;
}

interface CatwalkModel {
  id: string;
  name?: string;
  cost_per_1m_in?: number;
  cost_per_1m_out?: number;
  cost_per_1m_in_cached?: number;
  cost_per_1m_out_cached?: number;
  context_window?: number;
  default_max_tokens?: number;
  can_reason?: boolean;
  has_reasoning_efforts?: boolean;
  supports_attachments?: boolean;
}

interface CatwalkProvider {
  id: string;
  models?: CatwalkModel[];
}

// ─── Normalizers ───────────────────────────────────────
function inferOpenRouterArchitecture(
  raw: OpenRouterRawModel,
  kind: OpenRouterCatalogKind
): OpenRouterRawModel['architecture'] {
  if (raw.architecture) return raw.architecture;
  if (kind !== 'videos') return undefined;

  const inputModalities = ['text'];
  if (raw.supported_frame_images?.length) inputModalities.push('image');
  const outputModalities = ['video'];
  if (raw.generate_audio) outputModalities.push('audio');

  return {
    modality: `${inputModalities.join('+')}->${outputModalities.join('+')}`,
    input_modalities: inputModalities,
    output_modalities: outputModalities,
  };
}

function normalizeOpenRouterModel(
  raw: OpenRouterRawModel,
  kind: OpenRouterCatalogKind = 'models'
): NormalizedModelMetadata {
  const architecture = inferOpenRouterArchitecture(raw, kind);

  return {
    id: raw.id,
    name: raw.name ?? raw.id,
    description: raw.description,
    context_length: raw.context_length,
    architecture,
    pricing: raw.pricing
      ? {
          prompt: raw.pricing.prompt,
          completion: raw.pricing.completion,
          input_cache_read: raw.pricing.input_cache_read,
          input_cache_write: raw.pricing.input_cache_write,
        }
      : undefined,
    supported_parameters: raw.supported_parameters,
    top_provider: raw.top_provider,
  };
}

function normalizeModelsDevModel(
  providerId: string,
  modelId: string,
  raw: ModelsDevModel
): NormalizedModelMetadata {
  // models.dev costs are in $/million tokens; we convert to $/token strings
  const toPerTokenString = (perMillion?: number): string | undefined => {
    if (perMillion == null) return undefined;
    return String(perMillion / 1_000_000);
  };

  // Infer supported parameters
  const params: string[] = [];
  if (raw.tool_call) params.push('tools', 'tool_choice');
  if (raw.temperature) params.push('temperature');
  if (raw.reasoning) params.push('reasoning');
  if (raw.attachment) params.push('image'); // attachment support implies image input

  const inputModalities = raw.modalities?.input;
  const outputModalities = raw.modalities?.output;

  return {
    id: `${providerId}.${modelId}`,
    name: raw.name ?? raw.id ?? modelId,
    context_length: raw.limit?.context,
    architecture: {
      modality:
        inputModalities?.length || outputModalities?.length
          ? `${inputModalities?.join('+') ?? ''}->${outputModalities?.join('+') ?? ''}`
          : undefined,
      input_modalities: inputModalities,
      output_modalities: outputModalities,
    },
    pricing:
      raw.cost?.input != null || raw.cost?.output != null
        ? {
            prompt: toPerTokenString(raw.cost?.input),
            completion: toPerTokenString(raw.cost?.output),
            input_cache_read: toPerTokenString(raw.cost?.cache_read),
            input_cache_write: toPerTokenString(raw.cost?.cache_write),
          }
        : undefined,
    supported_parameters: params.length > 0 ? params : undefined,
    top_provider:
      raw.limit?.output != null
        ? {
            max_completion_tokens: raw.limit.output,
            context_length: raw.limit.context,
          }
        : undefined,
  };
}

function normalizeCatwalkModel(providerId: string, raw: CatwalkModel): NormalizedModelMetadata {
  const toPerTokenString = (perMillion?: number): string | undefined => {
    if (perMillion == null) return undefined;
    return String(perMillion / 1_000_000);
  };

  const params: string[] = ['temperature', 'max_tokens'];
  if (raw.can_reason) params.push('reasoning');
  if (raw.supports_attachments) params.push('image');

  const inputModalities = ['text'];
  if (raw.supports_attachments) inputModalities.push('image');
  const outputModalities = ['text'];

  return {
    id: `${providerId}.${raw.id}`,
    name: raw.name ?? raw.id,
    context_length: raw.context_window,
    architecture: {
      modality: `${inputModalities.join('+')}->${outputModalities.join('+')}`,
      input_modalities: inputModalities,
      output_modalities: outputModalities,
    },
    pricing:
      raw.cost_per_1m_in != null || raw.cost_per_1m_out != null
        ? {
            prompt: toPerTokenString(raw.cost_per_1m_in),
            completion: toPerTokenString(raw.cost_per_1m_out),
            input_cache_read: toPerTokenString(raw.cost_per_1m_in_cached),
          }
        : undefined,
    supported_parameters: params,
    top_provider: {
      context_length: raw.context_window,
      max_completion_tokens: raw.default_max_tokens,
    },
  };
}

// ─── ModelMetadataManager ───────────────────────────

export class ModelMetadataManager {
  private static instance: ModelMetadataManager;

  // Each map is keyed by the source-native path:
  //   openrouter:  "openai/gpt-4.1-nano"
  //   models.dev:  "anthropic.claude-3-5-haiku-20241022"
  //   catwalk:     "anthropic.claude-3-5-haiku-20241022"
  private openrouterMap: Map<string, NormalizedModelMetadata> = new Map();
  private modelsDevMap: Map<string, NormalizedModelMetadata> = new Map();
  private catwalkMap: Map<string, NormalizedModelMetadata> = new Map();

  private initializedSources: Set<MetadataSourceId> = new Set();
  private sourceConfig: MetadataCatalogSources = { ...DEFAULT_METADATA_SOURCES };
  private autoRefreshIntervalMinutes = 60;
  private autoRefreshTimer: ReturnType<typeof setInterval> | null = null;
  private inFlightRefresh: Promise<ModelMetadataRefreshResult> | null = null;

  private constructor() {}

  public static getInstance(): ModelMetadataManager {
    if (!ModelMetadataManager.instance) {
      ModelMetadataManager.instance = new ModelMetadataManager();
    }
    return ModelMetadataManager.instance;
  }

  /** Reset the singleton (used in tests) */
  public static resetForTesting(): void {
    ModelMetadataManager.instance?.stopAutoRefresh();
    ModelMetadataManager.instance = new ModelMetadataManager();
  }

  /**
   * Load all three metadata sources. Each source is loaded independently;
   * failure of one does not prevent the others from loading.
   */
  public async loadAll(sources?: Partial<MetadataCatalogSources>): Promise<void> {
    await this.refreshAll(sources, 'manual');
  }

  public async refreshAll(
    sources?: Partial<MetadataCatalogSources>,
    trigger: 'startup' | 'scheduled' | 'manual' = 'manual'
  ): Promise<ModelMetadataRefreshResult> {
    if (sources) {
      this.sourceConfig = {
        ...this.sourceConfig,
        ...sources,
      };
    }

    if (this.inFlightRefresh) {
      return this.inFlightRefresh;
    }

    this.inFlightRefresh = (async () => {
      const startedAt = Date.now();
      const refreshedAt = new Date(startedAt).toISOString();
      const [openrouter, modelsDev, catwalk] = await Promise.all([
        this.loadOpenRouter(this.sourceConfig.openrouter),
        this.loadModelsDev(this.sourceConfig.modelsDev),
        this.loadCatwalk(this.sourceConfig.catwalk),
      ]);

      const hadErrors = [openrouter, modelsDev, catwalk].some((source) => !!source.error);
      const durationMs = Date.now() - startedAt;
      const result: ModelMetadataRefreshResult = {
        success: !hadErrors,
        message: hadErrors
          ? 'Model metadata refresh completed with errors'
          : 'Model metadata refresh completed successfully',
        trigger,
        refreshedAt,
        durationMs,
        intervalMinutes: this.autoRefreshIntervalMinutes,
        hadErrors,
        sources: {
          openrouter,
          modelsDev,
          catwalk,
        },
      };

      if (hadErrors) {
        logger.warn(`Model metadata refresh (${trigger}) completed with errors`, result);
      } else {
        logger.info(`Model metadata refresh (${trigger}) completed in ${durationMs}ms`);
      }

      return result;
    })().finally(() => {
      this.inFlightRefresh = null;
    });

    return this.inFlightRefresh;
  }

  public startAutoRefresh(intervalMinutes = 60, sources?: Partial<MetadataCatalogSources>): void {
    if (sources) {
      this.sourceConfig = {
        ...this.sourceConfig,
        ...sources,
      };
    }

    this.stopAutoRefresh();
    this.autoRefreshIntervalMinutes = Math.max(1, intervalMinutes);
    this.autoRefreshTimer = setInterval(
      () => {
        this.refreshAll(undefined, 'scheduled').catch((error) => {
          logger.error('Scheduled model metadata refresh failed', error);
        });
      },
      this.autoRefreshIntervalMinutes * 60 * 1000
    );

    logger.info(
      `Scheduled model metadata auto-refresh every ${this.autoRefreshIntervalMinutes} minutes`
    );
  }

  public stopAutoRefresh(): void {
    if (this.autoRefreshTimer) {
      clearInterval(this.autoRefreshTimer);
      this.autoRefreshTimer = null;
    }
  }

  // ─── Loaders ────────────────────────────────────

  private async loadOpenRouter(source: string): Promise<MetadataSourceRefreshSummary> {
    try {
      logger.debug(`Loading OpenRouter metadata from ${source}`);
      const nextMap: Map<string, NormalizedModelMetadata> = new Map();

      const loadCatalog = async (
        catalogSource: string,
        kind: OpenRouterCatalogKind
      ): Promise<void> => {
        const raw = await this.fetchOrReadJson<OpenRouterResponse>(catalogSource);
        if (!raw || !Array.isArray(raw.data)) {
          logger.warn(`Invalid OpenRouter ${kind} response format`);
          return;
        }
        for (const model of raw.data) {
          if (model.id) {
            nextMap.set(model.id, normalizeOpenRouterModel(model, kind));
          }
        }
      };

      await loadCatalog(source, 'models');

      for (const auxiliary of this.getOpenRouterAuxiliarySources(source)) {
        try {
          await loadCatalog(auxiliary.source, auxiliary.kind);
        } catch (error) {
          logger.warn(`Failed to load OpenRouter ${auxiliary.kind} metadata`, error);
        }
      }

      if (nextMap.size === 0) {
        logger.warn('Invalid OpenRouter response format');
        return this.toSourceSummary(
          'openrouter',
          this.openrouterMap,
          'Invalid OpenRouter response format'
        );
      }

      this.openrouterMap = nextMap;
      this.initializedSources.add('openrouter');
      logger.debug(`Loaded ${this.openrouterMap.size} OpenRouter models`);
      return this.toSourceSummary('openrouter', this.openrouterMap);
    } catch (error) {
      logger.error('Failed to load OpenRouter metadata', error);
      return this.toSourceSummary(
        'openrouter',
        this.openrouterMap,
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  private async loadModelsDev(source: string): Promise<MetadataSourceRefreshSummary> {
    try {
      logger.debug(`Loading models.dev metadata from ${source}`);
      const raw = await this.fetchOrReadJson<Record<string, ModelsDevProvider>>(source);
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        logger.warn('Invalid models.dev response format');
        return this.toSourceSummary(
          'models.dev',
          this.modelsDevMap,
          'Invalid models.dev response format'
        );
      }

      const nextMap: Map<string, NormalizedModelMetadata> = new Map();
      for (const [providerId, provider] of Object.entries(raw)) {
        const models = provider?.models;
        if (!models) continue;

        if (Array.isArray(models)) {
          for (const model of models) {
            if (model?.id) {
              const key = `${providerId}.${model.id}`;
              nextMap.set(key, normalizeModelsDevModel(providerId, model.id, model));
            }
          }
        } else if (typeof models === 'object') {
          for (const [modelId, model] of Object.entries(models)) {
            if (model) {
              const key = `${providerId}.${modelId}`;
              nextMap.set(key, normalizeModelsDevModel(providerId, modelId, model));
            }
          }
        }
      }

      if (nextMap.size === 0) {
        logger.warn('Invalid models.dev response format');
        return this.toSourceSummary(
          'models.dev',
          this.modelsDevMap,
          'Invalid models.dev response format'
        );
      }

      this.modelsDevMap = nextMap;
      this.initializedSources.add('models.dev');
      logger.debug(`Loaded ${this.modelsDevMap.size} models.dev models`);
      return this.toSourceSummary('models.dev', this.modelsDevMap);
    } catch (error) {
      logger.error('Failed to load models.dev metadata', error);
      return this.toSourceSummary(
        'models.dev',
        this.modelsDevMap,
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  private async loadCatwalk(source: string): Promise<MetadataSourceRefreshSummary> {
    try {
      logger.debug(`Loading Catwalk metadata from ${source}`);
      const raw = await this.fetchOrReadJson<CatwalkProvider[]>(source);
      if (!raw || !Array.isArray(raw)) {
        logger.warn('Invalid Catwalk response format');
        return this.toSourceSummary('catwalk', this.catwalkMap, 'Invalid Catwalk response format');
      }

      const nextMap: Map<string, NormalizedModelMetadata> = new Map();
      for (const provider of raw) {
        if (!provider?.id || !Array.isArray(provider.models)) continue;
        for (const model of provider.models) {
          if (model?.id) {
            const key = `${provider.id}.${model.id}`;
            nextMap.set(key, normalizeCatwalkModel(provider.id, model));
          }
        }
      }

      if (nextMap.size === 0) {
        logger.warn('Invalid Catwalk response format');
        return this.toSourceSummary('catwalk', this.catwalkMap, 'Invalid Catwalk response format');
      }

      this.catwalkMap = nextMap;
      this.initializedSources.add('catwalk');
      logger.debug(`Loaded ${this.catwalkMap.size} Catwalk models`);
      return this.toSourceSummary('catwalk', this.catwalkMap);
    } catch (error) {
      logger.error('Failed to load Catwalk metadata', error);
      return this.toSourceSummary(
        'catwalk',
        this.catwalkMap,
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  // ─── Helpers ─────────────────────────────────────────

  private getOpenRouterAuxiliarySources(
    source: string
  ): Array<{ source: string; kind: Exclude<OpenRouterCatalogKind, 'models'> }> {
    if (!source.startsWith('http://') && !source.startsWith('https://')) return [];

    const url = new URL(source);
    if (!url.pathname.endsWith('/models')) return [];

    const embeddings = new URL(url);
    embeddings.pathname = url.pathname.replace(/\/models$/, '/embeddings/models');

    const videos = new URL(url);
    videos.pathname = url.pathname.replace(/\/models$/, '/videos/models');

    return [
      { source: embeddings.toString(), kind: 'embeddings' },
      { source: videos.toString(), kind: 'videos' },
    ];
  }

  private async fetchOrReadJson<T>(source: string): Promise<T> {
    if (source.startsWith('http://') || source.startsWith('https://')) {
      const response = await fetch(source);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return response.json() as Promise<T>;
    }
    // Local file path (for testing)
    const file = Bun.file(source);
    if (!(await file.exists())) {
      throw new Error(`File not found: ${source}`);
    }
    return file.json() as Promise<T>;
  }

  private getMap(source: MetadataSourceId): Map<string, NormalizedModelMetadata> {
    switch (source) {
      case 'openrouter':
        return this.openrouterMap;
      case 'models.dev':
        return this.modelsDevMap;
      case 'catwalk':
        return this.catwalkMap;
    }
  }

  // ─── Public API ─────────────────────────────────

  public isInitialized(source: 'openrouter' | 'models.dev' | 'catwalk'): boolean {
    return this.initializedSources.has(source);
  }

  public isAnyInitialized(): boolean {
    return this.initializedSources.size > 0;
  }

  /**
   * Look up a single model by source + source_path.
   * Returns undefined if the source has not been loaded or the path is not found.
   */
  public getMetadata(
    source: 'openrouter' | 'models.dev' | 'catwalk',
    sourcePath: string
  ): NormalizedModelMetadata | undefined {
    return this.getMap(source).get(sourcePath);
  }

  /**
   * Search models within a source by substring match on id or name.
   * Returns lightweight { id, name } objects suitable for autocomplete.
   */
  public search(
    source: 'openrouter' | 'models.dev' | 'catwalk',
    query: string,
    limit = 50
  ): Array<{ id: string; name: string }> {
    const map = this.getMap(source);
    const lowerQuery = query.toLowerCase();
    const results: Array<{ id: string; name: string }> = [];

    for (const [key, meta] of map) {
      const architecture = meta.architecture;
      const searchableText = [
        key,
        meta.name,
        meta.description,
        architecture?.modality,
        ...(architecture?.input_modalities ?? []),
        ...(architecture?.output_modalities ?? []),
      ]
        .filter((value): value is string => typeof value === 'string')
        .join(' ')
        .toLowerCase();
      if (!query || searchableText.includes(lowerQuery)) {
        results.push({ id: key, name: meta.name });
      }
    }

    // Prioritize matches that start with the query, then cap after ranking so
    // broad searches don't hide later multimodal models due to catalog order.
    if (query) {
      results.sort((a, b) => {
        const aStarts =
          a.id.toLowerCase().startsWith(lowerQuery) || a.name.toLowerCase().startsWith(lowerQuery);
        const bStarts =
          b.id.toLowerCase().startsWith(lowerQuery) || b.name.toLowerCase().startsWith(lowerQuery);
        if (aStarts && !bStarts) return -1;
        if (!aStarts && bStarts) return 1;
        return a.id.localeCompare(b.id);
      });
    }

    return results.slice(0, limit);
  }

  public getAllIds(source: 'openrouter' | 'models.dev' | 'catwalk'): string[] {
    return Array.from(this.getMap(source).keys());
  }

  private toSourceSummary(
    source: MetadataSourceId,
    map: Map<string, NormalizedModelMetadata>,
    error?: string
  ): MetadataSourceRefreshSummary {
    const initialized = map.size > 0 || this.initializedSources.has(source);

    if (!initialized) {
      this.initializedSources.delete(source);
    }

    return {
      source,
      initialized,
      count: map.size,
      ...(error ? { error } : {}),
    };
  }
}

/**
 * Merge per-field metadata overrides on top of a catalog entry.
 *
 * - Scalars (name, description, context_length) replace.
 * - Nested objects (pricing, architecture, top_provider) are spread-merged so
 *   partial overrides don't wipe untouched sibling keys.
 * - Arrays (supported_parameters, *_modalities) fully replace when present.
 *
 * When `base` is undefined (e.g. `source === 'custom'`), the overrides form the
 * entire result. When both `base` and `overrides` are empty/undefined, returns
 * undefined so callers can treat the alias as having no enriched metadata.
 */
export function mergeOverrides(
  base: NormalizedModelMetadata | undefined,
  overrides: MetadataOverrides | undefined
): NormalizedModelMetadata | undefined {
  if (!overrides) return base;

  const merged: NormalizedModelMetadata = {
    id: base?.id ?? '',
    name: base?.name ?? '',
    ...(base?.description !== undefined && { description: base.description }),
    ...(base?.context_length !== undefined && { context_length: base.context_length }),
    ...(base?.architecture !== undefined && { architecture: { ...base.architecture } }),
    ...(base?.pricing !== undefined && { pricing: { ...base.pricing } }),
    ...(base?.supported_parameters !== undefined && {
      supported_parameters: [...base.supported_parameters],
    }),
    ...(base?.top_provider !== undefined && { top_provider: { ...base.top_provider } }),
  };

  if (overrides.name !== undefined) merged.name = overrides.name;
  if (overrides.description !== undefined) merged.description = overrides.description;
  if (overrides.context_length !== undefined) merged.context_length = overrides.context_length;

  if (overrides.pricing) {
    merged.pricing = { ...(merged.pricing ?? {}), ...overrides.pricing };
  }
  if (overrides.architecture) {
    merged.architecture = { ...(merged.architecture ?? {}), ...overrides.architecture };
  }
  if (overrides.top_provider) {
    merged.top_provider = { ...(merged.top_provider ?? {}), ...overrides.top_provider };
  }
  if (overrides.supported_parameters !== undefined) {
    merged.supported_parameters = overrides.supported_parameters;
  }

  // If nothing meaningful ended up in merged, signal "no metadata".
  if (
    !merged.name &&
    merged.description === undefined &&
    merged.context_length === undefined &&
    merged.pricing === undefined &&
    merged.architecture === undefined &&
    merged.supported_parameters === undefined &&
    merged.top_provider === undefined
  ) {
    return undefined;
  }

  return merged;
}
