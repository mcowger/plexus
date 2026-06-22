import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { logger } from '../../utils/logger';
import { PiAiCustomProviderSchema, PiAiCustomModelSchema } from '../../config';
import { ConfigService } from '../../services/config-service';

const NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9.\-_]{0,126}$/;

/**
 * Register API endpoints for pi-ai custom provider / model registries
 * (inference-v2). These let operators define niche providers and new/inherited
 * models that aren't yet in the pi-ai built-in registry.
 */
export async function registerPiAiCustomRoutes(fastify: FastifyInstance) {
  const configService = ConfigService.getInstance();

  // ─── Custom Providers ──────────────────────────────────────────────────────

  fastify.get('/v0/management/pi/custom-providers', async (_req, reply) => {
    try {
      const data = await configService.getRepository().getAllPiAiCustomProviders();
      return reply.send(data);
    } catch (e: any) {
      logger.error('Error listing pi-ai custom providers:', e);
      return reply.code(500).send({ error: { message: e.message, type: 'server_error' } });
    }
  });

  fastify.put(
    '/v0/management/pi/custom-providers/:name',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { name } = request.params as { name: string };
      if (!NAME_RE.test(name)) {
        return reply.code(400).send({
          error: { message: 'Invalid provider id', type: 'invalid_request_error' },
        });
      }
      const result = PiAiCustomProviderSchema.safeParse(request.body);
      if (!result.success) {
        return reply.code(400).send({
          error: { message: 'Validation failed', type: 'invalid_request_error' },
          details: result.error.issues,
        });
      }
      try {
        await configService.savePiAiCustomProvider(name, result.data);
        return reply.send({ success: true, name, definition: result.data });
      } catch (e: any) {
        logger.error('Failed to save pi-ai custom provider', e);
        return reply.code(500).send({ error: { message: e.message, type: 'server_error' } });
      }
    }
  );

  fastify.delete(
    '/v0/management/pi/custom-providers/:name',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { name } = request.params as { name: string };
      try {
        const all = await configService.getRepository().getAllPiAiCustomProviders();
        if (!all[name]) {
          return reply.code(404).send({
            error: { message: `Custom provider not found: ${name}`, type: 'not_found_error' },
          });
        }
        await configService.deletePiAiCustomProvider(name);
        return reply.send({ success: true, name });
      } catch (e: any) {
        logger.error('Failed to delete pi-ai custom provider', e);
        return reply.code(500).send({ error: { message: e.message, type: 'server_error' } });
      }
    }
  );

  // ─── Custom Models ─────────────────────────────────────────────────────────

  fastify.get('/v0/management/pi/custom-models', async (_req, reply) => {
    try {
      const data = await configService.getRepository().getAllPiAiCustomModels();
      return reply.send(data);
    } catch (e: any) {
      logger.error('Error listing pi-ai custom models:', e);
      return reply.code(500).send({ error: { message: e.message, type: 'server_error' } });
    }
  });

  fastify.put(
    '/v0/management/pi/custom-models/:name',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { name } = request.params as { name: string };
      if (!NAME_RE.test(name)) {
        return reply.code(400).send({
          error: { message: 'Invalid model id', type: 'invalid_request_error' },
        });
      }
      const result = PiAiCustomModelSchema.safeParse(request.body);
      if (!result.success) {
        return reply.code(400).send({
          error: { message: 'Validation failed', type: 'invalid_request_error' },
          details: result.error.issues,
        });
      }
      // A model must be resolvable: either it inherits a base or declares an api.
      if (!result.data.inherits && !result.data.api) {
        return reply.code(400).send({
          error: {
            message: 'Custom model must either "inherits" a base model or declare an "api".',
            type: 'invalid_request_error',
          },
        });
      }
      try {
        await configService.savePiAiCustomModel(name, result.data);
        return reply.send({ success: true, name, definition: result.data });
      } catch (e: any) {
        logger.error('Failed to save pi-ai custom model', e);
        return reply.code(500).send({ error: { message: e.message, type: 'server_error' } });
      }
    }
  );

  fastify.delete(
    '/v0/management/pi/custom-models/:name',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { name } = request.params as { name: string };
      try {
        const all = await configService.getRepository().getAllPiAiCustomModels();
        if (!all[name]) {
          return reply.code(404).send({
            error: { message: `Custom model not found: ${name}`, type: 'not_found_error' },
          });
        }
        await configService.deletePiAiCustomModel(name);
        return reply.send({ success: true, name });
      } catch (e: any) {
        logger.error('Failed to delete pi-ai custom model', e);
        return reply.code(500).send({ error: { message: e.message, type: 'server_error' } });
      }
    }
  );
}
