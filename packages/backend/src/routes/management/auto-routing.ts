import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ModelConfigSchema } from '../../config';
import type { Principal } from './_principal';
import {
  AutoPreviewError,
  AutoPreviewRequestSchema,
  previewAutoRouting,
} from '../../services/routing/auto-preview';

/** Default total classification budget when the draft does not set one. */
const AUTO_PREVIEW_DEFAULT_DEADLINE_MS = 500;

/**
 * Server-derived preview scope. The principal is set by the management auth
 * hook, never by the request body. The `keyName` is hashed so no credential or
 * config identifier leaks into the scope, and the fallback keeps direct route
 * registration (e.g. tests) safely namespaced. The classifier adds its own
 * server-owned `preview` purpose discriminator, so this scope can never collide
 * with a production API key that happens to be named `admin`.
 */
function adminContextFor(request: FastifyRequest): string {
  const principal = request.principal as Principal | undefined;
  if (!principal) return 'admin-preview';
  if (principal.role === 'admin') return 'admin';
  return `limited:${createHash('sha256').update(principal.keyName).digest('hex').slice(0, 16)}`;
}

export async function registerAutoRoutingRoutes(fastify: FastifyInstance) {
  fastify.post('/v0/management/models/auto-routing/preview', async (request, reply) => {
    const parsed = AutoPreviewRequestSchema.safeParse(request.body ?? null);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation failed', details: parsed.error.issues });
    }

    const aliasParsed = ModelConfigSchema.safeParse(parsed.data.alias);
    if (!aliasParsed.success) {
      return reply
        .code(400)
        .send({ error: 'Validation failed', details: aliasParsed.error.issues });
    }

    const deadlineMs =
      aliasParsed.data.auto_routing?.classifier_deadline_ms ?? AUTO_PREVIEW_DEFAULT_DEADLINE_MS;
    const clientAbort = new AbortController();
    request.raw.once('close', () => clientAbort.abort());
    const signal = AbortSignal.any([AbortSignal.timeout(deadlineMs), clientAbort.signal]);

    try {
      const result = await previewAutoRouting(
        {
          draft: aliasParsed.data,
          aliasName: parsed.data.alias_name,
          prompt: parsed.data.prompt,
          judgmentHandle: parsed.data.judgment_handle,
          scenario: parsed.data.scenario,
          adminContext: adminContextFor(request),
        },
        { signal }
      );
      return reply.send(result);
    } catch (error) {
      if (error instanceof AutoPreviewError) {
        return reply.code(error.statusCode).send({ error: error.message, code: error.code });
      }
      const name = error instanceof Error ? error.name : '';
      if (name === 'AbortError' || name === 'TimeoutError') {
        return reply.code(499).send({
          error: 'Auto routing preview was cancelled or timed out',
          code: 'preview_cancelled',
        });
      }
      request.log.error({ err: error }, 'Auto routing preview failed');
      return reply.code(500).send({ error: 'Auto routing preview failed' });
    }
  });
}
