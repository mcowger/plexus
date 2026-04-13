import { FastifyInstance } from 'fastify';
import { CooldownManager } from '../../services/cooldown-manager';
import { logger } from '../../utils/logger';
import { isLimited } from './_principal';

export async function registerCooldownRoutes(fastify: FastifyInstance) {
  // Read-only view is available to both admin and limited users; cooldown data
  // is provider-level (not per-key) but useful for debugging request failures.
  fastify.get('/v0/management/cooldowns', (request, reply) => {
    const cooldowns = CooldownManager.getInstance().getCooldowns();
    return reply.send(cooldowns);
  });

  // Clearing ALL cooldowns is admin-only — too broad a blast radius to expose
  // to a limited user.
  fastify.delete('/v0/management/cooldowns', (request, reply) => {
    if (isLimited(request)) {
      return reply.code(403).send({ error: 'Admin privileges required' });
    }
    CooldownManager.getInstance().clearCooldown();
    logger.info('[AUDIT] admin cleared all cooldowns');
    return reply.send({ success: true });
  });

  // Per-provider clear: admin may clear any; a limited user may only clear a
  // provider that their api_key is explicitly allowed to use. If their
  // allowedProviders list is empty, the convention elsewhere in the codebase
  // is "any provider is allowed" — honor that here.
  fastify.delete('/v0/management/cooldowns/:provider', (request, reply) => {
    const params = request.params as any;
    const query = request.query as any;
    const provider = params.provider as string;
    const model = query.model as string | undefined;

    const principal = request.principal!;
    if (principal.role === 'limited') {
      const allowed = principal.allowedProviders ?? [];
      if (allowed.length > 0 && !allowed.includes(provider)) {
        return reply.code(403).send({
          error: {
            message: `Your API key is not permitted to clear cooldowns for provider '${provider}'`,
            type: 'forbidden',
            code: 403,
          },
        });
      }
      logger.info(
        `[AUDIT] limited user '${principal.keyName}' cleared cooldown for provider='${provider}' model='${model ?? '*'}'`
      );
    } else {
      logger.info(
        `[AUDIT] admin cleared cooldown for provider='${provider}' model='${model ?? '*'}'`
      );
    }

    CooldownManager.getInstance().clearCooldown(provider, model);
    return reply.send({ success: true });
  });
}
