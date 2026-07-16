import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { logger } from '../../utils/logger';
import { HuggingFaceModelFetcher } from '../../services/models/huggingface-model-fetcher';
import {
  ModelMetadataManager,
  resolveAutomaticModelIdentity,
  resolveModelMetadata,
  resolvePreferredApi,
} from '../../services/models/model-metadata-manager';
import { getConfig, ModelConfigSchema } from '../../config';
import { getBuiltinProviders } from '@earendil-works/pi-ai/providers/all';
import { getCatalogModel, getCatalogModels } from '../../services/pi-ai/catalog';

interface FetchModelRequest {
  Params: {
    modelId: string;
  };
}

export async function registerModelRoutes(fastify: FastifyInstance) {
  fastify.post('/v0/management/models/metadata/refresh', async (_request, reply) => {
    const result = await ModelMetadataManager.getInstance().refreshAll(undefined, 'manual');
    return reply.send(result);
  });

  fastify.post('/v0/management/models/metadata/resolve', async (request, reply) => {
    const body = request.body as { alias_id?: unknown; model?: unknown } | null;
    if (!body || typeof body.alias_id !== 'string') {
      return reply.code(400).send({ error: 'alias_id is required' });
    }

    const parsed = ModelConfigSchema.safeParse(body.model);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation failed', details: parsed.error.issues });
    }

    const providers = getConfig().providers;
    const identity = resolveAutomaticModelIdentity(body.alias_id, parsed.data, providers);
    const resolved = resolveModelMetadata(
      body.alias_id,
      parsed.data,
      providers,
      ModelMetadataManager.getInstance()
    );
    let piModel: { provider: string; model_id: string; name: string } | null = null;
    if (identity.provider) {
      const match = getCatalogModel(identity.provider, identity.model);
      if (match) {
        piModel = { provider: identity.provider, model_id: identity.model, name: match.name };
      }
    }

    return reply.send({
      canonical_model: identity,
      pi_model: piModel,
      metadata: resolved
        ? {
            source: resolved.source,
            source_path: resolved.sourcePath,
            name: resolved.metadata.name,
          }
        : null,
      preferred_api: resolvePreferredApi(body.alias_id, parsed.data, providers) ?? null,
    });
  });

  // Fetch model architecture from Hugging Face
  fastify.get(
    '/v0/management/models/huggingface/:modelId',
    async (request: FastifyRequest<FetchModelRequest>, reply: FastifyReply) => {
      try {
        const { modelId } = request.params;

        if (!modelId) {
          return reply.code(400).send({
            error: {
              message: 'Model ID is required',
              type: 'invalid_request_error',
              code: 400,
            },
          });
        }

        logger.debug(`Fetching HuggingFace model architecture for: ${modelId}`);

        const fetcher = HuggingFaceModelFetcher.getInstance();
        const result = await fetcher.getModelParams(modelId);

        if (!result) {
          return reply.code(404).send({
            error: {
              message: `Model '${modelId}' not found on Hugging Face`,
              type: 'not_found_error',
              code: 404,
            },
          });
        }

        return reply.send({
          success: true,
          model_id: modelId,
          architecture: {
            total_params: result.params.total_params,
            active_params: result.params.active_params,
            layers: result.params.layers,
            heads: result.params.heads,
            kv_lora_rank: result.params.kv_lora_rank,
            qk_rope_head_dim: result.params.qk_rope_head_dim,
            context_length: result.params.context_length,
            dtype: result.dtype,
          },
        });
      } catch (error) {
        logger.error(`Error fetching model architecture: ${error}`);
        return reply.code(500).send({
          error: {
            message: error instanceof Error ? error.message : 'Internal server error',
            type: 'internal_error',
            code: 500,
          },
        });
      }
    }
  );

  /**
   * GET /v0/management/pi/providers
   * Returns the list of provider IDs known to the pi-ai library.
   */
  fastify.get('/v0/management/pi/providers', async (_request, reply) => {
    return reply.send({ data: getBuiltinProviders().sort() });
  });

  /**
   * GET /v0/management/pi/models
   * Returns models for a given pi provider, optionally filtered by a search query.
   *
   * Query parameters:
   *   - provider (required): pi provider id (e.g. "openai", "anthropic")
   *   - q (optional): substring filter on id or name
   */
  fastify.get('/v0/management/pi/models', async (request, reply) => {
    const query = request.query as { provider?: string; q?: string };
    if (!query.provider) {
      return reply.status(400).send({ error: `Missing 'provider' parameter` });
    }

    // Catalog models for this provider (built-in baseline + pi.dev overlay).
    const merged = getCatalogModels(query.provider).map((m) => ({
      id: m.id,
      name: m.name,
      api: m.api as string,
      custom: false,
    }));

    const q = (query.q ?? '').toLowerCase();
    const filtered = q
      ? merged.filter((m) => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q))
      : merged;
    return reply.send({ data: filtered });
  });
}
