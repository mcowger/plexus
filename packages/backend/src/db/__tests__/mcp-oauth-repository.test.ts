import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  update: vi.fn(),
  schema: {
    mcpOauthAuthorizationCodes: {
      codeHash: {},
      consumedAt: {},
    },
    mcpOauthTokens: {
      refreshTokenHash: {},
      revokedAt: {},
    },
  },
}));

vi.mock('../client', () => ({
  getDatabase: () => ({ update: mocks.update }),
  getSchema: () => mocks.schema,
}));

import { McpOauthRepository } from '../mcp-oauth-repository';

describe('McpOauthRepository affected-row counts', () => {
  const repository = new McpOauthRepository();

  beforeEach(() => {
    mocks.update.mockReset();
  });

  function mockPostgresUpdateResult(count: number) {
    mocks.update.mockReturnValue({
      set: () => ({
        where: () => Promise.resolve({ count }),
      }),
    });
  }

  test('recognizes postgres-js count when consuming an authorization code', async () => {
    mockPostgresUpdateResult(1);

    await expect(repository.consumeAuthorizationCode('poc_test_code')).resolves.toBe(true);
  });

  test('recognizes postgres-js count when revoking a refresh token', async () => {
    mockPostgresUpdateResult(1);

    await expect(repository.revokeRefreshToken('por_test_token')).resolves.toBe(true);
  });
});
