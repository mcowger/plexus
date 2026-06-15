import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { logger } from '../../utils/logger';
import { fetchModelsFromUrl, validateUrlSafety } from '../../services/provider-model-discovery';

const fetchModelsSchema = z.object({
  url: z.string().url(),
  apiKey: z.string().optional(),
});

export async function registerProviderRoutes(fastify: FastifyInstance) {
  fastify.post('/v0/management/providers/fetch-models', async (request, reply) => {
    const parsed = fetchModelsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: {
          message: 'Invalid request body',
          type: 'validation_error',
          code: 400,
          details: parsed.error.issues,
        },
      });
    }

    const { url, apiKey } = parsed.data;

    // SSRF protection
    const urlValidation = validateUrlSafety(url);
    if (!urlValidation.valid) {
      return reply.code(400).send({
        error: {
          message: urlValidation.error || 'Invalid URL',
          type: 'ssrf_blocked',
          code: 400,
        },
      });
    }

    try {
      const normalized = await fetchModelsFromUrl(url, apiKey);
      logger.debug(`Fetched ${normalized.data.length} models from ${url}`);
      return reply.send(normalized);
    } catch (error) {
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          logger.error(`Request timeout for ${url}`);
          return reply.code(504).send({
            error: {
              message: 'Request timed out after 10 seconds',
              type: 'timeout_error',
              code: 504,
            },
          });
        }
        logger.error(`Fetch error: ${error.message}`);
        const statusCode = (error as any).statusCode ?? 500;
        return reply.code(statusCode).send({
          error: {
            message: error.message,
            type: statusCode === 500 ? 'fetch_error' : 'provider_error',
            code: statusCode,
            details: (error as any).details,
          },
        });
      }
      logger.error('Unknown fetch error', error);
      return reply.code(500).send({
        error: {
          message: 'An unexpected error occurred',
          type: 'internal_error',
          code: 500,
        },
      });
    }
  });
}
