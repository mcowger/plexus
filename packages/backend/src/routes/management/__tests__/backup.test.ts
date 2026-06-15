/**
 * Tests for backup and restore routes.
 *
 * Strategy: We mock the DB and config dependencies to avoid needing a real DB.
 * The BackupService's internal logic (CSV, tar, etc.) is tested in
 * services/__tests__/backup-service.test.ts. Here we verify route wiring,
 * content-type handling, and input validation.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';

// Mock the database and config to avoid needing a real DB
vi.mock('../../../db/client', () => ({
  getDatabase: vi.fn(),
  getSchema: vi.fn(() => ({})),
  getCurrentDialect: vi.fn(() => 'sqlite'),
}));

vi.mock('../../../services/config-service', () => ({
  ConfigService: {
    getInstance: vi.fn(() => ({
      exportConfig: vi.fn(async () => ({
        providers: {},
        models: {},
        keys: {},
        user_quotas: {},
        mcp_servers: {},
        settings: {},
        oauth_providers: [],
      })),
      getRepository: vi.fn(() => ({
        getAllOAuthProviders: vi.fn(async () => []),
        getOAuthCredentials: vi.fn(),
      })),
      initialize: vi.fn(),
    })),
  },
}));

vi.mock('../../../utils/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), silly: vi.fn() },
  getCurrentLogLevel: vi.fn(() => 'info'),
}));

import { registerBackupRoutes } from '../backup';

describe('Backup management routes', () => {
  let fastify: ReturnType<typeof Fastify>;
  let mockUsageStorage: any;
  let mockMcpUsageStorage: any;

  beforeEach(async () => {
    fastify = Fastify();
    mockUsageStorage = {
      deleteAllUsageLogs: vi.fn(async () => true),
      deleteAllErrors: vi.fn(async () => true),
      deleteAllDebugLogs: vi.fn(async () => true),
    };
    mockMcpUsageStorage = {
      deleteAllLogs: vi.fn(async () => true),
    };
    await registerBackupRoutes(fastify, mockUsageStorage, mockMcpUsageStorage);
  });

  afterEach(async () => {
    await fastify.close();
  });

  describe('GET /v0/management/backup', () => {
    it('returns 200 for config-only backup', async () => {
      const res = await fastify.inject({ method: 'GET', url: '/v0/management/backup' });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.plexus_backup).toBe(true);
      expect(body.version).toBe(1);
      expect(body.data).toBeDefined();
      expect(body.data.providers).toBeDefined();
      expect(body.data.oauth_credentials).toEqual([]);
    });

    it('returns full archive even with empty schema (no operational tables)', async () => {
      // With an empty schema mock, no operational tables are exported.
      // The archive still contains manifest.json and config.json.
      const res = await fastify.inject({
        method: 'GET',
        url: '/v0/management/backup?full=true',
      });

      // Should succeed with a minimal archive
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('application/gzip');
    });
  });

  describe('POST /v0/management/restore', () => {
    it('returns 400 for JSON body without plexus_backup field', async () => {
      const res = await fastify.inject({
        method: 'POST',
        url: '/v0/management/restore',
        payload: { some: 'data' },
        headers: { 'content-type': 'application/json' },
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error).toContain('plexus_backup');
    });

    it('returns 400 for another invalid JSON body', async () => {
      const res = await fastify.inject({
        method: 'POST',
        url: '/v0/management/restore',
        payload: { not_backup: true },
        headers: { 'content-type': 'application/json' },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  describe('DELETE /v0/management/logs/reset', () => {
    it('calls delete functions on storage services and returns 200', async () => {
      const res = await fastify.inject({
        method: 'DELETE',
        url: '/v0/management/logs/reset',
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        success: true,
        message: 'All logs have been reset successfully',
      });
      expect(mockUsageStorage.deleteAllUsageLogs).toHaveBeenCalled();
      expect(mockUsageStorage.deleteAllErrors).toHaveBeenCalled();
      expect(mockUsageStorage.deleteAllDebugLogs).toHaveBeenCalled();
      expect(mockMcpUsageStorage.deleteAllLogs).toHaveBeenCalled();
    });

    it('returns 500 if a storage delete operation fails', async () => {
      mockUsageStorage.deleteAllErrors.mockResolvedValueOnce(false);

      const res = await fastify.inject({
        method: 'DELETE',
        url: '/v0/management/logs/reset',
      });

      expect(res.statusCode).toBe(500);
      expect(res.json().error).toBeDefined();
    });
  });
});
