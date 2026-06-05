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
              quota: 'new-quota',
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
      checkQuota: vi.fn(async () => ({
        quotaName: 'new-quota',
        allowed: true,
        currentUsage: 0,
        limit: 10,
        remaining: 10,
        resetsAt: new Date('2026-01-01T00:00:00.000Z'),
      })),
      clearQuota: vi.fn(),
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
    expect(quotaEnforcer.checkQuota).toHaveBeenCalledWith('new-key');
    expect(res.json()).toEqual({
      key: 'new-key',
      quota_name: 'new-quota',
      allowed: true,
      current_usage: 0,
      limit: 10,
      remaining: 10,
      resets_at: '2026-01-01T00:00:00.000Z',
    });

    await fastify.close();
  });
});
