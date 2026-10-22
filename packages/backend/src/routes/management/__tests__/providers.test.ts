import { afterEach, beforeEach, describe, expect, it, spyOn, test } from 'bun:test';

import Fastify, { type FastifyInstance } from 'fastify';

import { registerProviderRoutes } from '../providers';

describe('management provider routes', () => {
  let fastify: FastifyInstance;

  beforeEach(async () => {
    fastify = Fastify();
    await registerProviderRoutes(fastify);
    await fastify.ready();
  });

  afterEach(async () => {
    await fastify.close();
  });

  it('does not expose an upstream unauthorized response as a management auth failure', async () => {
    spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ type: 'error', error: { type: 'authentication_error' } }), {
        status: 401,
        statusText: 'Unauthorized',
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const response = await fastify.inject({
      method: 'POST',
      url: '/v0/management/providers/fetch-models',
      payload: {
        url: 'https://api.anthropic.com/v1/models',
        apiKey: 'sk-ant-test',
      },
    });

    expect(response.statusCode).toBe(502);
    expect(response.json()).toMatchObject({
      error: {
        message: 'Provider returned 401: Unauthorized',
        type: 'provider_error',
        code: 401,
      },
    });
  });
});
