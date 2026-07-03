import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';

const serviceState = vi.hoisted(() => {
  const state = {
    quotas: {} as Record<string, any>,
    keys: {} as Record<string, any>,
    settings: {} as Record<string, unknown>,
    deleteUserQuota: vi.fn(async (name: string) => {
      delete state.quotas[name];
    }),
  };
  return state;
});

vi.mock('../../../services/config-service', () => ({
  ConfigService: {
    getInstance: vi.fn(() => ({
      deleteUserQuota: serviceState.deleteUserQuota,
      getAllSettings: vi.fn(async () => serviceState.settings),
      getRepository: vi.fn(() => ({
        getAllUserQuotas: vi.fn(async () => serviceState.quotas),
        getAllKeys: vi.fn(async () => serviceState.keys),
      })),
    })),
  },
}));

import { registerUserQuotaRoutes } from '../user-quotas';

describe('DELETE /v0/management/user-quotas/:name — in-use conflict checks', () => {
  let fastify: FastifyInstance;

  beforeEach(async () => {
    serviceState.quotas = { 'my-quota': { type: 'daily', limitType: 'requests', limit: 100 } };
    serviceState.keys = {};
    serviceState.settings = {};
    serviceState.deleteUserQuota.mockClear();

    fastify = Fastify();
    await registerUserQuotaRoutes(fastify);
    await fastify.ready();
  });

  afterEach(async () => {
    await fastify.close();
  });

  it('404s when the quota does not exist', async () => {
    const res = await fastify.inject({
      method: 'DELETE',
      url: '/v0/management/user-quotas/does-not-exist',
    });
    expect(res.statusCode).toBe(404);
  });

  it("409s when a key's `quotas` array references the quota", async () => {
    serviceState.keys = { 'some-key': { secret: 's', quotas: ['my-quota'] } };

    const res = await fastify.inject({
      method: 'DELETE',
      url: '/v0/management/user-quotas/my-quota',
    });

    expect(res.statusCode).toBe(409);
    expect(serviceState.deleteUserQuota).not.toHaveBeenCalled();
  });

  it('409s when `default_quotas` system setting references the quota', async () => {
    serviceState.settings = { default_quotas: ['my-quota'] };

    const res = await fastify.inject({
      method: 'DELETE',
      url: '/v0/management/user-quotas/my-quota',
    });

    expect(res.statusCode).toBe(409);
    expect(serviceState.deleteUserQuota).not.toHaveBeenCalled();
  });

  it('deletes successfully when unreferenced by keys or default_quotas', async () => {
    serviceState.keys = { 'some-key': { secret: 's', quotas: ['other-quota'] } };
    serviceState.settings = { default_quotas: ['other-quota'] };

    const res = await fastify.inject({
      method: 'DELETE',
      url: '/v0/management/user-quotas/my-quota',
    });

    expect(res.statusCode).toBe(200);
    expect(serviceState.deleteUserQuota).toHaveBeenCalledWith('my-quota');
  });

  it('does not 409 on a key whose `quotas` is undefined', async () => {
    serviceState.keys = { 'no-quotas-key': { secret: 's' } };

    const res = await fastify.inject({
      method: 'DELETE',
      url: '/v0/management/user-quotas/my-quota',
    });

    expect(res.statusCode).toBe(200);
  });
});
