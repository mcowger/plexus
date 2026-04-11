import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { logger } from '../../utils/logger';
import { HuggingFaceModelFetcher } from '../../services/huggingface-model-fetcher';

interface FetchModelRequest {
  Params: {
    modelId: string;
  };
}

export async function registerModelRoutes(fastify: FastifyInstance) {
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

        logger.debug(`[Management] Fetching HuggingFace model architecture for: ${modelId}`);

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
        logger.error(`[Management] Error fetching model architecture: ${error}`);
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
}
