import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

const state = vi.hoisted(() => {
  const providers = new Map<string, Record<string, unknown>>();
  return {
    providers,
    getProvider: vi.fn(async (slug: string) => providers.get(slug) ?? null),
    saveProvider: vi.fn(async (slug: string, provider: Record<string, unknown>) => {
      providers.set(slug, provider);
    }),
  };
});

vi.mock('../../../services/configuration/config-service', () => ({
  ConfigService: {
    getInstance: () => ({
      getRepository: () => ({ getProvider: state.getProvider }),
      saveProvider: state.saveProvider,
    }),
  },
}));

import { registerConfigRoutes } from '../config';

const baseProvider = {
  api_base_url: { chat: 'https://example.test/v1' },
  api_key: 'sk-test',
  auto_compat: true,
};
const quirks = {
  chat: {
    api: 'openai-completions',
    compat: { maxTokensField: 'max_completion_tokens' },
    models: { 'upstream/special': { maxTokens: 64 } },
  },
};

describe('provider quirk source PATCH', () => {
  let fastify: FastifyInstance;

  beforeEach(async () => {
    state.providers.clear();
    fastify = Fastify();
    await registerConfigRoutes(fastify);
    await fastify.ready();
  });

  afterEach(async () => {
    await fastify.close();
  });

  it('preserves omitted inline quirks, clears them with null, and permits switching sources', async () => {
    const url = '/v0/management/providers/inline';
    const put = await fastify.inject({
      method: 'PUT',
      url,
      payload: { ...baseProvider, pi_ai_quirks: quirks },
    });
    expect(put.statusCode).toBe(200);

    const update = await fastify.inject({
      method: 'PATCH',
      url,
      payload: { display_name: 'Inline' },
    });
    expect(update.statusCode).toBe(200);
    expect((await fastify.inject({ method: 'GET', url })).json()).toMatchObject({
      display_name: 'Inline',
      pi_ai_quirks: quirks,
    });

    const conflict = await fastify.inject({
      method: 'PATCH',
      url,
      payload: { pi_ai_provider: 'openai' },
    });
    expect(conflict.statusCode).toBe(400);
    expect((await fastify.inject({ method: 'GET', url })).json().pi_ai_quirks).toEqual(quirks);

    const switchSource = await fastify.inject({
      method: 'PATCH',
      url,
      payload: { pi_ai_quirks: null, pi_ai_provider: 'openai' },
    });
    expect(switchSource.statusCode).toBe(200);
    expect((await fastify.inject({ method: 'GET', url })).json()).toMatchObject({
      pi_ai_provider: 'openai',
      auto_compat: true,
    });
    expect((await fastify.inject({ method: 'GET', url })).json().pi_ai_quirks).toBeUndefined();

    const clear = await fastify.inject({ method: 'PATCH', url, payload: { pi_ai_provider: null } });
    expect(clear.statusCode).toBe(200);
    const plain = (await fastify.inject({ method: 'GET', url })).json();
    expect(plain.pi_ai_provider).toBeUndefined();
    expect(plain.pi_ai_quirks).toBeUndefined();
    expect(plain.auto_compat).toBe(true); // Existing no-source settings remain valid and inert.
  });
});
