import { FastifyInstance } from 'fastify';
import { getConfig } from '../../config';
import { PricingManager } from '../../services/pricing-manager';
import { ModelMetadataManager } from '../../services/model-metadata-manager';

export async function registerModelsRoute(fastify: FastifyInstance) {
    /**
     * GET /v1/models
     * Returns a list of available model aliases configured in plexus.yaml,
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

     // Map each alias ID to its parent alias ID so additional_aliases can
        // inherit the parent's metadata configuration.
        const aliasToParent = new Map<string, string>();

        for (const [id, modelConfig] of Object.entries(config.models)) {
            aliasToParent.set(id, id);
            if (modelConfig.additional_aliases) {
         for (const alias of modelConfig.additional_aliases) {
               aliasToParent.set(alias, id);
                }
            }
        }

        const created = Math.floor(Date.now() / 1000);

        const models = Array.from(aliasToParent.entries()).map(([aliasId, parentId]) => {
            const modelConfig = config.models[parentId];
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

            // Look up enriched metadata from the appropriate source
       const enriched = metadataManager.getMetadata(metaConfig.source, metaConfig.source_path);
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
                ...(enriched.supported_parameters !== undefined && { supported_parameters: enriched.supported_parameters }),
                ...(enriched.top_provider !== undefined && { top_provider: enriched.top_provider }),
            };
        });

        return reply.send({
            object: 'list',
            data: models
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
            return reply.status(400).send({
           error: `Missing or invalid 'source' parameter. Must be one of: openrouter, models.dev, catwalk`
            });
        }

        if (!metadataManager.isInitialized(source)) {
    return reply.status(503).send({
             error: `Metadata source '${source}' is not yet loaded or failed to load`
            });
     }

        const q = query.q ?? '';
     const limit = query.limit ? Math.min(parseInt(query.limit, 10) || 50, 200) : 50;
        const results = metadataManager.search(source, q, limit);

        return reply.send({
            data: results,
            count: results.length
        });
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
         error: 'OpenRouter pricing data not yet loaded'
            });
        }

        const query = (request.query as { q?: string }).q || '';
        const slugs = pricingManager.searchModelSlugs(query);
        
        return reply.send({
            data: slugs,
          count: slugs.length
        });
    });
}
