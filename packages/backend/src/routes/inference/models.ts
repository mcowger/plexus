import { FastifyInstance } from 'fastify';
import { getConfig } from '../../config';
import { PricingManager } from '../../services/pricing-manager';
import { ModelMetadataManager, mergeOverrides } from '../../services/model-metadata-manager';

export async function registerModelsRoute(fastify: FastifyInstance) {
  /**
   * GET /v1/models
   * Returns a list of available model aliases configured in the database,
   * following the OpenRouter/OpenAI model list format.
   *
   * When an alias has a `metadata` block configured, the response includes
   * enriched fields (name, description, context_length, architecture, pricing,
   * supported_parameters, top_provider) sourced from the configured catalog.
   *
   * Note: Direct provider/model syntax (e.g., "stima/gemini-2.5-flash") is NOT
   * included in this list, as it's intended for debugging only.
   */
  fastify.get('/v1/models', async (request, reply) => {
    const config = getConfig();
    const metadataManager = ModelMetadataManager.getInstance();

    const created = Math.floor(Date.now() / 1000);

    const models = Object.entries(config.models).map(([aliasId, modelConfig]) => {
      const metaConfig = modelConfig?.metadata;

      const base = {
        id: aliasId,
        object: 'model' as const,
        created,
        owned_by: 'plexus',
      };

      if (!metaConfig) {
        return base;
      }

      // Look up enriched metadata from the appropriate source. Custom sources
      // skip the catalog entirely and derive everything from overrides. For
      // catalog-backed sources, a missing catalog hit is treated as a miss —
      // we don't silently synthesize a partial record from overrides alone,
      // because that would hide typos in source_path or unloaded sources.
      let enriched: ReturnType<typeof mergeOverrides> = undefined;
      if (metaConfig.source === 'custom') {
        enriched = mergeOverrides(undefined, metaConfig.overrides);
      } else {
        const catalog = metadataManager.getMetadata(metaConfig.source, metaConfig.source_path);
        if (catalog) {
          enriched = mergeOverrides(catalog, metaConfig.overrides);
        }
      }
      if (!enriched) {
        return base;
      }

      return {
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
    });

    return reply.send({
      object: 'list',
      data: models,
    });
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

    return reply.send({
      data: slugs,
      count: slugs.length,
    });
  });
}
