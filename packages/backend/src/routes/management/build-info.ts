import { FastifyInstance } from 'fastify';
import { getBuildInfo } from '../../utils/build-info';

export async function registerBuildInfoRoutes(fastify: FastifyInstance) {
    fastify.get('/v0/management/build', async (request, reply) => {
        return reply.send(getBuildInfo());
    });
}
