import { FastifyInstance } from 'fastify';
import { CooldownManager } from '../../services/cooldown-manager';

export async function registerCooldownRoutes(fastify: FastifyInstance) {
    fastify.get('/v0/management/cooldowns', (request, reply) => {
        const cooldowns = CooldownManager.getInstance().getCooldowns();
        return reply.send(cooldowns);
    });

    fastify.delete('/v0/management/cooldowns', (request, reply) => {
        CooldownManager.getInstance().clearCooldown();
        return reply.send({ success: true });
    });

    fastify.delete('/v0/management/cooldowns/:provider', (request, reply) => {
        const params = request.params as any;
        const provider = params.provider;
        CooldownManager.getInstance().clearCooldown(provider);
        return reply.send({ success: true });
    });
}
