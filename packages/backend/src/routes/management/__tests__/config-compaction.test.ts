import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';

const serviceState = vi.hoisted(() => {
  const state = {
    compaction: {} as Record<string, unknown>,
    setSetting: vi.fn(async (key: string, value: unknown) => {
      if (key === 'compaction') {
        state.compaction = value as Record<string, unknown>;
      }
    }),
    getCompactionConfig: vi.fn(async () => state.compaction),
    getConfig: vi.fn(() => ({ providers: {} })),
  };
  return state;
});

vi.mock('../../../services/config-service', () => ({
  ConfigService: {
    getInstance: vi.fn(() => ({
      setSetting: serviceState.setSetting,
      getConfig: serviceState.getConfig,
      getRepository: vi.fn(() => ({
        getCompactionConfig: serviceState.getCompactionConfig,
      })),
    })),
  },
}));

import { registerConfigRoutes } from '../config';

describe('compaction config routes', () => {
  let fastify: FastifyInstance;

  beforeEach(async () => {
    serviceState.compaction = {};
    serviceState.setSetting.mockClear();
    serviceState.getCompactionConfig.mockClear();
    serviceState.getConfig.mockClear();

    fastify = Fastify();
    await registerConfigRoutes(fastify);
    await fastify.ready();
  });

  afterEach(async () => {
    await fastify.close();
  });

  it('GET default: returns {} when nothing stored', async () => {
    const res = await fastify.inject({
      method: 'GET',
      url: '/v0/management/config/compaction',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({});
  });

  it('PATCH valid: stores and returns compaction config', async () => {
    const payload = { enabled: true, strategy: 'native', triggerRatio: 0.7 };
    const patchRes = await fastify.inject({
      method: 'PATCH',
      url: '/v0/management/config/compaction',
      payload,
    });

    expect(patchRes.statusCode).toBe(200);
    expect(patchRes.json()).toMatchObject(payload);

    const getRes = await fastify.inject({
      method: 'GET',
      url: '/v0/management/config/compaction',
    });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.json()).toMatchObject(payload);
  });

  it('PATCH invalid: triggerRatio out of range returns 400', async () => {
    const res = await fastify.inject({
      method: 'PATCH',
      url: '/v0/management/config/compaction',
      payload: { triggerRatio: 2 },
    });

    expect(res.statusCode).toBe(400);
    expect(serviceState.setSetting).not.toHaveBeenCalled();
  });

  it('PATCH merge: preserves prior fields when patching new ones', async () => {
    // Set initial value
    await fastify.inject({
      method: 'PATCH',
      url: '/v0/management/config/compaction',
      payload: { enabled: true },
    });

    // Patch with a new field
    const mergeRes = await fastify.inject({
      method: 'PATCH',
      url: '/v0/management/config/compaction',
      payload: { strategy: 'headroom' },
    });

    expect(mergeRes.statusCode).toBe(200);
    const body = mergeRes.json();
    expect(body.enabled).toBe(true);
    expect(body.strategy).toBe('headroom');
  });

  it('PATCH non-object body returns 400', async () => {
    const res = await fastify.inject({
      method: 'PATCH',
      url: '/v0/management/config/compaction',
      payload: 'not-an-object',
      headers: { 'content-type': 'application/json' },
    });

    // Fastify will likely parse-fail or we hit our guard
    expect(res.statusCode).toBe(400);
  });
});
