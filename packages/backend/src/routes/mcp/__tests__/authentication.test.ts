import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import * as mcpProxyService from '../../../services/mcp-proxy/mcp-proxy-service';
import { createPlexusMcpTestFixture } from './plexus-mcp-test-fixtures';

describe('Plexus management MCP routes - authentication', () => {
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

  test('rejects bearer-only inference auth', async () => {
    const response = await fixture.postPlexusMcp(
      { method: 'tools/list', id: 1 },
      { authorization: 'Bearer sk-valid-key' }
    );

    expect(response.statusCode).toBe(401);
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
