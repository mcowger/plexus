import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import openApi from '../assets/openapi.json' with { type: 'json' };

const body = JSON.stringify(openApi);
const etag = `"${createHash('sha256').update(body).digest('base64url')}"`;

export async function registerOpenApiRoute(fastify: FastifyInstance) {
  fastify.get('/.well-known/plexus/openapi.json', (request, reply) => {
    if (request.headers['if-none-match'] === etag) {
      return reply.code(304).header('ETag', etag).send();
    }

    return reply
      .header('Cache-Control', 'public, max-age=300, must-revalidate')
      .header('ETag', etag)
      .type('application/json; charset=utf-8')
      .send(body);
  });
}
