import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ConfigService } from '../../services/configuration/config-service';
import { QuotaScheduler } from '../../services/quota/quota-scheduler';
import { createMeterContext, getCheckerDefinition } from '../../services/quota/checker-registry';
import {
  runCustomChecker,
  validateCustomCheckerCode,
} from '../../services/quota/custom-checker-runtime';

const CustomCheckerSchema = z.object({
  id: z
    .string()
    .trim()
    .min(1)
    .regex(/^[a-z0-9][a-z0-9._-]*$/i),
  displayName: z.string().trim().min(1),
  code: z.string().trim().min(1),
  enabled: z.boolean().default(true),
});

const CustomCheckerUpdateSchema = CustomCheckerSchema.omit({ id: true }).partial();

function serializeChecker(row: Awaited<ReturnType<ConfigService['getCustomChecker']>>) {
  if (!row) return null;
  return {
    id: row.id,
    type: row.id,
    displayName: row.displayName,
    code: row.code,
    enabled: row.enabled,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

export async function registerCustomCheckerRoutes(
  fastify: FastifyInstance,
  quotaScheduler: QuotaScheduler
) {
  const configService = ConfigService.getInstance();

  fastify.get('/v0/management/custom-checkers', async (_request, reply) => {
    return reply.send((await configService.getCustomCheckers()).map(serializeChecker));
  });

  fastify.get('/v0/management/custom-checkers/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const checker = await configService.getCustomChecker(id);
    if (!checker) return reply.code(404).send({ error: `Custom checker '${id}' not found` });
    return reply.send(serializeChecker(checker));
  });

  fastify.put('/v0/management/custom-checkers/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = CustomCheckerSchema.safeParse({ ...(request.body as object), id });
    if (!body.success)
      return reply.code(400).send({ error: 'Validation failed', details: body.error.issues });

    try {
      validateCustomCheckerCode(body.data.code);
      const existingDefinition = getCheckerDefinition(id);
      const existing = await configService.getCustomChecker(id);
      if (existingDefinition && !existing) {
        return reply
          .code(409)
          .send({ error: `Checker type '${id}' collides with a built-in checker` });
      }
      const saved = await configService.saveCustomChecker(id, body.data);
      await configService.flush();
      return reply.send(serializeChecker(saved));
    } catch (error) {
      return reply
        .code(400)
        .send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  fastify.patch('/v0/management/custom-checkers/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = await configService.getCustomChecker(id);
    if (!existing) return reply.code(404).send({ error: `Custom checker '${id}' not found` });
    const body = CustomCheckerUpdateSchema.safeParse(request.body);
    if (!body.success)
      return reply.code(400).send({ error: 'Validation failed', details: body.error.issues });

    try {
      const next = {
        displayName: body.data.displayName ?? existing.displayName,
        code: body.data.code ?? existing.code,
        enabled: body.data.enabled ?? existing.enabled,
      };
      validateCustomCheckerCode(next.code);
      const saved = await configService.saveCustomChecker(id, next);
      await configService.flush();
      return reply.send(serializeChecker(saved));
    } catch (error) {
      return reply
        .code(400)
        .send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  fastify.delete('/v0/management/custom-checkers/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = await configService.getCustomChecker(id);
    if (!existing) return reply.code(404).send({ error: `Custom checker '${id}' not found` });
    await configService.deleteCustomChecker(id);
    await configService.flush();
    return reply.send({ success: true, id });
  });

  fastify.post('/v0/management/custom-checkers/:id/test', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = z
      .object({
        provider: z.string().trim().min(1),
        options: z.record(z.string(), z.any()).default({}),
        code: z.string().trim().min(1).optional(),
      })
      .safeParse(request.body);
    if (!body.success)
      return reply.code(400).send({ error: 'Validation failed', details: body.error.issues });
    const checker = await configService.getCustomChecker(id);
    if (!checker && !body.data.code) {
      return reply.code(404).send({ error: `Custom checker '${id}' not found` });
    }
    const code = body.data.code ?? checker?.code;
    if (!code) return reply.code(400).send({ error: 'Checker code is required' });

    try {
      const provider = await configService.getRepository().getProvider(body.data.provider);
      const options = { ...body.data.options };
      if (provider?.api_key && provider.api_key.toLowerCase() !== 'oauth') {
        options.apiKey ??= provider.api_key;
      }
      if (provider?.oauth_provider) options.oauthProvider ??= provider.oauth_provider;
      if (provider?.oauth_account) options.oauthAccountId ??= provider.oauth_account;
      const ctx = createMeterContext(`${id}:test`, body.data.provider, options);
      const meters = await runCustomChecker(code, ctx);
      return reply.send({ success: true, checkerId: id, meters });
    } catch (error) {
      return reply.code(400).send({
        success: false,
        error: error instanceof Error ? error.message : String(error),
        errorType:
          error instanceof Error && 'errorType' in error ? (error as any).errorType : 'runtime',
      });
    }
  });

  fastify.post('/v0/management/custom-checkers/:id/check', async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await quotaScheduler.runCheckNow(id);
    if (!result) return reply.code(404).send({ error: `Quota checker '${id}' not found` });
    return reply.send(result);
  });
}
