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

  test('strips MCP_DATA_DIR overrides in any casing, including legacy configs', () => {
    const result = LocalHttpMcpServerConfigSchema.safeParse({
      ...localServer,
      env: {
        MCP_DATA_DIR: '/tmp/not-private',
        mcp_data_dir: '/tmp/also-not-private',
        CUSTOM_SETTING: 'kept',
      },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.env).toEqual({ CUSTOM_SETTING: 'kept' });
    }
  });
});
