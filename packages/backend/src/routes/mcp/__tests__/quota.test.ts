import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { createPlexusMcpTestFixture } from './plexus-mcp-test-fixtures';

describe('Plexus management MCP routes - quota', () => {
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

  test('implements plexus_quota status for a key', async () => {
    const response = await fixture.postPlexusMcp(
      {
        method: 'tools/call',
        id: 1,
        params: {
          name: 'plexus_quota',
          arguments: { operation: 'status', id: 'test-key' },
        },
      },
      fixture.adminHeaders()
    );
    const body = fixture.parseJsonRpcResponse(response);

    expect(body.result.structuredContent.ok).toBe(true);
    expect(body.result.structuredContent.data.key).toBe('test-key');
    expect(body.result.structuredContent.data.quotas).toEqual([
      expect.objectContaining({ name: 'daily', source: 'assigned', shared: false }),
    ]);
    expect(body.result.structuredContent.data.quota_name).toBe('daily');
  });

  test('plexus_quota status surfaces 404 for an unknown key', async () => {
    const response = await fixture.postPlexusMcp(
      {
        method: 'tools/call',
        id: 1,
        params: {
          name: 'plexus_quota',
          arguments: { operation: 'status', id: 'missing-key' },
        },
      },
      fixture.adminHeaders()
    );
    const body = fixture.parseJsonRpcResponse(response);

    expect(body.result.isError).toBe(true);
    expect(body.result.structuredContent.error.code).toBe(404);
    expect(body.result.structuredContent.error.type).toBe('not_found_error');
  });

  test('plexus_quota clear requires acknowledgement', async () => {
    const response = await fixture.postPlexusMcp(
      {
        method: 'tools/call',
        id: 1,
        params: {
          name: 'plexus_quota',
          arguments: { operation: 'clear', body: { key: 'test-key' } },
        },
      },
      fixture.adminHeaders()
    );
    const body = fixture.parseJsonRpcResponse(response);

    expect(body.result.isError).toBe(true);
    expect(body.result.structuredContent.error.type).toBe('confirmation_required');
  });

  test('implements plexus_quota clear for every quota attached to a key', async () => {
    const response = await fixture.postPlexusMcp(
      {
        method: 'tools/call',
        id: 1,
        params: {
          name: 'plexus_quota',
          arguments: {
            operation: 'clear',
            body: { key: 'test-key' },
            destructive: 'acknowledged',
          },
        },
      },
      fixture.adminHeaders()
    );
    const body = fixture.parseJsonRpcResponse(response);

    expect(body.result.structuredContent.ok).toBe(true);
    expect(body.result.structuredContent.data).toEqual(
      expect.objectContaining({ success: true, key: 'test-key', quota: null })
    );
  });

  test('implements plexus_quota clear for a single named quota', async () => {
    const response = await fixture.postPlexusMcp(
      {
        method: 'tools/call',
        id: 1,
        params: {
          name: 'plexus_quota',
          arguments: {
            operation: 'clear',
            body: { key: 'test-key', quota: 'daily' },
            destructive: 'acknowledged',
          },
        },
      },
      fixture.adminHeaders()
    );
    const body = fixture.parseJsonRpcResponse(response);

    expect(body.result.structuredContent.ok).toBe(true);
    expect(body.result.structuredContent.data).toEqual(
      expect.objectContaining({ success: true, key: 'test-key', quota: 'daily' })
    );
  });

  test('plexus_quota clear surfaces 400 for a quota not attached to the key', async () => {
    const response = await fixture.postPlexusMcp(
      {
        method: 'tools/call',
        id: 1,
        params: {
          name: 'plexus_quota',
          arguments: {
            operation: 'clear',
            body: { key: 'test-key', quota: 'unattached' },
            destructive: 'acknowledged',
          },
        },
      },
      fixture.adminHeaders()
    );
    const body = fixture.parseJsonRpcResponse(response);

    expect(body.result.isError).toBe(true);
    expect(body.result.structuredContent.error.code).toBe(400);
  });

  test('plexus_quota clear surfaces 404 for an unknown key', async () => {
    const response = await fixture.postPlexusMcp(
      {
        method: 'tools/call',
        id: 1,
        params: {
          name: 'plexus_quota',
          arguments: {
            operation: 'clear',
            body: { key: 'missing-key' },
            destructive: 'acknowledged',
          },
        },
      },
      fixture.adminHeaders()
    );
    const body = fixture.parseJsonRpcResponse(response);

    expect(body.result.isError).toBe(true);
    expect(body.result.structuredContent.error.code).toBe(404);
  });

  test('implements plexus_quota recompute for a named quota', async () => {
    const response = await fixture.postPlexusMcp(
      {
        method: 'tools/call',
        id: 1,
        params: {
          name: 'plexus_quota',
          arguments: { operation: 'recompute', body: { key: 'test-key', quota: 'daily' } },
        },
      },
      fixture.adminHeaders()
    );
    const body = fixture.parseJsonRpcResponse(response);

    expect(body.result.structuredContent.ok).toBe(true);
    expect(body.result.structuredContent.data).toEqual(
      expect.objectContaining({ success: true, key: 'test-key', quota: 'daily', usage: 42 })
    );
    expect(body.result.structuredContent.data.windowStartMs).toBe(1700000000000);
  });

  test('plexus_quota recompute passes through the 400 reason for unsupported quota types', async () => {
    const response = await fixture.postPlexusMcp(
      {
        method: 'tools/call',
        id: 1,
        params: {
          name: 'plexus_quota',
          arguments: { operation: 'recompute', body: { key: 'test-key', quota: 'leaky' } },
        },
      },
      fixture.adminHeaders()
    );
    const body = fixture.parseJsonRpcResponse(response);

    expect(body.result.isError).toBe(true);
    expect(body.result.structuredContent.error.code).toBe(400);
    expect(body.result.structuredContent.error.message).toContain('unsupported_quota_type');
  });

  test('plexus_quota recompute surfaces 404 for an unknown key', async () => {
    const response = await fixture.postPlexusMcp(
      {
        method: 'tools/call',
        id: 1,
        params: {
          name: 'plexus_quota',
          arguments: { operation: 'recompute', body: { key: 'missing-key', quota: 'daily' } },
        },
      },
      fixture.adminHeaders()
    );
    const body = fixture.parseJsonRpcResponse(response);

    expect(body.result.isError).toBe(true);
    expect(body.result.structuredContent.error.code).toBe(404);
  });

  test('plexus_quota recompute surfaces 400 for a quota not attached to the key', async () => {
    const response = await fixture.postPlexusMcp(
      {
        method: 'tools/call',
        id: 1,
        params: {
          name: 'plexus_quota',
          arguments: { operation: 'recompute', body: { key: 'test-key', quota: 'unattached' } },
        },
      },
      fixture.adminHeaders()
    );
    const body = fixture.parseJsonRpcResponse(response);

    expect(body.result.isError).toBe(true);
    expect(body.result.structuredContent.error.code).toBe(400);
  });
});
