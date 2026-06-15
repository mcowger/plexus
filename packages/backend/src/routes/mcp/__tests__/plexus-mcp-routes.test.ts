import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { registerSpy } from '../../../../test/test-utils';
import { getConfig, setConfigForTesting } from '../../../config';
import { registerMcpRoutes } from '../index';
import { McpUsageStorageService } from '../../../services/mcp-proxy/mcp-usage-storage';
import { UsageStorageService } from '../../../services/usage-storage';
import * as mcpProxyService from '../../../services/mcp-proxy/mcp-proxy-service';
import { DebugManager } from '../../../services/debug-manager';
import { CooldownManager } from '../../../services/cooldown-manager';
import { BackupService } from '../../../services/backup-service';
import { ModelMetadataManager } from '../../../services/model-metadata-manager';

describe('Plexus management MCP routes', () => {
  let fastify: FastifyInstance;
  let originalInject: FastifyInstance['inject'];
  let originalAdminKey: string | undefined;
  let mockMcpUsageStorage: McpUsageStorageService;
  let mockUsageStorage: UsageStorageService;
  let mockLogLevel = 'info';

  beforeAll(async () => {
    originalAdminKey = process.env.ADMIN_KEY;
    process.env.ADMIN_KEY = 'test-admin-key';

    fastify = Fastify();
    originalInject = fastify.inject.bind(fastify) as FastifyInstance['inject'];
    mockMcpUsageStorage = {
      saveRequest: vi.fn(),
      saveDebugLog: vi.fn(),
      getLogs: vi.fn(),
      deleteLog: vi.fn(),
      deleteAllLogs: vi.fn(),
    } as unknown as McpUsageStorageService;

    mockUsageStorage = {
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

    setConfigForTesting({
      providers: {
        openrouter: {
          display_name: 'OpenRouter',
          api_base_url: 'https://openrouter.ai/api/v1',
          api_key: 'provider-secret',
          enabled: true,
          disable_cooldown: false,
          stall_cooldown: false,
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
    });

    await registerMcpRoutes(fastify, mockMcpUsageStorage);
    await fastify.ready();
  });

  beforeEach(() => {
    DebugManager.getInstance().setEnabled(false);
    DebugManager.getInstance().setProviderFilter(null);
    mockLogLevel = 'info';
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
      const json = (body: unknown, statusCode: number = 200) => ({
        statusCode,
        body: JSON.stringify(body),
        rawPayload: Buffer.from(JSON.stringify(body)),
      });

      if (method === 'GET' && path === '/v0/management/config') {
        return json(setConfigSnapshot());
      }
      if (method === 'GET' && path === '/v0/management/config/export') {
        return json(setConfigSnapshot());
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
        } as any);
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
          providers: DebugManager.getInstance().getProviderFilter(),
        });
      }
      if (method === 'PATCH' && path === '/v0/management/debug') {
        const body = (request.payload ?? {}) as any;
        if (typeof body.enabled === 'boolean') DebugManager.getInstance().setEnabled(body.enabled);
        if (body.providers !== undefined)
          DebugManager.getInstance().setProviderFilter(body.providers ?? null);
        return json({
          enabled: DebugManager.getInstance().isEnabled(),
          enabledGlobal: DebugManager.getInstance().isEnabled(),
          enabledKeys: DebugManager.getInstance().getEnabledKeys(),
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
    registerSpy(mcpProxyService, 'proxyMcpRequest').mockResolvedValue({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: { jsonrpc: '2.0', id: 1, result: {} },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    if (originalAdminKey === undefined) {
      delete process.env.ADMIN_KEY;
    } else {
      process.env.ADMIN_KEY = originalAdminKey;
    }
    await fastify.close();
  });

  test('rejects missing x-admin-key', async () => {
    const response = await postPlexusMcp({ method: 'tools/list', id: 1 });

    expect(response.statusCode).toBe(401);
  });

  test('rejects wrong x-admin-key', async () => {
    const response = await postPlexusMcp(
      { method: 'tools/list', id: 1 },
      { 'x-admin-key': 'wrong' }
    );

    expect(response.statusCode).toBe(401);
  });

  test('rejects bearer-only inference auth', async () => {
    const response = await postPlexusMcp(
      { method: 'tools/list', id: 1 },
      { authorization: 'Bearer sk-valid-key' }
    );

    expect(response.statusCode).toBe(401);
  });

  test('rejects limited key sent as x-admin-key', async () => {
    const response = await postPlexusMcp(
      { method: 'tools/list', id: 1 },
      { 'x-admin-key': 'sk-valid-key' }
    );

    expect(response.statusCode).toBe(403);
  });

  test('handles /mcp/plexus without proxying to upstream gateway', async () => {
    const response = await postPlexusMcp({ method: 'tools/list', id: 1 }, adminHeaders());

    expect(response.statusCode).toBe(200);
    expect(mcpProxyService.proxyMcpRequest).not.toHaveBeenCalled();
  });

  test('records plexus admin MCP requests in MCP usage logs', async () => {
    const response = await postPlexusMcp(
      {
        method: 'tools/call',
        id: 1,
        params: {
          name: 'plexus_config',
          arguments: { operation: 'status' },
        },
      },
      adminHeaders()
    );

    expect(response.statusCode).toBe(200);
    expect(mockMcpUsageStorage.saveRequest).toHaveBeenCalled();
    const record = (mockMcpUsageStorage.saveRequest as any).mock.calls.at(-1)?.[0];
    expect(record.server_name).toBe('plexus');
    expect(record.upstream_url).toBe('/mcp/plexus');
    expect(record.method).toBe('POST');
    expect(record.jsonrpc_method).toBe('tools/call');
    expect(record.tool_name).toBe('plexus_config');
    expect(record.api_key).toBe('admin');
    expect(record.response_status).toBe(200);
  });

  test('keeps other /mcp/:name gateway routes working', async () => {
    const response = await fastify.inject({
      method: 'POST',
      url: '/mcp/test-server',
      headers: {
        authorization: 'Bearer sk-valid-key',
        'content-type': 'application/json',
      },
      payload: { jsonrpc: '2.0', method: 'tools/list', id: 1 },
    });

    expect(response.statusCode).toBe(200);
    expect(mcpProxyService.proxyMcpRequest).toHaveBeenCalled();
  });

  test('reserves plexus as an upstream MCP gateway server name', () => {
    expect(mcpProxyService.validateServerName('plexus')).toBe(false);
    expect(mcpProxyService.getMcpServerConfig('plexus')).toBeNull();
  });

  test('lists compact management tools', async () => {
    const response = await postPlexusMcp({ method: 'tools/list', id: 1 }, adminHeaders());
    const body = parseJsonRpcResponse(response);

    expect(body.result.tools.map((tool: { name: string }) => tool.name)).toEqual(
      expect.arrayContaining([
        'plexus_config',
        'plexus_provider',
        'plexus_model_alias',
        'plexus_key',
        'plexus_quota',
        'plexus_quota_checker',
        'plexus_usage',
        'plexus_debug',
        'plexus_mcp_gateway',
        'plexus_settings',
        'plexus_system_logs',
        'plexus_operations',
      ])
    );
  });

  test('ignores unsupported x-forwarded-proto values', async () => {
    const response = await postPlexusMcp(
      { method: 'tools/list', id: 1 },
      { ...adminHeaders(), 'x-forwarded-proto': 'javascript' }
    );
    const body = parseJsonRpcResponse(response);

    expect(body.result.tools).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'plexus_config' })])
    );
  });

  test('lists prompt resources and returns the management guide prompt', async () => {
    const listResponse = await postPlexusMcp({ method: 'prompts/list', id: 1 }, adminHeaders());
    const listBody = parseJsonRpcResponse(listResponse);

    expect(listBody.result.prompts).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'plexus_management_guide' })])
    );

    const getResponse = await postPlexusMcp(
      {
        method: 'prompts/get',
        id: 2,
        params: { name: 'plexus_management_guide' },
      },
      adminHeaders()
    );
    const getBody = parseJsonRpcResponse(getResponse);

    expect(getBody.result.messages[0].content.text).toContain('Plexus is a unified API gateway');
    expect(getBody.result.messages[0].content.text).toContain('destructive: "acknowledged"');
  });

  test('returns redacted provider data from tool calls', async () => {
    const response = await postPlexusMcp(
      {
        method: 'tools/call',
        id: 1,
        params: {
          name: 'plexus_provider',
          arguments: { operation: 'get', id: 'openrouter' },
        },
      },
      adminHeaders()
    );
    const body = parseJsonRpcResponse(response);

    expect(body.result.structuredContent.ok).toBe(true);
    expect(body.result.structuredContent.data.api_key).toBe('[REDACTED]');
    expect(body.result.structuredContent.data.headers.Authorization).toBe('[REDACTED]');
    expect(JSON.stringify(body.result)).not.toContain('provider-secret');
    expect(JSON.stringify(body.result)).not.toContain('upstream-secret');
  });

  test('returns redacted key data from tool calls', async () => {
    const response = await postPlexusMcp(
      {
        method: 'tools/call',
        id: 1,
        params: {
          name: 'plexus_key',
          arguments: { operation: 'get', id: 'test-key' },
        },
      },
      adminHeaders()
    );
    const body = parseJsonRpcResponse(response);

    expect(body.result.structuredContent.ok).toBe(true);
    expect(body.result.structuredContent.data.secret).toBe('[REDACTED]');
    expect(JSON.stringify(body.result)).not.toContain('sk-valid-key');
  });

  test('requires acknowledgement for destructive operations', async () => {
    const response = await postPlexusMcp(
      {
        method: 'tools/call',
        id: 1,
        params: {
          name: 'plexus_usage',
          arguments: { operation: 'delete_all' },
        },
      },
      adminHeaders()
    );
    const body = parseJsonRpcResponse(response);

    expect(body.result.isError).toBe(true);
    expect(body.result.structuredContent.error.type).toBe('confirmation_required');
  });

  test('allows acknowledged destructive operations to reach handler', async () => {
    const response = await postPlexusMcp(
      {
        method: 'tools/call',
        id: 1,
        params: {
          name: 'plexus_usage',
          arguments: { operation: 'delete_all', destructive: 'acknowledged' },
        },
      },
      adminHeaders()
    );
    const body = parseJsonRpcResponse(response);

    expect(body.result.isError).toBe(false);
    expect(body.result.structuredContent.data.success).toBe(true);
  });

  test('implements plexus_usage list', async () => {
    const response = await postPlexusMcp(
      {
        method: 'tools/call',
        id: 1,
        params: {
          name: 'plexus_usage',
          arguments: { operation: 'list', query: { limit: 10 } },
        },
      },
      adminHeaders()
    );
    const body = parseJsonRpcResponse(response);

    expect(body.result.structuredContent.ok).toBe(true);
    expect(body.result.structuredContent.data.total).toBe(1);
    expect(mockUsageStorage.getUsage).toHaveBeenCalled();
  });

  test('implements plexus_debug state and update', async () => {
    const updateResponse = await postPlexusMcp(
      {
        method: 'tools/call',
        id: 1,
        params: {
          name: 'plexus_debug',
          arguments: {
            operation: 'update',
            body: { enabled: true, providers: ['openrouter'] },
          },
        },
      },
      adminHeaders()
    );
    const updateBody = parseJsonRpcResponse(updateResponse);
    expect(updateBody.result.structuredContent.ok).toBe(true);
    expect(updateBody.result.structuredContent.data.enabledGlobal).toBe(true);
    expect(updateBody.result.structuredContent.data.providers).toEqual(['openrouter']);

    const stateResponse = await postPlexusMcp(
      {
        method: 'tools/call',
        id: 2,
        params: {
          name: 'plexus_debug',
          arguments: { operation: 'state' },
        },
      },
      adminHeaders()
    );
    const stateBody = parseJsonRpcResponse(stateResponse);
    expect(stateBody.result.structuredContent.ok).toBe(true);
    expect(stateBody.result.structuredContent.data.enabledGlobal).toBe(true);
  });

  test('implements plexus_debug log operations', async () => {
    const logsResponse = await postPlexusMcp(
      {
        method: 'tools/call',
        id: 1,
        params: {
          name: 'plexus_debug',
          arguments: { operation: 'logs' },
        },
      },
      adminHeaders()
    );
    const logsBody = parseJsonRpcResponse(logsResponse);
    expect(logsBody.result.structuredContent.data[0].requestId).toBe('req-debug');

    const getResponse = await postPlexusMcp(
      {
        method: 'tools/call',
        id: 2,
        params: {
          name: 'plexus_debug',
          arguments: { operation: 'get_log', id: 'req-debug' },
        },
      },
      adminHeaders()
    );
    const getBody = parseJsonRpcResponse(getResponse);
    expect(getBody.result.structuredContent.data.requestId).toBe('req-debug');
  });

  test('implements plexus_system_logs recent', async () => {
    const response = await postPlexusMcp(
      {
        method: 'tools/call',
        id: 1,
        params: {
          name: 'plexus_system_logs',
          arguments: { operation: 'recent', query: { limit: 10 } },
        },
      },
      adminHeaders()
    );
    const body = parseJsonRpcResponse(response);
    expect(body.result.structuredContent.ok).toBe(true);
    expect(body.result.structuredContent.data.total).toBe(1);
    expect(body.result.structuredContent.data.data[0].message).toBe('system-log');
  });

  test('implements plexus_system_logs level operations', async () => {
    const levelResponse = await postPlexusMcp(
      {
        method: 'tools/call',
        id: 1,
        params: {
          name: 'plexus_system_logs',
          arguments: { operation: 'level' },
        },
      },
      adminHeaders()
    );
    const levelBody = parseJsonRpcResponse(levelResponse);
    expect(levelBody.result.structuredContent.data.level).toBe('info');

    const setLevelResponse = await postPlexusMcp(
      {
        method: 'tools/call',
        id: 2,
        params: {
          name: 'plexus_system_logs',
          arguments: { operation: 'set_level', body: { level: 'debug' } },
        },
      },
      adminHeaders()
    );
    const setLevelBody = parseJsonRpcResponse(setLevelResponse);
    expect(setLevelBody.result.structuredContent.data.level).toBe('debug');

    const resetLevelResponse = await postPlexusMcp(
      {
        method: 'tools/call',
        id: 3,
        params: {
          name: 'plexus_system_logs',
          arguments: { operation: 'reset_level' },
        },
      },
      adminHeaders()
    );
    const resetLevelBody = parseJsonRpcResponse(resetLevelResponse);
    expect(resetLevelBody.result.structuredContent.data.level).toBe('info');
  });

  test('implements plexus_operations cooldown operations', async () => {
    const listResponse = await postPlexusMcp(
      {
        method: 'tools/call',
        id: 1,
        params: {
          name: 'plexus_operations',
          arguments: { operation: 'list_cooldowns' },
        },
      },
      adminHeaders()
    );
    const listBody = parseJsonRpcResponse(listResponse);
    expect(listBody.result.structuredContent.ok).toBe(true);

    const clearResponse = await postPlexusMcp(
      {
        method: 'tools/call',
        id: 2,
        params: {
          name: 'plexus_operations',
          arguments: {
            operation: 'clear_cooldowns',
            destructive: 'acknowledged',
            query: { provider: 'openrouter', model: 'openai/gpt-5' },
          },
        },
      },
      adminHeaders()
    );
    const clearBody = parseJsonRpcResponse(clearResponse);
    expect(clearBody.result.structuredContent.data.success).toBe(true);
  });

  test('implements plexus_operations backup and restart response', async () => {
    registerSpy(BackupService.prototype, 'exportConfigBackup').mockResolvedValue({
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

    const backupResponse = await postPlexusMcp(
      {
        method: 'tools/call',
        id: 1,
        params: {
          name: 'plexus_operations',
          arguments: { operation: 'backup' },
        },
      },
      adminHeaders()
    );
    const backupBody = parseJsonRpcResponse(backupResponse);
    expect(backupBody.result.structuredContent.ok).toBe(true);
    expect(backupBody.result.structuredContent.data.full).toBe(false);

    const restartResponse = await postPlexusMcp(
      {
        method: 'tools/call',
        id: 2,
        params: {
          name: 'plexus_operations',
          arguments: { operation: 'restart', destructive: 'acknowledged' },
        },
      },
      adminHeaders()
    );
    const restartBody = parseJsonRpcResponse(restartResponse);
    expect(restartBody.result.structuredContent.ok).toBe(true);
    expect(restartBody.result.structuredContent.data.success).toBe(true);
    expect(restartBody.result.structuredContent.data.message).toContain('restarting');
  });

  test('implements plexus_operations refresh_metadata response', async () => {
    registerSpy(ModelMetadataManager.getInstance(), 'refreshAll').mockResolvedValue({
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

    const response = await postPlexusMcp(
      {
        method: 'tools/call',
        id: 3,
        params: {
          name: 'plexus_operations',
          arguments: { operation: 'refresh_metadata' },
        },
      },
      adminHeaders()
    );

    const body = parseJsonRpcResponse(response);
    expect(body.result.structuredContent.ok).toBe(true);
    expect(body.result.structuredContent.data.message).toContain('refresh completed');
    expect(body.result.structuredContent.data.sources.modelsDev.count).toBe(20);
  });

  test('implements plexus_key update through the management shim', async () => {
    const updateResponse = await postPlexusMcp(
      {
        method: 'tools/call',
        id: 1,
        params: {
          name: 'plexus_key',
          arguments: {
            operation: 'update',
            id: 'test-key',
            body: { beta: true },
          },
        },
      },
      adminHeaders()
    );
    const updateBody = parseJsonRpcResponse(updateResponse);
    expect(updateBody.result.structuredContent.ok).toBe(true);

    const getResponse = await postPlexusMcp(
      {
        method: 'tools/call',
        id: 2,
        params: {
          name: 'plexus_key',
          arguments: { operation: 'get', id: 'test-key' },
        },
      },
      adminHeaders()
    );
    const getBody = parseJsonRpcResponse(getResponse);
    expect(getBody.result.structuredContent.data.beta).toBe(true);
  });

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
    return { 'x-admin-key': 'test-admin-key' };
  }

  function setConfigSnapshot() {
    return structuredClone(getConfig());
  }

  function parseJsonRpcResponse(response: Awaited<ReturnType<typeof postPlexusMcp>>) {
    expect(response.statusCode).toBe(200);
    return JSON.parse(response.body);
  }
});
