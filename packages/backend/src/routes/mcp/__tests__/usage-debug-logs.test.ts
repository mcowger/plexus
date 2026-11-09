import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  spyOn,
  test,
} from 'bun:test';

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
    jest.restoreAllMocks();
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
    expect(JSON.parse(body.result.content[0].text).error.type).toBe('confirmation_required');
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
    expect(JSON.parse(body.result.content[0].text).data.success).toBe(true);
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

    expect(JSON.parse(body.result.content[0].text).ok).toBe(true);
    expect(JSON.parse(body.result.content[0].text).data.total).toBe(1);
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
    expect(JSON.parse(updateBody.result.content[0].text).ok).toBe(true);
    expect(JSON.parse(updateBody.result.content[0].text).data.enabledGlobal).toBe(true);
    expect(JSON.parse(updateBody.result.content[0].text).data.providers).toEqual(['openrouter']);

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
    expect(JSON.parse(stateBody.result.content[0].text).ok).toBe(true);
    expect(JSON.parse(stateBody.result.content[0].text).data.enabledGlobal).toBe(true);
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
    expect(JSON.parse(logsBody.result.content[0].text).data[0].requestId).toBe('req-debug');

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
    expect(JSON.parse(getBody.result.content[0].text).data.requestId).toBe('req-debug');
  });

  test('returns a bounded download reference for a large debug trace', async () => {
    const payload = '日志'.repeat(40_000);
    spyOn(fixture.mockUsageStorage, 'getDebugLog').mockResolvedValueOnce({
      requestId: 'large',
      rawResponse: payload,
    });
    const response = await fixture.postPlexusMcp(
      {
        method: 'tools/call',
        id: 8,
        params: { name: 'plexus_debug', arguments: { operation: 'get_log', id: 'large' } },
      },
      fixture.adminHeaders()
    );
    const result = fixture.parseJsonRpcResponse(response).result;
    expect(result.structuredContent).toBeUndefined();
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(128 * 1024);
    const { download, reason, instructions } = JSON.parse(result.content[0].text);
    expect(reason).toContain('128 KiB');
    expect(instructions).toContain('curl');
    expect(instructions).toContain('plexus://management/log-formats');
    expect(download.bytes).toBeGreaterThan(128 * 1024);
    const url = new URL(download.url);
    const missing = await fixture.fastify.inject({ method: 'GET', url: url.pathname });
    expect(missing.statusCode).toBe(404);
    const invalid = await fixture.fastify.inject({
      method: 'GET',
      url: `${url.pathname}?token=invalid`,
    });
    expect(invalid.statusCode).toBe(404);
    const fetched = await fixture.fastify.inject({
      method: 'GET',
      url: `${url.pathname}${url.search}`,
    });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.headers['cache-control']).toBe('no-store');
    expect(Buffer.byteLength(fetched.body)).toBe(download.bytes);
    expect(JSON.parse(fetched.body).data.rawResponse).toBe(payload);
  });

  test('exposes debug and error log format resource', async () => {
    const response = await fixture.postPlexusMcp(
      {
        method: 'resources/read',
        id: 9,
        params: { uri: 'plexus://management/log-formats' },
      },
      fixture.adminHeaders()
    );
    const resource = fixture.parseJsonRpcResponse(response).result.contents[0];
    expect(resource.text).toContain('rawResponseSnapshot');
    expect(resource.text).toContain('errorMessage');
    expect(resource.text).toContain('requestId');
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
    expect(JSON.parse(body.result.content[0].text).ok).toBe(true);
    expect(JSON.parse(body.result.content[0].text).data.total).toBe(1);
    expect(JSON.parse(body.result.content[0].text).data.data[0].message).toBe('system-log');
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
    expect(JSON.parse(levelBody.result.content[0].text).data.level).toBe('info');

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
    expect(JSON.parse(setLevelBody.result.content[0].text).data.level).toBe('debug');

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
    expect(JSON.parse(resetLevelBody.result.content[0].text).data.level).toBe('info');
  });
});
