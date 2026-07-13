import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';

const serviceState = vi.hoisted(() => {
  const state = {
    keys: {} as Record<string, any>,
    saveKey: vi.fn(async (name: string, config: any) => {
      state.keys[name] = config;
    }),
    disableTimeBoundKey: vi.fn(async (name: string) => {
      const key = state.keys[name];
      if (!key?.expiresAt) return false;
      state.keys[name] = { ...key, disabledAt: Date.now() };
      return true;
    }),
  };
  return state;
});

vi.mock('../../../services/config-service', () => ({
  ConfigService: {
    getInstance: vi.fn(() => ({
      saveKey: serviceState.saveKey,
      disableTimeBoundKey: serviceState.disableTimeBoundKey,
      getRepository: vi.fn(() => ({
        getAllKeys: vi.fn(async () => serviceState.keys),
      })),
    })),
  },
}));

import { registerConfigRoutes } from '../config';

describe('key routes — multi-quota compat', () => {
  let fastify: FastifyInstance;

  beforeEach(async () => {
    serviceState.keys = {};
    serviceState.saveKey.mockClear();
    serviceState.disableTimeBoundKey.mockClear();

    fastify = Fastify();
    await registerConfigRoutes(fastify);
    await fastify.ready();
  });

  afterEach(async () => {
    await fastify.close();
  });

  describe('GET key endpoints', () => {
    it('GET /v0/management/keys returns `quotas` as-is', async () => {
      serviceState.keys['compat-key'] = {
        secret: 'sk-compat',
        quotas: ['quota-a', 'quota-b'],
      };

      const res = await fastify.inject({ method: 'GET', url: '/v0/management/keys' });

      expect(res.statusCode).toBe(200);
      const body = res.json() as Record<string, any>;
      expect(body['compat-key'].quotas).toEqual(['quota-a', 'quota-b']);
      expect(body['compat-key']).not.toHaveProperty('quota');
    });

    it('GET /v0/management/keys/:name returns `quotas` as-is', async () => {
      serviceState.keys['compat-key-2'] = {
        secret: 'sk-compat-2',
        quotas: ['quota-x'],
      };

      const res = await fastify.inject({
        method: 'GET',
        url: '/v0/management/keys/compat-key-2',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as Record<string, any>;
      expect(body.quotas).toEqual(['quota-x']);
      expect(body).not.toHaveProperty('quota');
    });
  });

  describe('PUT /v0/management/keys/:name', () => {
    it('rejects a key name containing "*" with 400', async () => {
      const res = await fastify.inject({
        method: 'PUT',
        url: '/v0/management/keys/wild*card',
        payload: { secret: 'sk-test' },
      });

      expect(res.statusCode).toBe(400);
      expect(serviceState.saveKey).not.toHaveBeenCalled();
    });

    it('rejects a key name that is only "*" with 400', async () => {
      const res = await fastify.inject({
        method: 'PUT',
        url: '/v0/management/keys/*',
        payload: { secret: 'sk-test' },
      });

      expect(res.statusCode).toBe(400);
      expect(serviceState.saveKey).not.toHaveBeenCalled();
    });

    it('accepts a key name without "*"', async () => {
      const res = await fastify.inject({
        method: 'PUT',
        url: '/v0/management/keys/normal-key',
        payload: { secret: 'sk-test' },
      });

      expect(res.statusCode).toBe(200);
      expect(serviceState.saveKey).toHaveBeenCalledWith('normal-key', expect.any(Object));
    });

    it('accepts a positive whole-minute expiry when creating a key', async () => {
      const res = await fastify.inject({
        method: 'PUT',
        url: '/v0/management/keys/time-bound-key',
        payload: { secret: 'sk-test', expiresInMinutes: 60 },
      });

      expect(res.statusCode).toBe(200);
      expect(serviceState.keys['time-bound-key']?.expiresInMinutes).toBe(60);
    });

    it('rejects expiry changes for an existing key', async () => {
      serviceState.keys['existing-expiry-key'] = {
        secret: 'sk-existing',
        expiresAt: Date.now() + 60_000,
      };

      const res = await fastify.inject({
        method: 'PUT',
        url: '/v0/management/keys/existing-expiry-key',
        payload: { secret: 'sk-existing', expiresInMinutes: 60 },
      });

      expect(res.statusCode).toBe(400);
      expect(serviceState.saveKey).not.toHaveBeenCalled();
    });

    it('normalizes a legacy `quota` body field to `quotas` on save', async () => {
      const res = await fastify.inject({
        method: 'PUT',
        url: '/v0/management/keys/legacy-quota-key',
        payload: { secret: 'sk-test', quota: 'my-quota' },
      });

      expect(res.statusCode).toBe(200);
      expect(serviceState.keys['legacy-quota-key']?.quotas).toEqual(['my-quota']);
    });
  });

  describe('PATCH /v0/management/keys/:name', () => {
    it("a legacy-format `quota` patch replaces the key's existing `quotas`", async () => {
      serviceState.keys['existing-key'] = {
        secret: 'sk-existing',
        quotas: ['old-quota'],
      };

      const res = await fastify.inject({
        method: 'PATCH',
        url: '/v0/management/keys/existing-key',
        payload: { quota: 'new-quota' },
      });

      expect(res.statusCode).toBe(200);
      expect(serviceState.keys['existing-key']?.quotas).toEqual(['new-quota']);
    });

    it('an explicit `quotas` patch still wins over a simultaneous legacy `quota` field', async () => {
      serviceState.keys['existing-key-2'] = {
        secret: 'sk-existing-2',
        quotas: ['old-quota'],
      };

      const res = await fastify.inject({
        method: 'PATCH',
        url: '/v0/management/keys/existing-key-2',
        payload: { quota: 'legacy-quota', quotas: ['explicit-quota'] },
      });

      expect(res.statusCode).toBe(200);
      expect(serviceState.keys['existing-key-2']?.quotas).toEqual(['explicit-quota']);
    });

    it('a patch unrelated to quotas leaves existing `quotas` untouched', async () => {
      serviceState.keys['existing-key-3'] = {
        secret: 'sk-existing-3',
        quotas: ['stays-the-same'],
      };

      const res = await fastify.inject({
        method: 'PATCH',
        url: '/v0/management/keys/existing-key-3',
        payload: { comment: 'updated comment' },
      });

      expect(res.statusCode).toBe(200);
      expect(serviceState.keys['existing-key-3']?.quotas).toEqual(['stays-the-same']);
      expect(serviceState.keys['existing-key-3']?.comment).toBe('updated comment');
    });

    it('returns 404 for a PATCH to a nonexistent key', async () => {
      const res = await fastify.inject({
        method: 'PATCH',
        url: '/v0/management/keys/does-not-exist',
        payload: { comment: 'x' },
      });

      expect(res.statusCode).toBe(404);
    });

    it('rejects expiry changes through PATCH', async () => {
      serviceState.keys['existing-expiry-key'] = {
        secret: 'sk-existing',
        expiresAt: Date.now() + 60_000,
      };

      const res = await fastify.inject({
        method: 'PATCH',
        url: '/v0/management/keys/existing-expiry-key',
        payload: { expiresInMinutes: 60 },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  describe('POST /v0/management/keys/:name/disable', () => {
    it('disables a time-bound key', async () => {
      serviceState.keys['time-bound-key'] = { secret: 'sk-test', expiresAt: Date.now() + 60_000 };

      const res = await fastify.inject({
        method: 'POST',
        url: '/v0/management/keys/time-bound-key/disable',
      });

      expect(res.statusCode).toBe(200);
      expect(serviceState.disableTimeBoundKey).toHaveBeenCalledWith('time-bound-key');
    });

    it('rejects disabling a non-expiring key', async () => {
      serviceState.keys['permanent-key'] = { secret: 'sk-test' };

      const res = await fastify.inject({
        method: 'POST',
        url: '/v0/management/keys/permanent-key/disable',
      });

      expect(res.statusCode).toBe(400);
    });
  });
});
