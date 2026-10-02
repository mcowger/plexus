import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';

const serviceState = vi.hoisted(() => {
  const state = {
    keys: {} as Record<string, any>,
    saveKey: vi.fn(async (name: string, config: any) => {
      state.keys[name] = config;
    }),
  };
  return state;
});

vi.mock('../../../services/configuration/config-service', () => ({
  ConfigService: {
    getInstance: vi.fn(() => ({
      saveKey: serviceState.saveKey,
      getRepository: vi.fn(() => ({
        getAllKeys: vi.fn(async () => serviceState.keys),
      })),
    })),
  },
}));

import { registerConfigRoutes } from '../config';

describe('key routes — defaultServiceTier', () => {
  let fastify: FastifyInstance;

  beforeEach(async () => {
    serviceState.keys = {};
    serviceState.saveKey.mockClear();

    fastify = Fastify();
    await registerConfigRoutes(fastify);
    await fastify.ready();
  });

  afterEach(async () => {
    await fastify.close();
  });

  it('PUT persists an explicit defaultServiceTier', async () => {
    const res = await fastify.inject({
      method: 'PUT',
      url: '/v0/management/keys/tier-key',
      payload: { secret: 'sk-tier', defaultServiceTier: 'flex' },
    });

    expect(res.statusCode).toBe(200);
    expect(serviceState.keys['tier-key']?.defaultServiceTier).toBe('flex');
  });

  it('PUT omitting defaultServiceTier leaves it undefined (clears on save)', async () => {
    const res = await fastify.inject({
      method: 'PUT',
      url: '/v0/management/keys/plain-key',
      payload: { secret: 'sk-plain' },
    });

    expect(res.statusCode).toBe(200);
    expect(serviceState.keys['plain-key']).not.toHaveProperty('defaultServiceTier');
  });

  it('PUT rejects an unknown tier with 400', async () => {
    const res = await fastify.inject({
      method: 'PUT',
      url: '/v0/management/keys/bad-tier-key',
      payload: { secret: 'sk-bad', defaultServiceTier: 'turbo' },
    });

    expect(res.statusCode).toBe(400);
    expect(serviceState.saveKey).not.toHaveBeenCalled();
  });

  it('PATCH preserves the existing tier when the patch omits it', async () => {
    serviceState.keys['existing-tier-key'] = {
      secret: 'sk-existing',
      defaultServiceTier: 'priority',
    };

    const res = await fastify.inject({
      method: 'PATCH',
      url: '/v0/management/keys/existing-tier-key',
      payload: { comment: 'updated' },
    });

    expect(res.statusCode).toBe(200);
    expect(serviceState.keys['existing-tier-key']?.defaultServiceTier).toBe('priority');
    expect(serviceState.keys['existing-tier-key']?.comment).toBe('updated');
  });

  it('PATCH replaces the existing tier when provided', async () => {
    serviceState.keys['existing-tier-key-2'] = {
      secret: 'sk-existing-2',
      defaultServiceTier: 'priority',
    };

    const res = await fastify.inject({
      method: 'PATCH',
      url: '/v0/management/keys/existing-tier-key-2',
      payload: { defaultServiceTier: 'ultrafast' },
    });

    expect(res.statusCode).toBe(200);
    expect(serviceState.keys['existing-tier-key-2']?.defaultServiceTier).toBe('ultrafast');
  });

  it('PATCH accepts null to clear the tier without replacing other key settings', async () => {
    serviceState.keys['clear-tier-key'] = {
      secret: 'sk-clear',
      comment: 'keep this comment',
      allowedModels: ['model-a'],
      defaultServiceTier: 'priority',
    };

    const res = await fastify.inject({
      method: 'PATCH',
      url: '/v0/management/keys/clear-tier-key',
      payload: { defaultServiceTier: null },
    });

    expect(res.statusCode).toBe(200);
    expect(serviceState.keys['clear-tier-key']).toEqual({
      secret: 'sk-clear',
      comment: 'keep this comment',
      allowedModels: ['model-a'],
      defaultServiceTier: null,
    });
  });
});
