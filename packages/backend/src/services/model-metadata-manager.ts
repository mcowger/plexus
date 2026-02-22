import { logger } from '../utils/logger';

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
}

interface OpenRouterResponse {
    data: OpenRouterRawModel[];
}

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
        input?: number;   // $ per million tokens
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
function normalizeOpenRouterModel(raw: OpenRouterRawModel): NormalizedModelMetadata {
    return {
        id: raw.id,
        name: raw.name ?? raw.id,
        description: raw.description,
        context_length: raw.context_length,
        architecture: raw.architecture,
        pricing: raw.pricing ? {
         prompt: raw.pricing.prompt,
            completion: raw.pricing.completion,
            input_cache_read: raw.pricing.input_cache_read,
            input_cache_write: raw.pricing.input_cache_write,
     } : undefined,
        supported_parameters: raw.supported_parameters,
        top_provider: raw.top_provider,
    };
}

function normalizeModelsDevModel(
    providerId: string,
    modelId: string,
    raw: ModelsDevModel,
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

    return {
        id: `${providerId}.${modelId}`,
        name: raw.name ?? raw.id ?? modelId,
        context_length: raw.limit?.context,
        architecture: {
            input_modalities: raw.modalities?.input,
            output_modalities: raw.modalities?.output,
        },
        pricing: (raw.cost?.input != null || raw.cost?.output != null) ? {
          prompt: toPerTokenString(raw.cost?.input),
            completion: toPerTokenString(raw.cost?.output),
            input_cache_read: toPerTokenString(raw.cost?.cache_read),
         input_cache_write: toPerTokenString(raw.cost?.cache_write),
        } : undefined,
        supported_parameters: params.length > 0 ? params : undefined,
        top_provider: raw.limit?.output != null ? {
            max_completion_tokens: raw.limit.output,
          context_length: raw.limit.context,
        } : undefined,
    };
}

function normalizeCatwalkModel(
    providerId: string,
    raw: CatwalkModel,
): NormalizedModelMetadata {
    const toPerTokenString = (perMillion?: number): string | undefined => {
        if (perMillion == null) return undefined;
        return String(perMillion / 1_000_000);
    };

    const params: string[] = ['temperature', 'max_tokens'];
    if (raw.can_reason) params.push('reasoning');
    if (raw.supports_attachments) params.push('image');

    const inputModalities = ['text'];
    if (raw.supports_attachments) inputModalities.push('image');

    return {
     id: `${providerId}.${raw.id}`,
        name: raw.name ?? raw.id,
        context_length: raw.context_window,
        architecture: {
            input_modalities: inputModalities,
         output_modalities: ['text'],
        },
        pricing: (raw.cost_per_1m_in != null || raw.cost_per_1m_out != null) ? {
            prompt: toPerTokenString(raw.cost_per_1m_in),
        completion: toPerTokenString(raw.cost_per_1m_out),
            input_cache_read: toPerTokenString(raw.cost_per_1m_in_cached),
     } : undefined,
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

    private initializedSources: Set<'openrouter' | 'models.dev' | 'catwalk'> = new Set();

    private constructor() {}

    public static getInstance(): ModelMetadataManager {
    if (!ModelMetadataManager.instance) {
            ModelMetadataManager.instance = new ModelMetadataManager();
        }
      return ModelMetadataManager.instance;
    }

    /** Reset the singleton (used in tests) */
    public static resetForTesting(): void {
        ModelMetadataManager.instance = new ModelMetadataManager();
    }

    /**
     * Load all three metadata sources. Each source is loaded independently;
     * failure of one does not prevent the others from loading.
     */
    public async loadAll(sources?: {
        openrouter?: string;
        modelsDev?: string;
        catwalk?: string;
    }): Promise<void> {
        const {
            openrouter = 'https://openrouter.ai/api/v1/models',
       modelsDev = 'https://models.dev/api.json',
            catwalk = 'https://catwalk.charm.sh/providers',
        } = sources ?? {};

        await Promise.all([
            this.loadOpenRouter(openrouter),
            this.loadModelsDev(modelsDev),
            this.loadCatwalk(catwalk),
        ]);
    }

    // ─── Loaders ────────────────────────────────────

    private async loadOpenRouter(source: string): Promise<void> {
        try {
            logger.info(`[ModelMetadataManager] Loading OpenRouter metadata from ${source}`);
          const raw = await this.fetchOrReadJson<OpenRouterResponse>(source);
            if (!raw || !Array.isArray(raw.data)) {
                logger.warn('[ModelMetadataManager] Invalid OpenRouter response format');
                return;
            }
         this.openrouterMap.clear();
            for (const model of raw.data) {
              if (model.id) {
                    this.openrouterMap.set(model.id, normalizeOpenRouterModel(model));
                }
            }
            this.initializedSources.add('openrouter');
            logger.info(`[ModelMetadataManager] Loaded ${this.openrouterMap.size} OpenRouter models`);
        } catch (error) {
            logger.error('[ModelMetadataManager] Failed to load OpenRouter metadata', error);
        }
    }
    private async loadModelsDev(source: string): Promise<void> {
        try {
        logger.info(`[ModelMetadataManager] Loading models.dev metadata from ${source}`);
            const raw = await this.fetchOrReadJson<Record<string, ModelsDevProvider>>(source);
            if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
                logger.warn('[ModelMetadataManager] Invalid models.dev response format');
                return;
         }
            this.modelsDevMap.clear();
         for (const [providerId, provider] of Object.entries(raw)) {
                const models = provider?.models;
                if (!models) continue;

                if (Array.isArray(models)) {
               for (const model of models) {
                      if (model?.id) {
                            const key = `${providerId}.${model.id}`;
                         this.modelsDevMap.set(key, normalizeModelsDevModel(providerId, model.id, model));
                     }
                    }
           } else if (typeof models === 'object') {
                for (const [modelId, model] of Object.entries(models)) {
                      if (model) {
                        const key = `${providerId}.${modelId}`;
                     this.modelsDevMap.set(key, normalizeModelsDevModel(providerId, modelId, model));
                        }
                    }
                }
          }
            this.initializedSources.add('models.dev');
      logger.info(`[ModelMetadataManager] Loaded ${this.modelsDevMap.size} models.dev models`);
        } catch (error) {
            logger.error('[ModelMetadataManager] Failed to load models.dev metadata', error);
        }
    }

    private async loadCatwalk(source: string): Promise<void> {
        try {
            logger.info(`[ModelMetadataManager] Loading Catwalk metadata from ${source}`);
          const raw = await this.fetchOrReadJson<CatwalkProvider[]>(source);
         if (!raw || !Array.isArray(raw)) {
                logger.warn('[ModelMetadataManager] Invalid Catwalk response format');
                return;
            }
            this.catwalkMap.clear();
         for (const provider of raw) {
              if (!provider?.id || !Array.isArray(provider.models)) continue;
                for (const model of provider.models) {
            if (model?.id) {
                     const key = `${provider.id}.${model.id}`;
                  this.catwalkMap.set(key, normalizeCatwalkModel(provider.id, model));
                    }
        }
            }
            this.initializedSources.add('catwalk');
            logger.info(`[ModelMetadataManager] Loaded ${this.catwalkMap.size} Catwalk models`);
        } catch (error) {
            logger.error('[ModelMetadataManager] Failed to load Catwalk metadata', error);
        }
    }

    // ─── Helpers ─────────────────────────────────────────

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

    private getMap(source: 'openrouter' | 'models.dev' | 'catwalk'): Map<string, NormalizedModelMetadata> {
     switch (source) {
            case 'openrouter': return this.openrouterMap;
            case 'models.dev': return this.modelsDevMap;
            case 'catwalk':    return this.catwalkMap;
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
        sourcePath: string,
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
        limit = 50,
    ): Array<{ id: string; name: string }> {
        const map = this.getMap(source);
        const lowerQuery = query.toLowerCase();
        const results: Array<{ id: string; name: string }> = [];

        for (const [key, meta] of map) {
            if (!query || key.toLowerCase().includes(lowerQuery) || meta.name.toLowerCase().includes(lowerQuery)) {
                results.push({ id: key, name: meta.name });
                if (results.length >= limit) break;
            }
     }

        // Prioritize matches that start with the query
        if (query) {
        results.sort((a, b) => {
           const aStarts = a.id.toLowerCase().startsWith(lowerQuery) || a.name.toLowerCase().startsWith(lowerQuery);
            const bStarts = b.id.toLowerCase().startsWith(lowerQuery) || b.name.toLowerCase().startsWith(lowerQuery);
                if (aStarts && !bStarts) return -1;
                if (!aStarts && bStarts) return 1;
                return a.id.localeCompare(b.id);
         });
        }

        return results;
    }

    public getAllIds(source: 'openrouter' | 'models.dev' | 'catwalk'): string[] {
        return Array.from(this.getMap(source).keys());
    }
}
