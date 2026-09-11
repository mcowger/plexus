import { expect, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { registerSpy } from '../../../../test/test-utils';
import { getConfig, setConfigForTesting, type PlexusConfig } from '../../../config';
import { registerMcpRoutes } from '../index';
import { McpUsageStorageService } from '../../../services/mcp-proxy/mcp-usage-storage';
import { UsageStorageService } from '../../../services/observability/usage-storage';
import * as mcpProxyService from '../../../services/mcp-proxy/mcp-proxy-service';
import { DebugManager } from '../../../services/observability/debug-manager';
import { ModelMetadataManager } from '../../../services/models/model-metadata-manager';

const TEST_ADMIN_KEY = 'test-admin-key';

export function createBaselineConfig(): PlexusConfig {
  return {
    providers: {
      openrouter: {
        display_name: 'OpenRouter',
        api_base_url: 'https://openrouter.ai/api/v1',
        api_key: 'provider-secret',
        enabled: true,
        disable_cooldown: false,
        stall_cooldown: false,
        allow_100_percent_utilization: false,
        estimateTokens: false,
        useClaudeMasking: false,
        headers: {
          Authorization: 'Bearer upstream-secret',
        },
        quota_checker: {
          type: 'openrouter',
          enabled: true,
          intervalMinutes: 60,
          id: 'openrouter-checker',
          options: {
            apiKey: 'quota-secret',
          },
        },
      },
    },
    models: {
      'gpt-5': {
        priority: 'selector',
        sticky_session: false,
        selector: 'random',
        target_groups: [
          {
            name: 'default',
            selector: 'random',
            targets: [{ provider: 'openrouter', model: 'openai/gpt-5', enabled: true }],
          },
        ],
      },
    },
    keys: {
      'test-key': { secret: 'sk-valid-key', comment: 'Test Key' },
    },
    failover: {
      enabled: false,
      retryableStatusCodes: [429, 500, 502, 503, 504],
      retryableErrors: ['ECONNREFUSED', 'ETIMEDOUT'],
    },
    quotas: [],
    user_quotas: {
      daily: { type: 'daily', limitType: 'requests', limit: 100 },
    },
    mcpServers: {
      'test-server': {
        upstream_url: 'http://localhost:3000/mcp',
        enabled: true,
      },
      plexus: {
        upstream_url: 'http://localhost:3001/mcp',
        enabled: true,
      },
    },
  } as PlexusConfig;
}

export interface PlexusMcpTestFixture {
  fastify: FastifyInstance;
  mockMcpUsageStorage: McpUsageStorageService;
  mockUsageStorage: UsageStorageService;
  start(): Promise<void>;
  reset(): void;
  close(): Promise<void>;
  postPlexusMcp(payload: Record<string, unknown>, headers?: Record<string, string>): Promise<any>;
  adminHeaders(): Record<string, string>;
  parseJsonRpcResponse(response: { statusCode: number; body: string }): any;
}

export function createPlexusMcpTestFixture(): PlexusMcpTestFixture {
  const fastify = Fastify();
  const originalInject = fastify.inject.bind(fastify) as FastifyInstance['inject'];
  const originalAdminKey = process.env.ADMIN_KEY;
  let originalConfig: PlexusConfig | undefined;
  let mockLogLevel = 'info';
  let started = false;

  const mockMcpUsageStorage = {
    saveRequest: vi.fn(),
    saveDebugLog: vi.fn(),
    getLogs: vi.fn(),
    deleteLog: vi.fn(),
    deleteAllLogs: vi.fn(),
  } as unknown as McpUsageStorageService;

  const mockUsageStorage = {
    getUsage: vi.fn(async () => ({
      data: [{ requestId: 'req-1', provider: 'openrouter', apiKey: 'test-key' }],
      total: 1,
    })),
    getDb: vi.fn(() => ({
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            groupBy: vi.fn(() => ({ orderBy: vi.fn(async () => []) })),
          })),
        })),
      })),
    })),
    deleteUsageLog: vi.fn(async () => true),
    deleteAllUsageLogs: vi.fn(async () => true),
    getDebugLogs: vi.fn(async () => [
      { requestId: 'req-debug', createdAt: 123, responseStatus: 200 },
    ]),
    getDebugLog: vi.fn(async (requestId: string) =>
      requestId === 'req-debug' ? { requestId, createdAt: 123, responseStatus: 200 } : null
    ),
    deleteDebugLog: vi.fn(async () => true),
    deleteAllDebugLogs: vi.fn(async () => true),
    deleteAllErrors: vi.fn(async () => true),
  } as unknown as UsageStorageService;

  function setConfigSnapshot() {
    return structuredClone(getConfig());
  }

  function json(body: unknown, statusCode: number = 200) {
    const serialized = JSON.stringify(body);
    return {
      statusCode,
      body: serialized,
      rawPayload: Buffer.from(serialized),
    };
  }

  function installManagementInjector() {
    registerSpy(fastify, 'inject').mockImplementation(async (options: any) => {
      const request = typeof options === 'string' ? { url: options, method: 'GET' } : options;
      const url = request.url as string;
      const method = (request.method ?? 'GET').toUpperCase();

      if (!url.startsWith('/v0/management/') && !url.startsWith('/v0/system/logs/')) {
        return originalInject(request as any);
      }

      const parts = url.split('?');
      const path = parts[0] ?? '';
      const queryString = parts[1] ?? '';
      const query = Object.fromEntries(new URLSearchParams(queryString));

      if (method === 'GET' && path === '/v0/management/config') {
        return json(setConfigSnapshot());
      }
      if (method === 'GET' && path === '/v0/management/config/export') {
        return json(setConfigSnapshot());
      }
      if (method === 'GET' && path === '/v0/management/config/status') {
        const config = setConfigSnapshot();
        return json({
          providerCount: Object.keys(config.providers ?? {}).length,
          modelAliasCount: Object.keys(config.models ?? {}).length,
          keyCount: Object.keys(config.keys ?? {}).length,
          quotaCount: Object.keys(config.user_quotas ?? {}).length,
          mcpServerCount: Object.keys(config.mcpServers ?? config.mcp_servers ?? {}).length,
        });
      }
      if (method === 'GET' && path === '/v0/management/quota-checker-types') {
        return json({ types: ['test'], count: 1 });
      }
      if (method === 'GET' && path === '/v0/management/quota-checkers') {
        return json({ knownTypes: [{ type: 'test', displayName: 'Test' }], configured: [] });
      }
      if (method === 'GET' && path.startsWith('/v0/management/quotas/')) {
        const checkerId = decodeURIComponent(path.replace('/v0/management/quotas/', ''));
        return json({ checkerId, checkerType: 'test', success: true, meters: [] });
      }
      if (method === 'GET' && path === '/v0/management/providers') {
        return json(setConfigSnapshot().providers ?? {});
      }
      if (method === 'GET' && path.startsWith('/v0/management/providers/')) {
        const id = decodeURIComponent(path.replace('/v0/management/providers/', ''));
        const provider = setConfigSnapshot().providers?.[id];
        return provider ? json(provider) : json({ error: `Provider '${id}' not found` }, 404);
      }
      if (method === 'GET' && path === '/v0/management/aliases') {
        return json(setConfigSnapshot().models ?? {});
      }
      if (method === 'GET' && path.startsWith('/v0/management/aliases/')) {
        const id = decodeURIComponent(path.replace('/v0/management/aliases/', ''));
        const alias = setConfigSnapshot().models?.[id];
        return alias
          ? json({ slug: id, ...alias })
          : json({ error: `Alias '${id}' not found` }, 404);
      }
      if (method === 'GET' && path === '/v0/management/keys') {
        return json(setConfigSnapshot().keys ?? {});
      }
      if (method === 'GET' && path.startsWith('/v0/management/keys/')) {
        const id = decodeURIComponent(path.replace('/v0/management/keys/', ''));
        const key = setConfigSnapshot().keys?.[id];
        return key ? json({ name: id, ...key }) : json({ error: `API key '${id}' not found` }, 404);
      }
      if (method === 'PATCH' && path.startsWith('/v0/management/keys/')) {
        const id = decodeURIComponent(path.replace('/v0/management/keys/', ''));
        const current = setConfigSnapshot();
        const existing = current.keys?.[id];
        if (!existing) return json({ error: `API key '${id}' not found` }, 404);
        setConfigForTesting({
          ...current,
          keys: {
            ...current.keys,
            [id]: { ...existing, ...(request.payload as Record<string, unknown>) },
          },
        } as PlexusConfig);
        return json({ success: true, name: id });
      }
      if (method === 'GET' && path === '/v0/management/user-quotas') {
        return json(setConfigSnapshot().user_quotas ?? {});
      }
      if (method === 'GET' && path.startsWith('/v0/management/user-quotas/')) {
        const id = decodeURIComponent(path.replace('/v0/management/user-quotas/', ''));
        const quota = setConfigSnapshot().user_quotas?.[id];
        return quota
          ? json({ name: id, ...quota })
          : json({ error: { message: `Quota not found: ${id}`, type: 'not_found_error' } }, 404);
      }
      if (method === 'GET' && path.startsWith('/v0/management/quota/status/')) {
        const key = decodeURIComponent(path.replace('/v0/management/quota/status/', ''));
        if (key === 'missing-key') {
          return json(
            { error: { message: `Key not found: ${key}`, type: 'not_found_error' } },
            404
          );
        }
        return json({
          key,
          quotas: [
            {
              name: 'daily',
              limitType: 'requests',
              limit: 100,
              currentUsage: 10,
              remaining: 90,
              allowed: true,
              resetsAt: '2026-07-03T00:00:00.000Z',
              scope: {},
              global: true,
              shared: false,
              source: 'assigned',
            },
          ],
          quota_name: 'daily',
          allowed: true,
          current_usage: 10,
          limit: 100,
          remaining: 90,
          resets_at: '2026-07-03T00:00:00.000Z',
        });
      }
      if (method === 'POST' && path === '/v0/management/quota/clear') {
        const body = (request.payload ?? {}) as { key?: string; quota?: string };
        if (!body.key) {
          return json(
            { error: { message: 'Missing required field: key', type: 'invalid_request_error' } },
            400
          );
        }
        if (body.key === 'missing-key') {
          return json(
            { error: { message: `Key not found: ${body.key}`, type: 'not_found_error' } },
            404
          );
        }
        if (body.quota === 'unattached') {
          return json(
            {
              error: {
                message: `Quota '${body.quota}' is not attached to key '${body.key}'`,
                type: 'invalid_request_error',
              },
            },
            400
          );
        }
        return json({
          success: true,
          key: body.key,
          quota: body.quota ?? null,
          message: body.quota
            ? `Quota '${body.quota}' reset successfully`
            : 'Quota reset successfully',
        });
      }
      if (method === 'POST' && path === '/v0/management/quota/recompute') {
        const body = (request.payload ?? {}) as { key?: string; quota?: string };
        if (!body.key || !body.quota) {
          return json(
            {
              error: {
                message: 'Missing required field(s): key, quota',
                type: 'invalid_request_error',
              },
            },
            400
          );
        }
        if (body.key === 'missing-key') {
          return json(
            { error: { message: `Key not found: ${body.key}`, type: 'not_found_error' } },
            404
          );
        }
        if (body.quota === 'unattached') {
          return json(
            {
              error: {
                message: `Quota '${body.quota}' is not attached to key '${body.key}'`,
                type: 'invalid_request_error',
              },
            },
            400
          );
        }
        if (body.quota === 'leaky') {
          return json(
            {
              error: {
                message: `Failed to recompute quota '${body.quota}': unsupported_quota_type`,
                type: 'invalid_request_error',
              },
              reason: 'unsupported_quota_type',
            },
            400
          );
        }
        return json({
          success: true,
          key: body.key,
          quota: body.quota,
          usage: 42,
          windowStartMs: 1700000000000,
          message: `Quota '${body.quota}' recomputed successfully`,
        });
      }
      if (method === 'GET' && path === '/v0/management/mcp-servers') {
        return json(setConfigSnapshot().mcpServers ?? setConfigSnapshot().mcp_servers ?? {});
      }
      if (method === 'GET' && path.startsWith('/v0/management/mcp-servers/')) {
        const id = decodeURIComponent(path.replace('/v0/management/mcp-servers/', ''));
        const server = (setConfigSnapshot().mcpServers ?? setConfigSnapshot().mcp_servers ?? {})[
          id
        ];
        return server
          ? json({ name: id, ...server })
          : json({ error: `MCP server '${id}' not found` }, 404);
      }
      if (method === 'GET' && path === '/v0/management/config/failover') {
        return json(setConfigSnapshot().failover ?? {});
      }
      if (method === 'GET' && path === '/v0/management/config/cooldown') {
        return json(setConfigSnapshot().cooldown ?? {});
      }
      if (method === 'GET' && path === '/v0/management/config/timeout') {
        return json(setConfigSnapshot().timeout ?? {});
      }
      if (method === 'GET' && path === '/v0/management/config/stall') {
        return json(setConfigSnapshot().stall ?? {});
      }
      if (method === 'GET' && path === '/v0/management/config/trusted-proxies') {
        return json({ trustedProxies: setConfigSnapshot().trustedProxies ?? [] });
      }
      if (method === 'GET' && path === '/v0/management/config/vision-fallthrough') {
        return json(setConfigSnapshot().vision_fallthrough ?? {});
      }
      if (method === 'GET' && path === '/v0/management/config/background-exploration') {
        return json(setConfigSnapshot().backgroundExploration ?? {});
      }
      if (method === 'GET' && path === '/v0/management/config/exploration-rate') {
        return json({
          performanceExplorationRate: setConfigSnapshot().performanceExplorationRate ?? 0.05,
          latencyExplorationRate: setConfigSnapshot().latencyExplorationRate ?? 0.05,
          e2ePerformanceExplorationRate: setConfigSnapshot().e2ePerformanceExplorationRate ?? 0.05,
        });
      }
      if (method === 'GET' && path === '/v0/system/logs/recent') {
        return json({
          data: [{ level: 'info', message: 'system-log', timestamp: '2026-01-01 00:00:00' }],
          total: 1,
        });
      }
      if (method === 'GET' && path === '/v0/management/logging/level') {
        return json({
          level: mockLogLevel,
          startupLevel: 'info',
          supportedLevels: ['error', 'warn', 'info', 'debug', 'verbose', 'silly'],
          ephemeral: true,
        });
      }
      if (method === 'PUT' && path === '/v0/management/logging/level') {
        mockLogLevel = (request.payload as any)?.level ?? mockLogLevel;
        return json({
          level: mockLogLevel,
          startupLevel: 'info',
          supportedLevels: ['error', 'warn', 'info', 'debug', 'verbose', 'silly'],
          ephemeral: true,
        });
      }
      if (method === 'DELETE' && path === '/v0/management/logging/level') {
        mockLogLevel = 'info';
        return json({
          level: mockLogLevel,
          startupLevel: 'info',
          supportedLevels: ['error', 'warn', 'info', 'debug', 'verbose', 'silly'],
          ephemeral: true,
        });
      }
      if (method === 'GET' && path === '/v0/management/usage') {
        return json(await (mockUsageStorage.getUsage as any)({}, { limit: 50, offset: 0 }));
      }
      if (method === 'GET' && path === '/v0/management/usage/summary') {
        return json({
          range: query.range ?? 'day',
          series: [],
          stats: { totalRequests: 1 },
          today: { requests: 1 },
        });
      }
      if (method === 'DELETE' && path === '/v0/management/usage') {
        await (mockUsageStorage.deleteAllUsageLogs as any)();
        return json({
          success: true,
          olderThanDays: query.olderThanDays ? Number(query.olderThanDays) : null,
        });
      }
      if (method === 'DELETE' && path.startsWith('/v0/management/usage/')) {
        await (mockUsageStorage.deleteUsageLog as any)(
          decodeURIComponent(path.replace('/v0/management/usage/', ''))
        );
        return json({ success: true });
      }
      if (method === 'GET' && path === '/v0/management/debug') {
        return json({
          enabled: DebugManager.getInstance().isEnabled(),
          enabledGlobal: DebugManager.getInstance().isEnabled(),
          enabledKeys: DebugManager.getInstance().getEnabledKeys(),
          keys: DebugManager.getInstance().getEnabledKeys(),
          aliases: DebugManager.getInstance().getEnabledAliases(),
          providers: DebugManager.getInstance().getProviderFilter(),
        });
      }
      if (method === 'PATCH' && path === '/v0/management/debug') {
        const body = (request.payload ?? {}) as any;
        if (typeof body.enabled === 'boolean') DebugManager.getInstance().setEnabled(body.enabled);
        if (body.providers !== undefined)
          DebugManager.getInstance().setProviderFilter(body.providers ?? null);
        if (body.keys !== undefined) DebugManager.getInstance().setEnabledKeys(body.keys ?? null);
        if (body.aliases !== undefined)
          DebugManager.getInstance().setEnabledAliases(body.aliases ?? null);
        return json({
          enabled: DebugManager.getInstance().isEnabled(),
          enabledGlobal: DebugManager.getInstance().isEnabled(),
          enabledKeys: DebugManager.getInstance().getEnabledKeys(),
          keys: DebugManager.getInstance().getEnabledKeys(),
          aliases: DebugManager.getInstance().getEnabledAliases(),
          providers: DebugManager.getInstance().getProviderFilter(),
        });
      }
      if (method === 'GET' && path === '/v0/management/debug/logs') {
        return json(await (mockUsageStorage.getDebugLogs as any)(50, 0));
      }
      if (method === 'GET' && path.startsWith('/v0/management/debug/logs/')) {
        const id = decodeURIComponent(path.replace('/v0/management/debug/logs/', ''));
        const log = await (mockUsageStorage.getDebugLog as any)(id);
        return log ? json(log) : json({ error: 'Log not found' }, 404);
      }
      if (method === 'DELETE' && path === '/v0/management/debug/logs') {
        await (mockUsageStorage.deleteAllDebugLogs as any)();
        return json({ success: true });
      }
      if (method === 'DELETE' && path.startsWith('/v0/management/debug/logs/')) {
        await (mockUsageStorage.deleteDebugLog as any)(
          decodeURIComponent(path.replace('/v0/management/debug/logs/', ''))
        );
        return json({ success: true });
      }
      if (method === 'GET' && path === '/v0/management/backup') {
        return json({
          plexus_backup: true,
          version: 1,
          created_at: '2026-01-01T00:00:00.000Z',
          dialect: 'sqlite',
          data: {
            providers: {},
            models: {},
            keys: {},
            user_quotas: {},
            mcp_servers: {},
            settings: {},
            oauth_credentials: [],
          },
        });
      }
      if (method === 'POST' && path === '/v0/management/restore') {
        return json({
          success: true,
          restored: {},
          message: 'Config restore complete. Server is restarting to apply changes.',
        });
      }
      if (method === 'GET' && path === '/v0/management/cooldowns') {
        return json([]);
      }
      if (method === 'DELETE' && path === '/v0/management/cooldowns') {
        return json({ success: true });
      }
      if (method === 'DELETE' && path.startsWith('/v0/management/cooldowns/')) {
        return json({ success: true });
      }
      if (method === 'DELETE' && path === '/v0/management/logs/reset') {
        return json({ success: true, message: 'All logs have been reset successfully' });
      }
      if (method === 'POST' && path === '/v0/management/restart') {
        return json({ success: true, message: 'Server is restarting' });
      }
      if (method === 'POST' && path === '/v0/management/models/metadata/refresh') {
        return json({
          success: true,
          message: 'Model metadata refresh completed successfully',
          trigger: 'manual',
          refreshedAt: '2026-06-10T12:00:00.000Z',
          durationMs: 25,
          intervalMinutes: 60,
          hadErrors: false,
          sources: {
            openrouter: { source: 'openrouter', initialized: true, count: 10 },
            modelsDev: { source: 'models.dev', initialized: true, count: 20 },
            catwalk: { source: 'catwalk', initialized: true, count: 30 },
          },
        });
      }

      return json({ error: `Unhandled management route in test: ${method} ${url}` }, 404);
    });
  }

  async function start() {
    if (started) return;

    process.env.ADMIN_KEY = TEST_ADMIN_KEY;
    try {
      originalConfig = structuredClone(getConfig());
    } catch {
      originalConfig = undefined;
    }
    setConfigForTesting(createBaselineConfig());
    await registerMcpRoutes(fastify, mockMcpUsageStorage);
    await fastify.ready();
    started = true;
  }

  function reset() {
    setConfigForTesting(createBaselineConfig());
    DebugManager.getInstance().resetForTesting();
    DebugManager.getInstance().setEnabled(false);
    ModelMetadataManager.resetForTesting();
    mockLogLevel = 'info';
    for (const mock of [
      mockMcpUsageStorage.saveRequest,
      mockMcpUsageStorage.saveDebugLog,
      mockMcpUsageStorage.getLogs,
      mockMcpUsageStorage.deleteLog,
      mockMcpUsageStorage.deleteAllLogs,
      mockUsageStorage.getUsage,
      mockUsageStorage.getDb,
      mockUsageStorage.deleteUsageLog,
      mockUsageStorage.deleteAllUsageLogs,
      mockUsageStorage.getDebugLogs,
      mockUsageStorage.getDebugLog,
      mockUsageStorage.deleteDebugLog,
      mockUsageStorage.deleteAllDebugLogs,
      mockUsageStorage.deleteAllErrors,
    ]) {
      (mock as any).mockClear();
    }
    installManagementInjector();
    registerSpy(mcpProxyService, 'proxyMcpRequest').mockResolvedValue({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: { jsonrpc: '2.0', id: 1, result: {} },
    });
  }

  async function close() {
    try {
      if (started) await fastify.close();
    } finally {
      if (originalConfig) setConfigForTesting(originalConfig);
      if (originalAdminKey === undefined) {
        delete process.env.ADMIN_KEY;
      } else {
        process.env.ADMIN_KEY = originalAdminKey;
      }
    }
  }

  function postPlexusMcp(payload: Record<string, unknown>, headers: Record<string, string> = {}) {
    return fastify.inject({
      method: 'POST',
      url: '/mcp/plexus',
      headers: {
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
        ...headers,
      },
      payload: { jsonrpc: '2.0', ...payload },
    });
  }

  function adminHeaders() {
    return { 'x-admin-key': TEST_ADMIN_KEY };
  }

  function parseJsonRpcResponse(response: { statusCode: number; body: string }) {
    expect(response.statusCode).toBe(200);
    return JSON.parse(response.body);
  }

  return {
    fastify,
    mockMcpUsageStorage,
    mockUsageStorage,
    start,
    reset,
    close,
    postPlexusMcp,
    adminHeaders,
    parseJsonRpcResponse,
  };
}
