import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { registerModelRoutes } from '../models';
import { ModelMetadataManager } from '../../../services/models/model-metadata-manager';

// NOTE: @earendil-works/pi-ai is globally mocked (see test/vitest.setup.ts):
// getBuiltinProviders() returns ['anthropic', 'openai-codex', 'openai',
// 'google', 'meta'] and getProviders() returns id-only stubs without baseUrl,
// so endpoint matching resolves to null here — URL semantics are covered by
// provider-endpoint-match.test.ts. These tests cover the HTTP contract plus
// the OAuth-id fast path, which only needs the id list.

describe('POST /v0/management/pi/resolve-provider', () => {
  let fastify: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    ModelMetadataManager.resetForTesting();
    fastify = Fastify();
    await registerModelRoutes(fastify);
  });

  afterEach(async () => {
    await fastify.close();
    ModelMetadataManager.resetForTesting();
  });

  test('resolves a known OAuth provider id to itself', async () => {
    const response = await fastify.inject({
      method: 'POST',
      url: '/v0/management/pi/resolve-provider',
      payload: { oauthProvider: 'openai-codex' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ data: { provider: 'openai-codex' } });
  });

  test('returns null when nothing matches', async () => {
    const response = await fastify.inject({
      method: 'POST',
      url: '/v0/management/pi/resolve-provider',
      payload: { urls: ['https://unknown.example.com/v1'] },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ data: { provider: null } });
  });

  test('treats a missing body as no match rather than an error', async () => {
    const response = await fastify.inject({
      method: 'POST',
      url: '/v0/management/pi/resolve-provider',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ data: { provider: null } });
  });

  test('rejects malformed bodies', async () => {
    const response = await fastify.inject({
      method: 'POST',
      url: '/v0/management/pi/resolve-provider',
      payload: { urls: 'https://api.openai.com/v1' },
    });

    expect(response.statusCode).toBe(400);
  });
});
