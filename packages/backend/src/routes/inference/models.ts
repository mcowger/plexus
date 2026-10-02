import { FastifyInstance } from 'fastify';
import type { FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'crypto';
import { getSupportedThinkingLevels } from '@earendil-works/pi-ai';
import type { Api, Model as PiAiModel } from '@earendil-works/pi-ai';
import { getConfig } from '../../config';
import type { ModelConfig, ProviderConfig } from '../../config';
import { PricingManager } from '../../services/observability/pricing-manager';
import {
  ModelMetadataManager,
  resolveAutomaticModelIdentity,
  resolveModelMetadata,
  resolvePreferredApi,
} from '../../services/models/model-metadata-manager';
import { getCatalogModel } from '../../services/pi-ai/catalog';
import {
  applyQuirkOverlay,
  resolveInlineQuirks,
} from '../../services/dispatch/dispatcher-auto-compat';
import { renderModelsUiPage } from './models-ui';

let v1ModelsLastHash: string | null = null;
let v1ModelsLastModified: string | null = null;
let openrouterModelsLastHash: string | null = null;
let openrouterModelsLastModified: string | null = null;

const MODEL_CREATED_AT = Math.floor(Date.now() / 1000);

const MUSE_CODE_STATIC_METADATA = {
  family: 'avocado',
  release_date: '2026-09-02',
  is_hidden: false,
  options: {
    reasoningEffort: 'high',
    forceReasoning: true,
    include: ['reasoning.encrypted_content'],
    temperature: 0.9,
    top_p: 0.9,
  },
  variants: {
    minimal: { reasoningEffort: 'minimal' },
    low: { reasoningEffort: 'low' },
    medium: { reasoningEffort: 'medium' },
    high: { reasoningEffort: 'high' },
    xhigh: { reasoningEffort: 'xhigh' },
    max: { reasoningEffort: 'max' },
  },
};

interface AliasInlineTarget {
  provider: string;
  model: string;
  apiType: string;
  quirks: NonNullable<ProviderConfig['pi_ai_quirks']>;
}

/**
 * Map a resolved pi-ai builtin `api` to the quirks target key it describes.
 * Used when an alias names multiple wire APIs and the builtin unambiguously
 * determines which quirks block applies.
 */
function quirksTargetForBuiltinApi(api: string | undefined): string | undefined {
  switch (api) {
    case 'openai-completions':
      return 'chat';
    case 'openai-responses':
    case 'openai-codex-responses':
    case 'azure-openai-responses':
      return 'responses';
    case 'anthropic-messages':
      return 'messages';
    case 'google-generative-ai':
    case 'google-generative-ai-vertex':
      return 'gemini';
    default:
      return undefined;
  }
}

/**
 * The single target + wire API an alias points at, when it points at exactly
 * one, along with that provider's explicit quirks. Used to overlay quirks onto
 * a resolved pi-ai builtin (or to advertise quirks inline when there is none).
 *
 * The quirks block is selected from the alias's single preferred API when
 * unambiguous; otherwise the resolved builtin's wire shape decides it, rather
 * than an arbitrary first entry.
 */
function resolveAliasInlineTarget(
  modelConfig: ModelConfig,
  providers: Record<string, ProviderConfig>,
  preferredApi: string[] | undefined,
  builtinApi: string | undefined
): AliasInlineTarget | undefined {
  const targets = (modelConfig.target_groups ?? [])
    .flatMap((group) => group.targets)
    .filter((target) => target.enabled !== false && target.provider && target.model);
  const unique = new Map(targets.map((target) => [`${target.provider}\0${target.model}`, target]));
  if (unique.size !== 1) return undefined;
  const target = [...unique.values()][0]!;
  const quirks = providers[target.provider!]?.pi_ai_quirks;
  if (!quirks) return undefined;
  let apiType: string | undefined;
  if (preferredApi?.length === 1) {
    apiType = preferredApi[0] === 'chat_completions' ? 'chat' : preferredApi[0];
  } else {
    apiType = quirksTargetForBuiltinApi(builtinApi);
  }
  if (!apiType) return undefined;
  return { provider: target.provider!, model: target.model!, apiType, quirks };
}

export async function registerModelsRoute(fastify: FastifyInstance) {
  /**
   * GET /v1/models
   * Returns a list of available model aliases configured in the database,
   * following the OpenRouter/OpenAI model list format.
   *
   * Metadata is resolved automatically from each alias's canonical target by
   * default. Explicit catalog links and per-field overrides remain supported.
   *
   * Note: Direct provider/model syntax (e.g., "stima/gemini-2.5-flash") is NOT
   * included in this list, as it's intended for debugging only.
   */
  fastify.get('/v1/models', async (request, reply) => {
    const config = getConfig();
    const metadataManager = ModelMetadataManager.getInstance();
    // Presence of the `ui` query key (e.g. /v1/models?ui) selects the
    // standalone HTML viewer instead of the normal JSON payload.
    const wantsUi =
      request.query !== null &&
      typeof request.query === 'object' &&
      'ui' in (request.query as Record<string, unknown>);

    const created = MODEL_CREATED_AT;
    const hasVisionFallthrough = !!config.vision_fallthrough;

    const models = Object.entries(config.models).map(([aliasId, modelConfig]) => {
      const automaticIdentity = resolveAutomaticModelIdentity(
        aliasId,
        modelConfig,
        config.providers
      );
      let piModelConfig = modelConfig?.pi_model;
      const preferredApi = resolvePreferredApi(aliasId, modelConfig, config.providers);
      const hasTargetQuirks = (modelConfig.target_groups ?? []).some((group) =>
        group.targets.some(
          (target) =>
            target.enabled !== false &&
            target.provider &&
            config.providers[target.provider]?.pi_ai_quirks
        )
      );
      const hasTargetPiAiProvider = (modelConfig.target_groups ?? []).some((group) =>
        group.targets.some(
          (target) =>
            target.enabled !== false &&
            !!target.provider &&
            !!config.providers[target.provider]?.pi_ai_provider
        )
      );

      // Resolve a pi-ai builtin regardless of inline quirks so advertised
      // capabilities can be the builtin OVERLAID with the target's quirks. A
      // quirks-only target with no explicit `pi_ai_provider` link keeps its
      // previous inline-only advertisement rather than fabricating an identity.
      const canResolveBuiltin = !hasTargetQuirks || hasTargetPiAiProvider;
      if (canResolveBuiltin && !piModelConfig && automaticIdentity.provider) {
        const inferred = getCatalogModel(automaticIdentity.provider, automaticIdentity.model);
        if (inferred) {
          piModelConfig = {
            provider: automaticIdentity.provider,
            model_id: automaticIdentity.model,
          };
        }
      }
      let piModel: PiAiModel<Api> | null = null;
      if (piModelConfig) {
        piModel = getCatalogModel(piModelConfig.provider, piModelConfig.model_id);
      }

      // Overlay quirks onto the builtin even when an explicit `pi_model` link
      // is configured; a multi-API alias selects the quirks block from the
      // resolved builtin's wire shape rather than an arbitrary first entry.
      const inlineTarget = hasTargetQuirks
        ? resolveAliasInlineTarget(modelConfig, config.providers, preferredApi, piModel?.api)
        : undefined;
      const inlineTraits = inlineTarget
        ? resolveInlineQuirks(inlineTarget.quirks, inlineTarget.apiType, inlineTarget.model)
        : undefined;

      // Capability source: builtin overlaid with quirks when both exist,
      // otherwise whichever is present. Inline-only quirks keep their existing
      // advertised shape; a resolvable builtin is never skipped just because
      // quirks are present.
      const advertised: PiAiModel<Api> | ReturnType<typeof resolveInlineQuirks> | null =
        piModel && inlineTarget
          ? (applyQuirkOverlay(
              piModel,
              inlineTarget.quirks,
              inlineTarget.apiType,
              inlineTarget.model
            ) as PiAiModel<Api>)
          : (piModel ?? inlineTraits);

      // Look up pi compat options if an advertised capability record exists.
      // `serviceTierFormat` is a Plexus-only dispatch hint, not a pi-ai compat
      // field, so it is never advertised to clients.
      let piOptions: Record<string, unknown> | undefined;
      if (advertised?.compat && Object.keys(advertised.compat).length > 0) {
        const { serviceTierFormat: _serviceTierFormat, ...compat } = advertised.compat as Record<
          string,
          unknown
        >;
        if (Object.keys(compat).length > 0) piOptions = compat;
      }

      // Canonical reasoning effort levels from the pi-ai model record
      // (thinkingLevelMap). Exposed so clients can offer a real effort picker
      // (e.g. OpenCode) instead of relying on fallback behavior. Values use
      // pi's canonical vocabulary ('off' | 'minimal' | 'low' | 'medium' |
      // 'high' | 'xhigh' | 'max'); clients map them to provider-native values.
      const inlineLevels =
        inlineTraits?.reasoning === true && inlineTraits.thinkingLevelMap
          ? Object.entries(inlineTraits.thinkingLevelMap)
              .filter(([, value]) => value !== null)
              .map(([level]) => level)
          : [];
      // A builtin (overlaid) model reports its full supported level window via
      // pi-ai; an inline-only model advertises exactly the declared levels.
      let reasoningOptions: { type: 'effort'; values: string[] }[] | undefined;
      if (piModel && advertised?.reasoning === true) {
        reasoningOptions = [
          { type: 'effort', values: [...getSupportedThinkingLevels(advertised as PiAiModel<Api>)] },
        ];
      } else if (inlineLevels.length > 0) {
        reasoningOptions = [{ type: 'effort', values: inlineLevels }];
      }

      const base = {
        id: aliasId,
        object: 'model' as const,
        created,
        owned_by: 'plexus',
        type: modelConfig.type ?? 'text',
        ...(preferredApi !== undefined && { preferred_api: preferredApi }),
        ...(piModelConfig && { pi_provider: piModelConfig.provider }),
        ...(piModelConfig && { pi_model: piModelConfig.model_id }),
        ...(piOptions !== undefined && { pi_options: piOptions }),
        ...(reasoningOptions !== undefined && { reasoning_options: reasoningOptions }),
      };

      const enriched = resolveModelMetadata(
        aliasId,
        modelConfig,
        config.providers,
        metadataManager
      )?.metadata;
      if (!enriched) {
        if (hasVisionFallthrough && modelConfig.use_image_fallthrough) {
          return {
            ...base,
            architecture: {
              input_modalities: ['text', 'image'],
              output_modalities: ['text'],
            },
          };
        }
        return base;
      }

      const result: Record<string, unknown> = {
        ...base,
        name: enriched.name,
        ...(enriched.description !== undefined && { description: enriched.description }),
        ...(enriched.context_length !== undefined && { context_length: enriched.context_length }),
        ...(enriched.architecture !== undefined && { architecture: enriched.architecture }),
        ...(enriched.pricing !== undefined && { pricing: enriched.pricing }),
        ...(enriched.supported_parameters !== undefined && {
          supported_parameters: enriched.supported_parameters,
        }),
        ...(enriched.top_provider !== undefined && { top_provider: enriched.top_provider }),
      };

      if (hasVisionFallthrough && modelConfig.use_image_fallthrough) {
        const arch = (result.architecture ?? {}) as Record<string, unknown>;
        const inputModalities = (arch.input_modalities as string[] | undefined) ?? [];
        if (!inputModalities.includes('image')) {
          result.architecture = {
            ...arch,
            input_modalities: [...inputModalities, 'image'],
          };
        }
        if (!arch.output_modalities) {
          result.architecture = {
            ...(result.architecture as Record<string, unknown>),
            output_modalities: ['text'],
          };
        }
      }

      return result;
    });

    const payload = {
      object: 'list',
      data: models,
    };
    const payloadString = JSON.stringify(payload);

    if (wantsUi) {
      // The viewer is intentionally unauthenticated like /v1/models itself:
      // a self-contained page reusing only Plexus theme tokens (no admin UI).
      return reply
        .type('text/html; charset=utf-8')
        .send(renderModelsUiPage(payloadString, models.length));
    }

    // Computing the hash on the fly of the fully serialized JSON is explicitly
    // accepted here as benchmarks show it is extremely fast (<0.01ms for 12KB)
    // and avoids complex state invalidation logic for ETags.
    const hash = crypto.createHash('sha256').update(payloadString).digest('hex');

    if (hash !== v1ModelsLastHash || !v1ModelsLastModified) {
      v1ModelsLastHash = hash;
      v1ModelsLastModified = new Date().toUTCString();
    }

    reply.header('ETag', `"${hash}"`);
    reply.header('Last-Modified', v1ModelsLastModified);

    const ifNoneMatch = request.headers['if-none-match'];
    const ifModifiedSince = request.headers['if-modified-since'];

    const cleanIfNoneMatch = ifNoneMatch
      ? ifNoneMatch.replace(/^W\//, '').replace(/^"|"$/g, '')
      : null;
    const etagMatches =
      cleanIfNoneMatch === hash || ifNoneMatch === `"${hash}"` || ifNoneMatch === hash;

    const lastModifiedMatches = !!(
      ifModifiedSince &&
      v1ModelsLastModified &&
      (ifModifiedSince === v1ModelsLastModified ||
        Date.parse(ifModifiedSince) >= Date.parse(v1ModelsLastModified))
    );

    if (ifNoneMatch) {
      if (etagMatches) {
        return reply.status(304).send();
      }
    } else if (lastModifiedMatches) {
      return reply.status(304).send();
    }

    return reply.type('application/json').send(payloadString);
  });

  /**
   * GET /v1/metadata/search
   * Search model metadata from a configured external catalog source.
   * Intended for frontend autocomplete when assigning metadata to an alias.
   *
   * Query parameters:
   *   - source (required): "openrouter" | "models.dev" | "catwalk"
   *   - q (optional): substring search query
   *   - limit (optional): max results to return (default 50, max 200)
   *
   * Returns: { data: [{ id, name }], count }
   */
  fastify.get('/v1/metadata/search', async (request, reply) => {
    const metadataManager = ModelMetadataManager.getInstance();
    const query = request.query as { source?: string; q?: string; limit?: string };

    const source = query.source as 'openrouter' | 'models.dev' | 'catwalk' | undefined;
    if (!source || !['openrouter', 'models.dev', 'catwalk'].includes(source)) {
      // Note: 'custom' is intentionally rejected — there's no catalog to search.
      return reply.status(400).send({
        error: `Missing or invalid 'source' parameter. Must be one of: openrouter, models.dev, catwalk`,
      });
    }

    if (!metadataManager.isInitialized(source)) {
      return reply.status(503).send({
        error: `Metadata source '${source}' is not yet loaded or failed to load`,
      });
    }

    const q = query.q ?? '';
    const limit = query.limit ? Math.min(parseInt(query.limit, 10) || 50, 200) : 50;
    const results = metadataManager.search(source, q, limit);

    return reply.send({
      data: results,
      count: results.length,
    });
  });

  /**
   * GET /v1/metadata/lookup
   * Return the full normalized metadata for a single model in a catalog source.
   * Used by the frontend to auto-populate the override form when a user enables
   * "Override catalog fields" — so the user sees the current values and can
   * tweak them rather than starting blank.
   *
   * Query parameters:
   *   - source (required): "openrouter" | "models.dev" | "catwalk"
   *   - source_path (required): the model id within the source
   *
   * Returns: the NormalizedModelMetadata record, or 404 if not found.
   */
  fastify.get('/v1/metadata/lookup', async (request, reply) => {
    const metadataManager = ModelMetadataManager.getInstance();
    const query = request.query as { source?: string; source_path?: string };

    const source = query.source as 'openrouter' | 'models.dev' | 'catwalk' | undefined;
    if (!source || !['openrouter', 'models.dev', 'catwalk'].includes(source)) {
      return reply.status(400).send({
        error: `Missing or invalid 'source' parameter. Must be one of: openrouter, models.dev, catwalk`,
      });
    }

    if (!query.source_path) {
      return reply.status(400).send({ error: `Missing 'source_path' parameter` });
    }

    if (!metadataManager.isInitialized(source)) {
      return reply.status(503).send({
        error: `Metadata source '${source}' is not yet loaded or failed to load`,
      });
    }

    const metadata = metadataManager.getMetadata(source, query.source_path);
    if (!metadata) {
      return reply.status(404).send({
        error: `No metadata found for '${query.source_path}' in source '${source}'`,
      });
    }

    return reply.send({ data: metadata });
  });

  /**
   * GET /v1/openrouter/models
   * Returns a list of OpenRouter model slugs, optionally filtered by a search query.
   * Query parameter: ?q=search-term
   */
  fastify.get('/v1/openrouter/models', async (request, reply) => {
    const pricingManager = PricingManager.getInstance();

    if (!pricingManager.isInitialized()) {
      return reply.status(503).send({
        error: 'OpenRouter pricing data not yet loaded',
      });
    }

    const query = (request.query as { q?: string }).q || '';
    const slugs = pricingManager.searchModelSlugs(query);

    const payload = {
      data: slugs,
      count: slugs.length,
    };
    const payloadString = JSON.stringify(payload);

    // Computing the hash on the fly of the fully serialized JSON is explicitly
    // accepted here as benchmarks show it is extremely fast (<0.01ms for 12KB)
    // and avoids complex state invalidation logic for ETags.
    const hash = crypto.createHash('sha256').update(payloadString).digest('hex');

    if (hash !== openrouterModelsLastHash || !openrouterModelsLastModified) {
      openrouterModelsLastHash = hash;
      openrouterModelsLastModified = new Date().toUTCString();
    }

    reply.header('ETag', `"${hash}"`);
    reply.header('Last-Modified', openrouterModelsLastModified);

    const ifNoneMatch = request.headers['if-none-match'];
    const ifModifiedSince = request.headers['if-modified-since'];

    const cleanIfNoneMatch = ifNoneMatch
      ? ifNoneMatch.replace(/^W\//, '').replace(/^"|"$/g, '')
      : null;
    const etagMatches =
      cleanIfNoneMatch === hash || ifNoneMatch === `"${hash}"` || ifNoneMatch === hash;

    const lastModifiedMatches = !!(
      ifModifiedSince &&
      openrouterModelsLastModified &&
      (ifModifiedSince === openrouterModelsLastModified ||
        Date.parse(ifModifiedSince) >= Date.parse(openrouterModelsLastModified))
    );

    if (ifNoneMatch) {
      if (etagMatches) {
        return reply.status(304).send();
      }
    } else if (lastModifiedMatches) {
      return reply.status(304).send();
    }

    return reply.type('application/json').send(payloadString);
  });
}

/**
 * GET /v1/muse-code/models and /muse-code/models
 * Returns configured aliases in the catalog format expected by the Muse CLI.
 * The Muse CLI ignores the path in base_url and always requests
 * {origin}/muse-code/models, so both paths are registered.
 * These routes are registered in the authenticated inference scope.
 */
export async function registerMuseCodeModelsRoute(fastify: FastifyInstance) {
  const handler = async (_request: FastifyRequest, reply: FastifyReply) => {
    const config = getConfig();
    const metadataManager = ModelMetadataManager.getInstance();

    const data = Object.entries(config.models).flatMap(([id, modelConfig]) => {
      const metadata = resolveModelMetadata(
        id,
        modelConfig,
        config.providers,
        metadataManager
      )?.metadata;
      const pricing = metadata?.pricing;
      const contextLimit = metadata?.context_length ?? metadata?.top_provider?.context_length;
      const outputLimit = metadata?.top_provider?.max_completion_tokens;
      if (!metadata || !contextLimit || !outputLimit || !pricing?.prompt || !pricing.completion) {
        return [];
      }

      const capabilities = new Set(metadata.supported_parameters);
      const automaticIdentity = resolveAutomaticModelIdentity(id, modelConfig, config.providers);
      const piModelConfig =
        modelConfig.pi_model ??
        (automaticIdentity.provider
          ? {
              provider: automaticIdentity.provider,
              model_id: automaticIdentity.model,
            }
          : undefined);
      const piModel = piModelConfig
        ? getCatalogModel(piModelConfig.provider, piModelConfig.model_id)
        : null;

      return [
        {
          id,
          object: 'model' as const,
          created: MODEL_CREATED_AT,
          owned_by: 'meta',
          metadata: {
            'muse-code': {
              name: id,
              ...MUSE_CODE_STATIC_METADATA,
              attachment: metadata.architecture?.input_modalities?.includes('image') ?? false,
              reasoning: piModel?.reasoning ?? capabilities.has('reasoning'),
              temperature: capabilities.has('temperature'),
              tool_call: capabilities.has('tools') || capabilities.has('tool_choice'),
              modalities: {
                input: metadata.architecture?.input_modalities ?? [],
                output: metadata.architecture?.output_modalities ?? [],
              },
              limit: {
                context: contextLimit,
                output: outputLimit,
              },
              cost: {
                currency: 'USD',
                input: pricing.prompt,
                output: pricing.completion,
                cached: pricing.input_cache_read ?? pricing.prompt,
              },
            },
          },
        },
      ];
    });

    return reply.type('application/json').send({ object: 'list', data });
  };

  fastify.get('/v1/muse-code/models', handler);
  fastify.get('/muse-code/models', handler);
}
