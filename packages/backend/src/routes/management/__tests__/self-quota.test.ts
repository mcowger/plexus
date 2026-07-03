import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import type { Principal } from '../_principal';

const mockConfigService = vi.hoisted(() => ({
  getInstance: vi.fn(),
}));

const mockGetConfig = vi.hoisted(() => vi.fn());
const mockSaveKey = vi.hoisted(() => vi.fn());

vi.mock('../../../services/config-service', () => ({
  ConfigService: {
    getInstance: vi.fn(() => ({
      getConfig: mockGetConfig,
      saveKey: mockSaveKey,
    })),
  },
}));

import { registerSelfRoutes } from '../self';

/** Registers self routes on a fresh Fastify instance with `principal`
 * pre-attached via a preHandler hook — self.ts itself does no auth, that's
 * layered on by management.ts, so tests stub it directly. */
async function buildApp(principal: Principal, quotaEnforcer?: any) {
  const fastify = Fastify();
  fastify.addHook('preHandler', async (request) => {
    request.principal = principal;
  });
  await registerSelfRoutes(fastify, quotaEnforcer);
  return fastify;
}

describe('self-service routes — quota', () => {
  beforeEach(() => {
    mockGetConfig.mockReset();
    mockSaveKey.mockReset();
  });

  describe('GET /self/me', () => {
    it('emits quotaNames (array) alongside legacy quotaName for a limited principal', async () => {
      mockGetConfig.mockReturnValue({ keys: { 'my-key': { secret: 'sk-my-key' } } });

      const principal: Principal = {
        role: 'limited',
        keyName: 'my-key',
        allowedProviders: [],
        allowedModels: [],
        excludedProviders: [],
        excludedModels: [],
        quotaNames: ['quota-a', 'quota-b'],
        quotaName: 'quota-a',
      };

      const fastify = await buildApp(principal);
      const res = await fastify.inject({ method: 'GET', url: '/v0/management/self/me' });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.quotaNames).toEqual(['quota-a', 'quota-b']);
      expect(body.quotaName).toBe('quota-a');

      await fastify.close();
    });

    it('emits an empty quotaNames array and null quotaName when the key has none', async () => {
      mockGetConfig.mockReturnValue({ keys: { 'my-key': { secret: 'sk-my-key' } } });

      const principal: Principal = {
        role: 'limited',
        keyName: 'my-key',
        allowedProviders: [],
        allowedModels: [],
        excludedProviders: [],
        excludedModels: [],
        quotaNames: [],
        quotaName: null,
      };

      const fastify = await buildApp(principal);
      const res = await fastify.inject({ method: 'GET', url: '/v0/management/self/me' });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.quotaNames).toEqual([]);
      expect(body.quotaName).toBeNull();

      await fastify.close();
    });
  });

  describe('GET /self/quota', () => {
    const principal: Principal = {
      role: 'limited',
      keyName: 'bare-key',
      allowedProviders: [],
      allowedModels: [],
      excludedProviders: [],
      excludedModels: [],
      quotaNames: [],
      quotaName: null,
    };

    it('returns array shape with source: "default" entries for a bare key with default_quotas set', async () => {
      mockGetConfig.mockReturnValue({
        keys: { 'bare-key': { secret: 'sk-bare' } },
        default_quotas: ['default-daily'],
      });

      const resetsAtMs = new Date('2026-03-01T00:00:00.000Z').getTime();
      const quotaEnforcer = {
        loadQuotaContext: vi.fn(async () => ({
          keyName: 'bare-key',
          checks: [
            {
              quotaName: 'default-daily',
              limitType: 'requests',
              limit: 100,
              currentUsage: 25,
              remaining: 75,
              allowed: true,
              resetsAtMs,
              scope: {},
              global: true,
              shared: false,
              source: 'default',
            },
          ],
          blockedGlobal: null,
        })),
      };

      const fastify = await buildApp(principal, quotaEnforcer);
      const res = await fastify.inject({ method: 'GET', url: '/v0/management/self/quota' });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.key).toBe('bare-key');
      expect(body.quotas).toHaveLength(1);
      expect(body.quotas[0]).toMatchObject({ name: 'default-daily', source: 'default' });

      // Legacy top-level fields still present, derived from the (only, hence
      // most-constrained) check.
      expect(body.quotaName).toBe('default-daily');
      expect(body.allowed).toBe(true);
      expect(body.currentUsage).toBe(25);
      expect(body.limit).toBe(100);
      expect(body.remaining).toBe(75);
      expect(body.resetsAt).toBe(new Date(resetsAtMs).toISOString());
      expect(body.limitType).toBe('requests');

      await fastify.close();
    });

    it('marks a shared def with shared: true in the array', async () => {
      mockGetConfig.mockReturnValue({
        keys: { 'bare-key': { secret: 'sk-bare' } },
        default_quotas: ['pooled-cost'],
      });

      const quotaEnforcer = {
        loadQuotaContext: vi.fn(async () => ({
          keyName: 'bare-key',
          checks: [
            {
              quotaName: 'pooled-cost',
              limitType: 'cost',
              limit: 5,
              currentUsage: 1,
              remaining: 4,
              allowed: true,
              resetsAtMs: Date.now() + 1000,
              scope: {},
              global: true,
              shared: true,
              source: 'default',
            },
          ],
          blockedGlobal: null,
        })),
      };

      const fastify = await buildApp(principal, quotaEnforcer);
      const res = await fastify.inject({ method: 'GET', url: '/v0/management/self/quota' });

      expect(res.statusCode).toBe(200);
      expect(res.json().quotas[0]).toMatchObject({ name: 'pooled-cost', shared: true });

      await fastify.close();
    });

    it('picks the most-constrained check for legacy fields when multiple quotas apply', async () => {
      mockGetConfig.mockReturnValue({
        keys: { 'multi-key': { secret: 'sk-multi', quotas: ['loose', 'tight'] } },
      });

      const resetsAtMs = Date.now() + 60_000;
      const quotaEnforcer = {
        loadQuotaContext: vi.fn(async () => ({
          keyName: 'multi-key',
          checks: [
            {
              quotaName: 'loose',
              limitType: 'requests',
              limit: 100,
              currentUsage: 10,
              remaining: 90,
              allowed: true,
              resetsAtMs,
              scope: {},
              global: true,
              shared: false,
              source: 'assigned',
            },
            {
              quotaName: 'tight',
              limitType: 'requests',
              limit: 100,
              currentUsage: 95,
              remaining: 5,
              allowed: true,
              resetsAtMs,
              scope: {},
              global: true,
              shared: false,
              source: 'assigned',
            },
          ],
          blockedGlobal: null,
        })),
      };

      const multiPrincipal: Principal = { ...principal, keyName: 'multi-key' };
      const fastify = await buildApp(multiPrincipal, quotaEnforcer);
      const res = await fastify.inject({ method: 'GET', url: '/v0/management/self/quota' });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.quotas).toHaveLength(2);
      expect(body.quotaName).toBe('tight');
      expect(body.remaining).toBe(5);

      await fastify.close();
    });

    it('returns an empty quotas array with the "no quota assigned" shim when the key has none', async () => {
      mockGetConfig.mockReturnValue({
        keys: { 'unquota-key': { secret: 'sk-unquota' } },
      });

      const unquotaPrincipal: Principal = { ...principal, keyName: 'unquota-key' };
      const fastify = await buildApp(unquotaPrincipal);
      const res = await fastify.inject({ method: 'GET', url: '/v0/management/self/quota' });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.quotas).toEqual([]);
      expect(body.quotaName).toBeNull();
      expect(body.allowed).toBe(true);

      await fastify.close();
    });
  });
});
