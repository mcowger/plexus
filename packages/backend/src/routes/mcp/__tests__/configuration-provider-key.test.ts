import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, jest, test } from 'bun:test';

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
    jest.restoreAllMocks();
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
      JSON.parse(fixture.parseJsonRpcResponse(configResponse).result.content[0].text).data
    ).toMatchObject({
      providerCount: 1,
    });
    expect(
      JSON.parse(fixture.parseJsonRpcResponse(quotaResponse).result.content[0].text).data
    ).toMatchObject({
      checkerId: 'checker',
    });
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

    expect(JSON.parse(body.result.content[0].text).ok).toBe(true);
    expect(JSON.parse(body.result.content[0].text).data.api_key).toBe('[REDACTED]');
    expect(JSON.parse(body.result.content[0].text).data.headers.Authorization).toBe('[REDACTED]');
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

    expect(JSON.parse(body.result.content[0].text).ok).toBe(true);
    expect(JSON.parse(body.result.content[0].text).data.secret).toBe('[REDACTED]');
    expect(JSON.stringify(body.result)).not.toContain('sk-valid-key');
  });

  test('sends update PATCHes in merge mode so callers can send only the delta', async () => {
    const response = await fixture.postPlexusMcp(
      {
        method: 'tools/call',
        id: 1,
        params: {
          name: 'plexus_provider',
          arguments: {
            operation: 'update',
            id: 'openrouter',
            body: { models: { 'new-model': {} } },
          },
        },
      },
      fixture.adminHeaders()
    );
    expect(JSON.parse(fixture.parseJsonRpcResponse(response).result.content[0].text).ok).toBe(true);

    // `?merge=deep` keeps the stored models map intact instead of replacing it,
    // so the caller never has to read and resend the existing models.
    expect(fixture.fastify.inject).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'PATCH',
        url: '/v0/management/providers/openrouter?merge=deep',
        payload: { models: { 'new-model': {} } },
      })
    );
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
    expect(JSON.parse(updateBody.result.content[0].text).ok).toBe(true);

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
    expect(JSON.parse(getBody.result.content[0].text).data.beta).toBe(true);
  });
});
