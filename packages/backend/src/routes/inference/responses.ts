import { FastifyInstance } from 'fastify';

export async function registerResponsesRoute(fastify: FastifyInstance) {
    // Responses API Placeholder
    fastify.post('/v1/responses', async (request, reply) => {
         return reply.code(501).send({ error: "Not implemented" });
    });
}
