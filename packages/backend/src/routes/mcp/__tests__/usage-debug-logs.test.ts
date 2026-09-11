import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { createPlexusMcpTestFixture } from './plexus-mcp-test-fixtures';

describe('Plexus management MCP routes - usage, debug, and logs', () => {
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

  test('records plexus admin MCP requests in MCP usage logs', async () => {
    const response = await fixture.postPlexusMcp(
      {
        method: 'tools/call',
        id: 1,
        params: {
          name: 'plexus_config',
          arguments: { operation: 'status' },
        },
      },
      fixture.adminHeaders()
    );

    expect(response.statusCode).toBe(200);
    expect(fixture.mockMcpUsageStorage.saveRequest).toHaveBeenCalled();
    const record = (fixture.mockMcpUsageStorage.saveRequest as any).mock.calls.at(-1)?.[0];
    expect(record.server_name).toBe('plexus');
    expect(record.upstream_url).toBe('/mcp/plexus');
    expect(record.method).toBe('POST');
    expect(record.jsonrpc_method).toBe('tools/call');
    expect(record.tool_name).toBe('plexus_config');
    expect(record.api_key).toBe('admin');
    expect(record.response_status).toBe(200);
  });

  test('requires acknowledgement for destructive operations', async () => {
    const response = await fixture.postPlexusMcp(
      {
        method: 'tools/call',
        id: 1,
        params: {
          name: 'plexus_usage',
          arguments: { operation: 'delete_all' },
        },
      },
      fixture.adminHeaders()
    );
    const body = fixture.parseJsonRpcResponse(response);

    expect(body.result.isError).toBe(true);
    expect(body.result.structuredContent.error.type).toBe('confirmation_required');
  });

  test('allows acknowledged destructive operations to reach handler', async () => {
    const response = await fixture.postPlexusMcp(
      {
        method: 'tools/call',
        id: 1,
        params: {
          name: 'plexus_usage',
          arguments: { operation: 'delete_all', destructive: 'acknowledged' },
        },
      },
      fixture.adminHeaders()
    );
    const body = fixture.parseJsonRpcResponse(response);

    expect(body.result.isError).toBe(false);
    expect(body.result.structuredContent.data.success).toBe(true);
  });

  test('implements plexus_usage list', async () => {
    const response = await fixture.postPlexusMcp(
      {
        method: 'tools/call',
        id: 1,
        params: {
          name: 'plexus_usage',
          arguments: { operation: 'list', query: { limit: 10 } },
        },
      },
      fixture.adminHeaders()
    );
    const body = fixture.parseJsonRpcResponse(response);

    expect(body.result.structuredContent.ok).toBe(true);
    expect(body.result.structuredContent.data.total).toBe(1);
    expect(fixture.mockUsageStorage.getUsage).toHaveBeenCalled();
  });

  test('implements plexus_debug state and update', async () => {
    const updateResponse = await fixture.postPlexusMcp(
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
      fixture.adminHeaders()
    );
    const updateBody = fixture.parseJsonRpcResponse(updateResponse);
    expect(updateBody.result.structuredContent.ok).toBe(true);
    expect(updateBody.result.structuredContent.data.enabledGlobal).toBe(true);
    expect(updateBody.result.structuredContent.data.providers).toEqual(['openrouter']);

    const stateResponse = await fixture.postPlexusMcp(
      {
        method: 'tools/call',
        id: 2,
        params: {
          name: 'plexus_debug',
          arguments: { operation: 'state' },
        },
      },
      fixture.adminHeaders()
    );
    const stateBody = fixture.parseJsonRpcResponse(stateResponse);
    expect(stateBody.result.structuredContent.ok).toBe(true);
    expect(stateBody.result.structuredContent.data.enabledGlobal).toBe(true);
  });

  test('implements plexus_debug log operations', async () => {
    const logsResponse = await fixture.postPlexusMcp(
      {
        method: 'tools/call',
        id: 1,
        params: {
          name: 'plexus_debug',
          arguments: { operation: 'logs' },
        },
      },
      fixture.adminHeaders()
    );
    const logsBody = fixture.parseJsonRpcResponse(logsResponse);
    expect(logsBody.result.structuredContent.data[0].requestId).toBe('req-debug');

    const getResponse = await fixture.postPlexusMcp(
      {
        method: 'tools/call',
        id: 2,
        params: {
          name: 'plexus_debug',
          arguments: { operation: 'get_log', id: 'req-debug' },
        },
      },
      fixture.adminHeaders()
    );
    const getBody = fixture.parseJsonRpcResponse(getResponse);
    expect(getBody.result.structuredContent.data.requestId).toBe('req-debug');
  });

  test('implements plexus_system_logs recent', async () => {
    const response = await fixture.postPlexusMcp(
      {
        method: 'tools/call',
        id: 1,
        params: {
          name: 'plexus_system_logs',
          arguments: { operation: 'recent', query: { limit: 10 } },
        },
      },
      fixture.adminHeaders()
    );
    const body = fixture.parseJsonRpcResponse(response);
    expect(body.result.structuredContent.ok).toBe(true);
    expect(body.result.structuredContent.data.total).toBe(1);
    expect(body.result.structuredContent.data.data[0].message).toBe('system-log');
  });

  test('implements plexus_system_logs level operations', async () => {
    const levelResponse = await fixture.postPlexusMcp(
      {
        method: 'tools/call',
        id: 1,
        params: {
          name: 'plexus_system_logs',
          arguments: { operation: 'level' },
        },
      },
      fixture.adminHeaders()
    );
    const levelBody = fixture.parseJsonRpcResponse(levelResponse);
    expect(levelBody.result.structuredContent.data.level).toBe('info');

    const setLevelResponse = await fixture.postPlexusMcp(
      {
        method: 'tools/call',
        id: 2,
        params: {
          name: 'plexus_system_logs',
          arguments: { operation: 'set_level', body: { level: 'debug' } },
        },
      },
      fixture.adminHeaders()
    );
    const setLevelBody = fixture.parseJsonRpcResponse(setLevelResponse);
    expect(setLevelBody.result.structuredContent.data.level).toBe('debug');

    const resetLevelResponse = await fixture.postPlexusMcp(
      {
        method: 'tools/call',
        id: 3,
        params: {
          name: 'plexus_system_logs',
          arguments: { operation: 'reset_level' },
        },
      },
      fixture.adminHeaders()
    );
    const resetLevelBody = fixture.parseJsonRpcResponse(resetLevelResponse);
    expect(resetLevelBody.result.structuredContent.data.level).toBe('info');
  });
});
