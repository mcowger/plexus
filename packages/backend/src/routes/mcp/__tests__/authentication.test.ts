import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, jest, test } from 'bun:test';

import * as mcpProxyService from '../../../services/mcp-proxy/mcp-proxy-service';
import { createPlexusMcpTestFixture, TEST_ADMIN_KEY } from './plexus-mcp-test-fixtures';

describe('Plexus management MCP routes - authentication', () => {
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

  test('rejects missing x-admin-key', async () => {
    const response = await fixture.postPlexusMcp({ method: 'tools/list', id: 1 });

    expect(response.statusCode).toBe(401);
  });

  test('rejects wrong x-admin-key', async () => {
    const response = await fixture.postPlexusMcp(
      { method: 'tools/list', id: 1 },
      { 'x-admin-key': 'wrong' }
    );

    expect(response.statusCode).toBe(401);
  });

  test('rejects limited key sent as bearer token', async () => {
    const response = await fixture.postPlexusMcp(
      { method: 'tools/list', id: 1 },
      { authorization: 'Bearer sk-valid-key' }
    );

    expect(response.statusCode).toBe(403);
  });

  test('rejects wrong bearer token', async () => {
    const response = await fixture.postPlexusMcp(
      { method: 'tools/list', id: 1 },
      { authorization: 'Bearer wrong' }
    );

    expect(response.statusCode).toBe(401);
  });

  test('accepts admin key as bearer token', async () => {
    const response = await fixture.postPlexusMcp(
      { method: 'tools/list', id: 1 },
      { authorization: `Bearer ${TEST_ADMIN_KEY}` }
    );

    expect(response.statusCode).toBe(200);
  });

  test('prefers x-admin-key over a bearer token', async () => {
    const response = await fixture.postPlexusMcp(
      { method: 'tools/list', id: 1 },
      { 'x-admin-key': 'wrong', authorization: `Bearer ${TEST_ADMIN_KEY}` }
    );

    expect(response.statusCode).toBe(401);
  });

  test('forwards a bearer admin key to the management shim', async () => {
    const response = await fixture.postPlexusMcp(
      {
        method: 'tools/call',
        id: 1,
        params: { name: 'plexus_config', arguments: { operation: 'status' } },
      },
      { authorization: `Bearer ${TEST_ADMIN_KEY}` }
    );

    const body = fixture.parseJsonRpcResponse(response);
    expect(body.result.structuredContent.ok).toBe(true);
  });

  test('rejects limited key sent as x-admin-key', async () => {
    const response = await fixture.postPlexusMcp(
      { method: 'tools/list', id: 1 },
      { 'x-admin-key': 'sk-valid-key' }
    );

    expect(response.statusCode).toBe(403);
  });

  test('handles /mcp/plexus without proxying to upstream gateway', async () => {
    const response = await fixture.postPlexusMcp(
      { method: 'tools/list', id: 1 },
      fixture.adminHeaders()
    );

    expect(response.statusCode).toBe(200);
    expect(mcpProxyService.proxyMcpRequest).not.toHaveBeenCalled();
  });
});
