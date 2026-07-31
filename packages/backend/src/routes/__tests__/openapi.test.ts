import Fastify from 'fastify';
import { describe, expect, test } from 'vitest';
import { registerOpenApiRoute } from '../openapi';

describe('public OpenAPI route', () => {
  test('returns the dereferenced document and supports conditional requests', async () => {
    const fastify = Fastify();
    await registerOpenApiRoute(fastify);

    const response = await fastify.inject({
      method: 'GET',
      url: '/.well-known/plexus/openapi.json',
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('application/json');
    expect(response.headers.etag).toBeDefined();
    expect(response.json()).toMatchObject({ openapi: '3.1.0' });

    const unchanged = await fastify.inject({
      method: 'GET',
      url: '/.well-known/plexus/openapi.json',
      headers: { 'if-none-match': response.headers.etag! },
    });
    expect(unchanged.statusCode).toBe(304);
    await fastify.close();
  });
});
