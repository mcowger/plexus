import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { registerSpy } from '../../../../test/test-utils';
import { setConfigForTesting } from '../../../config';
import { registerMcpRoutes } from '../index';
import { McpUsageStorageService } from '../../../services/mcp-proxy/mcp-usage-storage';
import * as mcpProxyService from '../../../services/mcp-proxy/mcp-proxy-service';

describe('Plexus management MCP routes', () => {
  let fastify: FastifyInstance;
  let originalAdminKey: string | undefined;
  let mockMcpUsageStorage: McpUsageStorageService;

  beforeAll(async () => {
    originalAdminKey = process.env.ADMIN_KEY;
    process.env.ADMIN_KEY = 'test-admin-key';

    fastify = Fastify();
    mockMcpUsageStorage = {
      saveRequest: vi.fn(),
      saveDebugLog: vi.fn(),
      getLogs: vi.fn(),
      deleteLog: vi.fn(),
      deleteAllLogs: vi.fn(),
    } as unknown as McpUsageStorageService;

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
        'plexus_operations',
        'plexus_system_logs',
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

    expect(body.result.isError).toBe(true);
    expect(body.result.structuredContent.error.type).toBe('not_implemented');
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

  function parseJsonRpcResponse(response: Awaited<ReturnType<typeof postPlexusMcp>>) {
    expect(response.statusCode).toBe(200);
    return JSON.parse(response.body);
  }
});
