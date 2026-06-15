import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';

const serviceState = vi.hoisted(() => {
  const state = {
    trustedProxies: ['0.0.0.0/0', '::/0'] as string[],
    setSetting: vi.fn(async (key: string, value: unknown) => {
      if (key === 'trustedProxies') {
        state.trustedProxies = value as string[];
      }
    }),
    getTrustedProxies: vi.fn(async () => state.trustedProxies),
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
        getTrustedProxies: serviceState.getTrustedProxies,
      })),
    })),
  },
}));

import { registerConfigRoutes } from '../config';

describe('trusted proxy config routes', () => {
  let fastify: FastifyInstance;

  beforeEach(async () => {
    serviceState.trustedProxies = ['0.0.0.0/0', '::/0'];
    serviceState.setSetting.mockClear();
    serviceState.getTrustedProxies.mockClear();
    serviceState.getConfig.mockClear();

    fastify = Fastify();
    await registerConfigRoutes(fastify);
    await fastify.ready();
  });

  afterEach(async () => {
    await fastify.close();
  });

  it('returns the current trusted proxy list', async () => {
    const res = await fastify.inject({
      method: 'GET',
      url: '/v0/management/config/trusted-proxies',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ trustedProxies: ['0.0.0.0/0', '::/0'] });
  });

  it('normalizes whitespace and persists trimmed entries', async () => {
    const res = await fastify.inject({
      method: 'PATCH',
      url: '/v0/management/config/trusted-proxies',
      payload: {
        trustedProxies: [' 1.2.3.4 ', ' ', ' 10.0.0.0/8 '],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(serviceState.setSetting).toHaveBeenCalledWith('trustedProxies', [
      '1.2.3.4',
      '10.0.0.0/8',
    ]);
    expect(res.json()).toEqual({ trustedProxies: ['1.2.3.4', '10.0.0.0/8'] });
  });

  it('rejects invalid trusted proxy rules', async () => {
    const res = await fastify.inject({
      method: 'PATCH',
      url: '/v0/management/config/trusted-proxies',
      payload: {
        trustedProxies: ['not-an-ip'],
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('Invalid IP rule: not-an-ip');
    expect(serviceState.setSetting).not.toHaveBeenCalled();
  });

  it('preserves an explicit empty list as trust no proxies', async () => {
    const patchRes = await fastify.inject({
      method: 'PATCH',
      url: '/v0/management/config/trusted-proxies',
      payload: {
        trustedProxies: [],
      },
    });

    expect(patchRes.statusCode).toBe(200);
    expect(patchRes.json()).toEqual({ trustedProxies: [] });

    const getRes = await fastify.inject({
      method: 'GET',
      url: '/v0/management/config/trusted-proxies',
    });

    expect(getRes.statusCode).toBe(200);
    expect(getRes.json()).toEqual({ trustedProxies: [] });
  });
});
