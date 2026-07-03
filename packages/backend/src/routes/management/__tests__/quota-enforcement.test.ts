import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';

const mockConfigService = vi.hoisted(() => ({
  flush: vi.fn(),
  getConfig: vi.fn(),
}));

vi.mock('../../../services/config-service', () => ({
  ConfigService: {
    getInstance: vi.fn(() => mockConfigService),
  },
}));

import { registerQuotaEnforcementRoutes } from '../quota-enforcement';

describe('quota enforcement management routes', () => {
  beforeEach(() => {
    mockConfigService.flush.mockReset();
    mockConfigService.getConfig.mockReset();
  });

  it('flushes ConfigService before checking quota status for newly saved keys', async () => {
    const fastify = Fastify();
    let flushed = false;

    mockConfigService.flush.mockImplementation(async () => {
      flushed = true;
    });
    mockConfigService.getConfig.mockImplementation(() => ({
      keys: flushed
        ? {
            'new-key': {
              secret: 'sk-new-key',
              quotas: ['new-quota'],
            },
          }
        : {},
      user_quotas: flushed
        ? {
            'new-quota': {
              type: 'rolling',
              duration: '1h',
              limitType: 'requests',
              limit: 10,
            },
          }
        : {},
    }));

    const quotaEnforcer = {
      loadQuotaContext: vi.fn(async () => ({
        keyName: 'new-key',
        checks: [
          {
            quotaName: 'new-quota',
            limitType: 'requests',
            limit: 10,
            currentUsage: 0,
            remaining: 10,
            allowed: true,
            resetsAtMs: new Date('2026-01-01T00:00:00.000Z').getTime(),
            scope: {},
            global: true,
            shared: false,
            source: 'assigned',
          },
        ],
        blockedGlobal: null,
      })),
      clearQuota: vi.fn(),
      recomputeQuota: vi.fn(),
    };

    await registerQuotaEnforcementRoutes(fastify, quotaEnforcer as any);

    const res = await fastify.inject({
      method: 'GET',
      url: '/v0/management/quota/status/new-key',
    });

    expect(res.statusCode).toBe(200);
    expect(mockConfigService.flush.mock.invocationCallOrder[0]).toBeLessThan(
      mockConfigService.getConfig.mock.invocationCallOrder[0]!
    );
    expect(quotaEnforcer.loadQuotaContext).toHaveBeenCalledWith('new-key');
    expect(res.json()).toEqual({
      key: 'new-key',
      quotas: [
        {
          name: 'new-quota',
          limitType: 'requests',
          limit: 10,
          currentUsage: 0,
          remaining: 10,
          allowed: true,
          resetsAt: '2026-01-01T00:00:00.000Z',
          scope: {},
          global: true,
          shared: false,
          source: 'assigned',
        },
      ],
      quota_name: 'new-quota',
      allowed: true,
      current_usage: 0,
      limit: 10,
      remaining: 10,
      resets_at: '2026-01-01T00:00:00.000Z',
    });

    await fastify.close();
  });

  describe('GET /quota/status/:key array shape', () => {
    it('includes default-sourced and shared entries, and legacy fields from the most-constrained check', async () => {
      const fastify = Fastify();
      mockConfigService.flush.mockResolvedValue(undefined);
      mockConfigService.getConfig.mockReturnValue({
        keys: { 'bare-key': { secret: 'sk-bare' } },
      });

      const resetsAtMs = new Date('2026-02-01T00:00:00.000Z').getTime();
      const quotaEnforcer = {
        loadQuotaContext: vi.fn(async () => ({
          keyName: 'bare-key',
          checks: [
            {
              quotaName: 'default-daily',
              limitType: 'requests',
              limit: 100,
              currentUsage: 90,
              remaining: 10,
              allowed: true,
              resetsAtMs,
              scope: {},
              global: true,
              shared: false,
              source: 'default',
            },
            {
              quotaName: 'pooled-cost',
              limitType: 'cost',
              limit: 5,
              currentUsage: 1,
              remaining: 4,
              allowed: true,
              resetsAtMs,
              scope: { allowedProviders: ['openai'] },
              global: false,
              shared: true,
              source: 'default',
            },
          ],
          blockedGlobal: null,
        })),
        clearQuota: vi.fn(),
        recomputeQuota: vi.fn(),
      };

      await registerQuotaEnforcementRoutes(fastify, quotaEnforcer as any);

      const res = await fastify.inject({
        method: 'GET',
        url: '/v0/management/quota/status/bare-key',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.quotas).toHaveLength(2);
      expect(body.quotas[0]).toMatchObject({ name: 'default-daily', source: 'default' });
      expect(body.quotas[1]).toMatchObject({
        name: 'pooled-cost',
        source: 'default',
        shared: true,
        scope: { allowedProviders: ['openai'] },
      });

      // Legacy top-level fields derived from the most-constrained check
      // (smallest remaining/limit ratio): default-daily @ 10/100 = 0.1,
      // pooled-cost @ 4/5 = 0.8 → default-daily wins.
      expect(body.quota_name).toBe('default-daily');
      expect(body.current_usage).toBe(90);
      expect(body.limit).toBe(100);
      expect(body.remaining).toBe(10);
      expect(body.resets_at).toBe(new Date(resetsAtMs).toISOString());

      await fastify.close();
    });

    it('returns 404 for an unknown key', async () => {
      const fastify = Fastify();
      mockConfigService.flush.mockResolvedValue(undefined);
      mockConfigService.getConfig.mockReturnValue({ keys: {} });
      const quotaEnforcer = {
        loadQuotaContext: vi.fn(),
        clearQuota: vi.fn(),
        recomputeQuota: vi.fn(),
      };

      await registerQuotaEnforcementRoutes(fastify, quotaEnforcer as any);
      const res = await fastify.inject({
        method: 'GET',
        url: '/v0/management/quota/status/nope',
      });

      expect(res.statusCode).toBe(404);
      await fastify.close();
    });
  });

  describe('POST /quota/clear', () => {
    it('clears all attached quotas when quota is omitted', async () => {
      const fastify = Fastify();
      mockConfigService.flush.mockResolvedValue(undefined);
      mockConfigService.getConfig.mockReturnValue({
        keys: { 'my-key': { secret: 'sk', quotas: ['q1', 'q2'] } },
      });
      const quotaEnforcer = {
        loadQuotaContext: vi.fn(),
        clearQuota: vi.fn(),
        recomputeQuota: vi.fn(),
      };

      await registerQuotaEnforcementRoutes(fastify, quotaEnforcer as any);
      const res = await fastify.inject({
        method: 'POST',
        url: '/v0/management/quota/clear',
        payload: { key: 'my-key' },
      });

      expect(res.statusCode).toBe(200);
      expect(quotaEnforcer.clearQuota).toHaveBeenCalledWith('my-key', undefined);
      expect(res.json()).toEqual({
        success: true,
        key: 'my-key',
        quota: null,
        message: 'Quota reset successfully',
      });

      await fastify.close();
    });

    it('clears a single attached quota by name', async () => {
      const fastify = Fastify();
      mockConfigService.flush.mockResolvedValue(undefined);
      mockConfigService.getConfig.mockReturnValue({
        keys: { 'my-key': { secret: 'sk', quotas: ['q1', 'q2'] } },
      });
      const quotaEnforcer = {
        loadQuotaContext: vi.fn(),
        clearQuota: vi.fn(),
        recomputeQuota: vi.fn(),
      };

      await registerQuotaEnforcementRoutes(fastify, quotaEnforcer as any);
      const res = await fastify.inject({
        method: 'POST',
        url: '/v0/management/quota/clear',
        payload: { key: 'my-key', quota: 'q2' },
      });

      expect(res.statusCode).toBe(200);
      expect(quotaEnforcer.clearQuota).toHaveBeenCalledWith('my-key', 'q2');
      expect(res.json()).toMatchObject({ success: true, key: 'my-key', quota: 'q2' });

      await fastify.close();
    });

    it('validates a bare key against default_quotas when clearing by name', async () => {
      const fastify = Fastify();
      mockConfigService.flush.mockResolvedValue(undefined);
      mockConfigService.getConfig.mockReturnValue({
        keys: { 'bare-key': { secret: 'sk' } },
        default_quotas: ['def-quota'],
      });
      const quotaEnforcer = {
        loadQuotaContext: vi.fn(),
        clearQuota: vi.fn(),
        recomputeQuota: vi.fn(),
      };

      await registerQuotaEnforcementRoutes(fastify, quotaEnforcer as any);
      const res = await fastify.inject({
        method: 'POST',
        url: '/v0/management/quota/clear',
        payload: { key: 'bare-key', quota: 'def-quota' },
      });

      expect(res.statusCode).toBe(200);
      expect(quotaEnforcer.clearQuota).toHaveBeenCalledWith('bare-key', 'def-quota');

      await fastify.close();
    });

    it('rejects an unattached quota name with an error status (not 200)', async () => {
      const fastify = Fastify();
      mockConfigService.flush.mockResolvedValue(undefined);
      mockConfigService.getConfig.mockReturnValue({
        keys: { 'my-key': { secret: 'sk', quotas: ['q1'] } },
      });
      const quotaEnforcer = {
        loadQuotaContext: vi.fn(),
        clearQuota: vi.fn(),
        recomputeQuota: vi.fn(),
      };

      await registerQuotaEnforcementRoutes(fastify, quotaEnforcer as any);
      const res = await fastify.inject({
        method: 'POST',
        url: '/v0/management/quota/clear',
        payload: { key: 'my-key', quota: 'not-attached' },
      });

      expect(res.statusCode).toBeGreaterThanOrEqual(400);
      expect(res.statusCode).toBeLessThan(500);
      expect(quotaEnforcer.clearQuota).not.toHaveBeenCalled();
      expect(res.json().error).toBeDefined();

      await fastify.close();
    });

    it('returns 404 when clearing a named quota on an unknown key', async () => {
      const fastify = Fastify();
      mockConfigService.flush.mockResolvedValue(undefined);
      mockConfigService.getConfig.mockReturnValue({ keys: {} });
      const quotaEnforcer = {
        loadQuotaContext: vi.fn(),
        clearQuota: vi.fn(),
        recomputeQuota: vi.fn(),
      };

      await registerQuotaEnforcementRoutes(fastify, quotaEnforcer as any);
      const res = await fastify.inject({
        method: 'POST',
        url: '/v0/management/quota/clear',
        payload: { key: 'nope', quota: 'q1' },
      });

      expect(res.statusCode).toBe(404);
      expect(quotaEnforcer.clearQuota).not.toHaveBeenCalled();

      await fastify.close();
    });
  });

  describe('POST /quota/recompute', () => {
    it('recomputes a calendar/cost def and returns the new usage', async () => {
      const fastify = Fastify();
      mockConfigService.flush.mockResolvedValue(undefined);
      mockConfigService.getConfig.mockReturnValue({
        keys: { 'my-key': { secret: 'sk', quotas: ['daily-cost'] } },
      });
      const quotaEnforcer = {
        loadQuotaContext: vi.fn(),
        clearQuota: vi.fn(),
        recomputeQuota: vi.fn(async () => ({
          recomputed: true,
          usage: 42,
          windowStartMs: new Date('2026-02-01T00:00:00.000Z').getTime(),
        })),
      };

      await registerQuotaEnforcementRoutes(fastify, quotaEnforcer as any);
      const res = await fastify.inject({
        method: 'POST',
        url: '/v0/management/quota/recompute',
        payload: { key: 'my-key', quota: 'daily-cost' },
      });

      expect(res.statusCode).toBe(200);
      expect(quotaEnforcer.recomputeQuota).toHaveBeenCalledWith('my-key', 'daily-cost');
      expect(res.json()).toMatchObject({
        success: true,
        key: 'my-key',
        quota: 'daily-cost',
        usage: 42,
      });

      await fastify.close();
    });

    it('returns 400 with reason for a leaky rolling def', async () => {
      const fastify = Fastify();
      mockConfigService.flush.mockResolvedValue(undefined);
      mockConfigService.getConfig.mockReturnValue({
        keys: { 'my-key': { secret: 'sk', quotas: ['leaky-tokens'] } },
      });
      const quotaEnforcer = {
        loadQuotaContext: vi.fn(),
        clearQuota: vi.fn(),
        recomputeQuota: vi.fn(async () => ({
          recomputed: false,
          reason: 'unsupported_quota_type',
        })),
      };

      await registerQuotaEnforcementRoutes(fastify, quotaEnforcer as any);
      const res = await fastify.inject({
        method: 'POST',
        url: '/v0/management/quota/recompute',
        payload: { key: 'my-key', quota: 'leaky-tokens' },
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error).toBeDefined();
      expect(body.reason).toBe('unsupported_quota_type');

      await fastify.close();
    });

    it('validates quota membership before calling the enforcer', async () => {
      const fastify = Fastify();
      mockConfigService.flush.mockResolvedValue(undefined);
      mockConfigService.getConfig.mockReturnValue({
        keys: { 'my-key': { secret: 'sk', quotas: ['q1'] } },
      });
      const quotaEnforcer = {
        loadQuotaContext: vi.fn(),
        clearQuota: vi.fn(),
        recomputeQuota: vi.fn(),
      };

      await registerQuotaEnforcementRoutes(fastify, quotaEnforcer as any);
      const res = await fastify.inject({
        method: 'POST',
        url: '/v0/management/quota/recompute',
        payload: { key: 'my-key', quota: 'not-attached' },
      });

      expect(res.statusCode).toBeGreaterThanOrEqual(400);
      expect(res.statusCode).toBeLessThan(500);
      expect(quotaEnforcer.recomputeQuota).not.toHaveBeenCalled();

      await fastify.close();
    });

    it('requires both key and quota', async () => {
      const fastify = Fastify();
      const quotaEnforcer = {
        loadQuotaContext: vi.fn(),
        clearQuota: vi.fn(),
        recomputeQuota: vi.fn(),
      };

      await registerQuotaEnforcementRoutes(fastify, quotaEnforcer as any);
      const res = await fastify.inject({
        method: 'POST',
        url: '/v0/management/quota/recompute',
        payload: { key: 'my-key' },
      });

      expect(res.statusCode).toBe(400);
      expect(quotaEnforcer.recomputeQuota).not.toHaveBeenCalled();

      await fastify.close();
    });
  });
});
