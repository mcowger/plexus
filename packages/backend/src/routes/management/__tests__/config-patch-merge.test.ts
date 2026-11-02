import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';

import Fastify, { type FastifyInstance } from 'fastify';

import { ConfigService } from '../../../services/configuration/config-service';

const state = (() => {
  const providers = new Map<string, Record<string, unknown>>();
  const aliases = new Map<string, Record<string, unknown>>();
  const keys = new Map<string, Record<string, unknown>>();
  const mcpServers = new Map<string, Record<string, unknown>>();
  const quotas = new Map<string, Record<string, unknown>>();

  return {
    providers,
    aliases,
    keys,
    mcpServers,
    quotas,
    reset() {
      providers.clear();
      aliases.clear();
      keys.clear();
      mcpServers.clear();
      quotas.clear();
    },
  };
})();

beforeEach(() => {
  spyOn(ConfigService, 'getInstance').mockImplementation((() => ({
    getRepository: () => ({
      getProvider: mock(async (slug: string) => state.providers.get(slug) ?? null),
      getAllAliases: mock(async () =>
        Object.fromEntries(state.aliases.entries())
      ) as unknown as () => Promise<Record<string, unknown>>,
      getAlias: mock(async (slug: string) => state.aliases.get(slug) ?? null),
      getAllKeys: mock(async () => Object.fromEntries(state.keys.entries())),
      getAllMcpServers: mock(async () => Object.fromEntries(state.mcpServers.entries())),
      getAllUserQuotas: mock(async () => Object.fromEntries(state.quotas.entries())),
    }),
    saveProvider: mock(async (slug: string, provider: Record<string, unknown>) => {
      state.providers.set(slug, provider);
    }),
    saveAlias: mock(async (slug: string, alias: Record<string, unknown>) => {
      state.aliases.set(slug, alias);
    }),
    saveKey: mock(async (name: string, key: Record<string, unknown>) => {
      state.keys.set(name, key);
    }),
    saveMcpServer: mock(async (name: string, server: Record<string, unknown>) => {
      state.mcpServers.set(name, server);
    }),
    saveUserQuota: mock(async (name: string, quota: Record<string, unknown>) => {
      state.quotas.set(name, quota);
    }),
  })) as any);
});

import { registerConfigRoutes } from '../config';
import { registerUserQuotaRoutes } from '../user-quotas';

const baseProvider = {
  api_base_url: 'https://example.test/v1',
  api_key: 'sk-test',
  headers: { 'X-Existing': 'one' },
  models: {
    'model-a': { pricing: { source: 'simple', input: 1, output: 2 } },
    'model-b': { pricing: { source: 'simple', input: 1, output: 2 } },
  },
};

describe('PATCH ?merge=deep', () => {
  let fastify: FastifyInstance;

  beforeEach(async () => {
    state.reset();
    fastify = Fastify();
    await registerConfigRoutes(fastify);
    await registerUserQuotaRoutes(fastify);
    await fastify.ready();
  });

  afterEach(async () => {
    await fastify.close();
  });

  describe('providers', () => {
    beforeEach(async () => {
      await fastify.inject({
        method: 'PUT',
        url: '/v0/management/providers/p',
        payload: baseProvider,
      });
    });

    it('adds only the models in the patch body', async () => {
      const res = await fastify.inject({
        method: 'PATCH',
        url: '/v0/management/providers/p?merge=deep',
        payload: { models: { 'model-c': {} } },
      });

      expect(res.statusCode).toBe(200);
      expect(Object.keys(state.providers.get('p')?.models as object)).toEqual([
        'model-a',
        'model-b',
        'model-c',
      ]);
    });

    it('merges nested maps such as headers one key at a time', async () => {
      const res = await fastify.inject({
        method: 'PATCH',
        url: '/v0/management/providers/p?merge=deep',
        payload: { headers: { 'X-New': 'two' } },
      });

      expect(res.statusCode).toBe(200);
      expect(state.providers.get('p')?.headers).toEqual({
        'X-Existing': 'one',
        'X-New': 'two',
      });
    });

    it('removes a single map entry sent as null', async () => {
      const res = await fastify.inject({
        method: 'PATCH',
        url: '/v0/management/providers/p?merge=deep',
        payload: { models: { 'model-a': null }, headers: { 'X-Existing': null } },
      });

      expect(res.statusCode).toBe(200);
      const stored = state.providers.get('p');
      expect(Object.keys(stored?.models as object)).toEqual(['model-b']);
      expect(stored?.headers).toEqual({});
    });

    it('still replaces the models map without the merge flag', async () => {
      // The admin UI sends the whole map and expects removals to stick.
      const res = await fastify.inject({
        method: 'PATCH',
        url: '/v0/management/providers/p',
        payload: { models: { 'model-c': {} } },
      });

      expect(res.statusCode).toBe(200);
      expect(Object.keys(state.providers.get('p')?.models as object)).toEqual(['model-c']);
    });
  });

  describe('model aliases', () => {
    beforeEach(async () => {
      await fastify.inject({
        method: 'PUT',
        url: '/v0/management/aliases/a',
        payload: {
          additional_aliases: ['old'],
          target_groups: [
            {
              name: 'default',
              selector: 'random',
              targets: [{ provider: 'p', model: 'model-a', enabled: true }],
            },
          ],
        },
      });
    });

    it('clears a field sent as null while preserving omitted fields', async () => {
      const res = await fastify.inject({
        method: 'PATCH',
        url: '/v0/management/aliases/a?merge=deep',
        payload: { additional_aliases: null },
      });

      expect(res.statusCode).toBe(200);
      const stored = state.aliases.get('a');
      expect(stored?.additional_aliases).toBeUndefined();
      expect(stored?.target_groups).toHaveLength(1);
    });

    it('replaces arrays wholesale', async () => {
      const res = await fastify.inject({
        method: 'PATCH',
        url: '/v0/management/aliases/a?merge=deep',
        payload: { additional_aliases: ['new'] },
      });

      expect(res.statusCode).toBe(200);
      expect(state.aliases.get('a')?.additional_aliases).toEqual(['new']);
    });
  });

  describe('keys', () => {
    beforeEach(async () => {
      await fastify.inject({
        method: 'PUT',
        url: '/v0/management/keys/k',
        payload: { secret: 'sk-key', comment: 'keep me', quotas: ['daily'] },
      });
    });

    it('preserves fields the patch does not mention', async () => {
      const res = await fastify.inject({
        method: 'PATCH',
        url: '/v0/management/keys/k?merge=deep',
        payload: { allowRawPassthrough: true },
      });

      expect(res.statusCode).toBe(200);
      expect(state.keys.get('k')).toMatchObject({
        comment: 'keep me',
        quotas: ['daily'],
        allowRawPassthrough: true,
      });
    });

    it('removes a field sent as null', async () => {
      const res = await fastify.inject({
        method: 'PATCH',
        url: '/v0/management/keys/k?merge=deep',
        payload: { quotas: null },
      });

      expect(res.statusCode).toBe(200);
      expect(state.keys.get('k')?.quotas).toBeUndefined();
    });
  });

  describe('MCP servers', () => {
    beforeEach(async () => {
      await fastify.inject({
        method: 'PUT',
        url: '/v0/management/mcp-servers/srv',
        payload: {
          upstream_url: 'https://mcp.example.test/mcp',
          enabled: true,
          headers: { 'X-Existing': 'one' },
        },
      });
    });

    it('merges nested maps instead of replacing them', async () => {
      const res = await fastify.inject({
        method: 'PATCH',
        url: '/v0/management/mcp-servers/srv?merge=deep',
        payload: { headers: { 'X-New': 'two' } },
      });

      expect(res.statusCode).toBe(200);
      expect(state.mcpServers.get('srv')?.headers).toEqual({
        'X-Existing': 'one',
        'X-New': 'two',
      });
    });
  });

  describe('user quotas', () => {
    beforeEach(async () => {
      await fastify.inject({
        method: 'PUT',
        url: '/v0/management/user-quotas/qq',
        payload: { type: 'daily', limitType: 'requests', limit: 100, allowedModels: ['a'] },
      });
    });

    it('merges omitted fields and clears null ones', async () => {
      const res = await fastify.inject({
        method: 'PATCH',
        url: '/v0/management/user-quotas/qq?merge=deep',
        payload: { limit: 50, allowedModels: null },
      });

      expect(res.statusCode).toBe(200);
      expect(state.quotas.get('qq')).toMatchObject({
        type: 'daily',
        limitType: 'requests',
        limit: 50,
      });
      expect(state.quotas.get('qq')?.allowedModels).toBeUndefined();
    });
  });
});
