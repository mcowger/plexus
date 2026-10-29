import { describe, expect, test } from 'bun:test';

import { LocalHttpMcpServerConfigSchema } from '../src/mcp';

const localServer = {
  mode: 'local_http' as const,
  enabled: true,
  launcher: 'bunx' as const,
  package: 'example-mcp',
  port: 7345,
};

describe('LocalHttpMcpServerConfigSchema', () => {
  test('accepts normal local server config', () => {
    expect(LocalHttpMcpServerConfigSchema.safeParse(localServer).success).toBe(true);
  });

  test('rejects a configured MCP_DATA_DIR override', () => {
    const result = LocalHttpMcpServerConfigSchema.safeParse({
      ...localServer,
      env: { MCP_DATA_DIR: '/tmp/not-private' },
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toContainEqual(
        expect.objectContaining({
          path: ['env', 'MCP_DATA_DIR'],
          message: 'MCP_DATA_DIR is managed by Plexus and cannot be configured directly',
        })
      );
    }
  });
});
