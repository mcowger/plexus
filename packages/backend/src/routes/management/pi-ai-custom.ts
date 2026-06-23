import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getBuiltinModel } from '@earendil-works/pi-ai/providers/all';
import type { Model as PiAiModel } from '@earendil-works/pi-ai';
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
        // Reject if any custom model is still scoped to this provider — deleting
        // would leave orphaned models that fail to resolve at runtime.
        const models = await configService.getRepository().getAllPiAiCustomModels();
        const dependents = Object.entries(models).filter(([, def]) => def.provider === name);
        if (dependents.length > 0) {
          return reply.code(409).send({
            error: {
              message: `Cannot delete provider '${name}': ${dependents.length} custom model(s) still reference it (${dependents.map(([id]) => id).join(', ')}). Delete or reassign them first.`,
              type: 'conflict_error',
            },
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
      // When a provider is set, it must reference an existing custom provider.
      if (result.data.provider) {
        const providers = await configService.getRepository().getAllPiAiCustomProviders();
        if (!providers[result.data.provider]) {
          return reply.code(400).send({
            error: {
              message: `Unknown provider '${result.data.provider}': create the custom provider first.`,
              type: 'invalid_request_error',
            },
          });
        }
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

  // ─── Registry Model (for cloning into a standalone custom model) ────────────

  fastify.get(
    '/v0/management/pi/registry-model',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { provider, model_id } = request.query as { provider?: string; model_id?: string };
      if (!provider || !model_id) {
        return reply.code(400).send({
          error: {
            message: 'Both `provider` and `model_id` query params are required.',
            type: 'invalid_request_error',
          },
        });
      }
      let model: PiAiModel<any> | null = null;
      try {
        model = getBuiltinModel(provider as any, model_id as any) ?? null;
      } catch {
        model = null;
      }
      if (!model) {
        return reply.code(404).send({
          error: {
            message: `Registry model not found: ${provider}/${model_id}`,
            type: 'not_found_error',
          },
        });
      }
      try {
        return reply.send(cloneModelToStandaloneSpec(model));
      } catch (e: any) {
        logger.error('Failed to serialize registry model', e);
        return reply.code(500).send({ error: { message: e.message, type: 'server_error' } });
      }
    }
  );
}

/**
 * Project a resolved pi-ai registry `Model` onto a standalone `PiAiCustomModel`
 * spec (no `inherits`), so the UI can clone the base into a self-contained,
 * editable custom model definition. Provider-level concerns (baseUrl, headers)
 * are intentionally omitted — they come from the Plexus provider config.
 */
function cloneModelToStandaloneSpec(model: PiAiModel<any>): Record<string, any> {
  const spec: Record<string, any> = { api: model.api };
  if (model.name) spec.name = model.name;
  if (typeof model.contextWindow === 'number') spec.contextWindow = model.contextWindow;
  if (typeof model.maxTokens === 'number') spec.maxTokens = model.maxTokens;
  if (typeof model.reasoning === 'boolean') spec.reasoning = model.reasoning;
  if (model.thinkingLevelMap) spec.thinkingLevelMap = model.thinkingLevelMap;
  if (Array.isArray(model.input)) spec.input = model.input;
  if (model.cost) spec.cost = model.cost;
  if (model.compat) spec.compat = model.compat;
  return spec;
}
