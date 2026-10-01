import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import * as mcpProxyService from '../../../services/mcp-proxy/mcp-proxy-service';
import { createPlexusMcpTestFixture } from './plexus-mcp-test-fixtures';

describe('Plexus management MCP routes - protocol', () => {
  const fixture = createPlexusMcpTestFixture();

  beforeAll(async () => {
    await fixture.start();
  });

  beforeEach(() => {
    fixture.reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await fixture.close();
  });

  test('keeps other /mcp/:name gateway routes working', async () => {
    const response = await fixture.fastify.inject({
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
    const response = await fixture.postPlexusMcp(
      { method: 'tools/list', id: 1 },
      fixture.adminHeaders()
    );
    const body = fixture.parseJsonRpcResponse(response);

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

  test('describes model alias payloads, Decisions routing, alias refs, and auto specialties', async () => {
    const response = await fixture.postPlexusMcp(
      { method: 'tools/list', id: 1 },
      fixture.adminHeaders()
    );
    const body = fixture.parseJsonRpcResponse(response);
    const aliasTool = body.result.tools.find(
      (tool: { name: string }) => tool.name === 'plexus_model_alias'
    );

    expect(aliasTool.description).toContain('type: "decisions"');
    expect(aliasTool.description).toContain('auto_profile.specialties');
    expect(aliasTool.description).toContain('there is no use_case field');
    expect(aliasTool.inputSchema.properties.id.description).toContain('Required for put/create');
    expect(aliasTool.inputSchema.properties.operation.enum).toContain('preview_auto_routing');
    const inputSchema = JSON.stringify(aliasTool.inputSchema);
    expect(inputSchema).toContain('decisions');
    expect(inputSchema).toContain('classifier_alias');
    expect(inputSchema).toContain('max_completion_tokens');
    expect(inputSchema).toContain('specialties');
    expect(inputSchema).toContain('judgment_handle');
    expect(inputSchema).toContain('cache_state');
  });

  test('ignores unsupported x-forwarded-proto values', async () => {
    const response = await fixture.postPlexusMcp(
      { method: 'tools/list', id: 1 },
      { ...fixture.adminHeaders(), 'x-forwarded-proto': 'javascript' }
    );
    const body = fixture.parseJsonRpcResponse(response);

    expect(body.result.tools).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'plexus_config' })])
    );
  });

  test('lists prompt resources and returns the management guide prompt', async () => {
    const listResponse = await fixture.postPlexusMcp(
      { method: 'prompts/list', id: 1 },
      fixture.adminHeaders()
    );
    const listBody = fixture.parseJsonRpcResponse(listResponse);

    expect(listBody.result.prompts).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'plexus_management_guide' })])
    );

    const getResponse = await fixture.postPlexusMcp(
      {
        method: 'prompts/get',
        id: 2,
        params: { name: 'plexus_management_guide' },
      },
      fixture.adminHeaders()
    );
    const getBody = fixture.parseJsonRpcResponse(getResponse);

    expect(getBody.result.messages[0].content.text).toContain('Plexus is a unified API gateway');
    expect(getBody.result.messages[0].content.text).toContain('destructive: "acknowledged"');
  });
});
