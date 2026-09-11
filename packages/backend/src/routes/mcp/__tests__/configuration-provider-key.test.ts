import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { createPlexusMcpTestFixture } from './plexus-mcp-test-fixtures';

describe('Plexus management MCP routes - configuration, provider, and key', () => {
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

  test('uses management routes for config status and quota checker operations', async () => {
    const configResponse = await fixture.postPlexusMcp(
      {
        method: 'tools/call',
        id: 1,
        params: { name: 'plexus_config', arguments: { operation: 'status' } },
      },
      fixture.adminHeaders()
    );
    const quotaResponse = await fixture.postPlexusMcp(
      {
        method: 'tools/call',
        id: 2,
        params: { name: 'plexus_quota_checker', arguments: { operation: 'get', id: 'checker' } },
      },
      fixture.adminHeaders()
    );

    expect(
      fixture.parseJsonRpcResponse(configResponse).result.structuredContent.data
    ).toMatchObject({
      providerCount: 1,
    });
    expect(fixture.parseJsonRpcResponse(quotaResponse).result.structuredContent.data).toMatchObject(
      {
        checkerId: 'checker',
      }
    );
    expect(fixture.fastify.inject).toHaveBeenCalledWith(
      expect.objectContaining({ url: '/v0/management/config/status' })
    );
    expect(fixture.fastify.inject).toHaveBeenCalledWith(
      expect.objectContaining({ url: '/v0/management/quotas/checker' })
    );
  });

  test('returns redacted provider data from tool calls', async () => {
    const response = await fixture.postPlexusMcp(
      {
        method: 'tools/call',
        id: 1,
        params: {
          name: 'plexus_provider',
          arguments: { operation: 'get', id: 'openrouter' },
        },
      },
      fixture.adminHeaders()
    );
    const body = fixture.parseJsonRpcResponse(response);

    expect(body.result.structuredContent.ok).toBe(true);
    expect(body.result.structuredContent.data.api_key).toBe('[REDACTED]');
    expect(body.result.structuredContent.data.headers.Authorization).toBe('[REDACTED]');
    expect(JSON.stringify(body.result)).not.toContain('provider-secret');
    expect(JSON.stringify(body.result)).not.toContain('upstream-secret');
  });

  test('returns redacted key data from tool calls', async () => {
    const response = await fixture.postPlexusMcp(
      {
        method: 'tools/call',
        id: 1,
        params: {
          name: 'plexus_key',
          arguments: { operation: 'get', id: 'test-key' },
        },
      },
      fixture.adminHeaders()
    );
    const body = fixture.parseJsonRpcResponse(response);

    expect(body.result.structuredContent.ok).toBe(true);
    expect(body.result.structuredContent.data.secret).toBe('[REDACTED]');
    expect(JSON.stringify(body.result)).not.toContain('sk-valid-key');
  });

  test('implements plexus_key update through the management shim', async () => {
    const updateResponse = await fixture.postPlexusMcp(
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
      fixture.adminHeaders()
    );
    const updateBody = fixture.parseJsonRpcResponse(updateResponse);
    expect(updateBody.result.structuredContent.ok).toBe(true);

    const getResponse = await fixture.postPlexusMcp(
      {
        method: 'tools/call',
        id: 2,
        params: {
          name: 'plexus_key',
          arguments: { operation: 'get', id: 'test-key' },
        },
      },
      fixture.adminHeaders()
    );
    const getBody = fixture.parseJsonRpcResponse(getResponse);
    expect(getBody.result.structuredContent.data.beta).toBe(true);
  });
});
