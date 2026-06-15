import { FastifyInstance } from 'fastify';
import { logger } from '../../utils/logger';
import { ProbeService, ProbeApiType } from '../../services/probe-service';
import { getClientIp } from '../../utils/ip';

const VALID_API_TYPES: ProbeApiType[] = [
  'chat',
  'messages',
  'gemini',
  'responses',
  'embeddings',
  'images',
  'speech',
  'oauth',
];

export async function registerTestRoutes(fastify: FastifyInstance, probeService: ProbeService) {
  /**
   * POST /v0/management/test
   * Test a specific provider/model combination with a canonical probe
   * request. Delegates to ProbeService.runProbe with source='manual'.
   */
  fastify.post('/v0/management/test', async (request, reply) => {
    const body = request.body as { provider: string; model: string; apiType?: string };

    if (!body.provider || !body.model) {
      return reply.code(400).send({
        success: false,
        error: 'Both provider and model are required',
      });
    }

    const apiType = (body.apiType || 'chat') as ProbeApiType;

    if (apiType === ('transcriptions' as ProbeApiType)) {
      return reply.code(400).send({
        success: false,
        error:
          'Cannot test transcriptions API via test endpoint - requires file upload. Use the actual /v1/audio/transcriptions endpoint to test.',
      });
    }

    if (!VALID_API_TYPES.includes(apiType)) {
      return reply.code(400).send({
        success: false,
        error: `Invalid API type: ${apiType}. Must be one of: ${VALID_API_TYPES.join(', ')}`,
      });
    }

    logger.debug(`Test endpoint: probing ${body.provider}/${body.model} via ${apiType}`);

    const result = await probeService.runProbe({
      provider: body.provider,
      model: body.model,
      apiType,
      source: 'manual',
      sourceIp: getClientIp(request),
    });

    if (result.success) {
      return reply.code(200).send({
        success: true,
        durationMs: result.durationMs,
        apiType: result.apiType,
        response: result.response,
      });
    }

    return reply.code(200).send({
      success: false,
      error: result.error || 'Unknown error',
      durationMs: result.durationMs,
      apiType: result.apiType,
    });
  });
}
