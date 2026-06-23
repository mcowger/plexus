import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { logger } from '../../utils/logger';
import { HuggingFaceModelFetcher } from '../../services/huggingface-model-fetcher';
import { ModelMetadataManager } from '../../services/model-metadata-manager';
import { getBuiltinModels, getBuiltinProviders } from '@earendil-works/pi-ai/providers/all';
import { ConfigService } from '../../services/config-service';

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
    // Built-in pi-ai providers plus any workspace custom providers.
    const builtin = getBuiltinProviders();
    let custom: string[] = [];
    try {
      custom = Object.keys(
        await ConfigService.getInstance().getRepository().getAllPiAiCustomProviders()
      );
    } catch {
      /* non-fatal */
    }
    const merged = Array.from(new Set([...builtin, ...custom])).sort();
    return reply.send({ data: merged });
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

    // Built-in registry models for this provider (may be empty for a custom provider).
    let builtin: ReturnType<typeof getBuiltinModels> = [];
    try {
      builtin = getBuiltinModels(query.provider as any) ?? [];
    } catch {
      builtin = [];
    }

    // Custom models are provider-scoped: surface only the ones belonging to this
    // provider (def.provider === provider). Models scoped to other providers are
    // hidden so the picker only offers resolvable options.
    let customEntries: Array<{ id: string; name: string; api: string; custom: true }> = [];
    try {
      const customModels = await ConfigService.getInstance()
        .getRepository()
        .getAllPiAiCustomModels();
      customEntries = Object.entries(customModels)
        .filter(([, def]) => def.provider === query.provider)
        .map(([id, def]) => ({
          id,
          name: (def as any).name ?? id,
          api: (def as any).api ?? 'custom',
          custom: true as const,
        }));
    } catch {
      /* non-fatal */
    }

    const merged = [
      ...builtin.map((m) => ({ id: m.id, name: m.name, api: m.api as string, custom: false })),
      // Avoid duplicating a custom model id that also exists in the registry.
      ...customEntries.filter((c) => !builtin.some((m) => m.id === c.id)),
    ];

    const q = (query.q ?? '').toLowerCase();
    const filtered = q
      ? merged.filter((m) => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q))
      : merged;
    return reply.send({ data: filtered });
  });
}
