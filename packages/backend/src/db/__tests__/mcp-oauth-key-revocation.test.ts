import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, getDatabase, getSchema, initializeDatabase } from '../client';
import { runMigrations } from '../migrate';
import { ConfigRepository } from '../config-repository';
import { McpOauthRepository } from '../mcp-oauth-repository';
import { hashSecret } from '../../utils/encryption';

describe('MCP OAuth token eager revocation on API key changes', () => {
  let db: ReturnType<typeof getDatabase>;
  let schema: ReturnType<typeof getSchema>;
  let configRepo: ConfigRepository;
  let oauthRepo: McpOauthRepository;

  beforeEach(async () => {
    await closeDatabase();
    process.env.DATABASE_URL = process.env.PLEXUS_TEST_DB_URL ?? process.env.DATABASE_URL;
    initializeDatabase(process.env.DATABASE_URL);
    await runMigrations();
    db = getDatabase();
    schema = getSchema();
    configRepo = new ConfigRepository();
    oauthRepo = new McpOauthRepository();

    await db.delete(schema.mcpOauthTokens);
    await db.delete(schema.mcpOauthAuthorizationCodes);
    await db.delete(schema.mcpOauthClients);
    await db.delete(schema.apiKeys);
  });

  afterEach(async () => {
    await closeDatabase();
  });

  it('sets revokedAt immediately on all active tokens bound to a rotated key', async () => {
    await configRepo.saveKey('rotating-key', { secret: 'sk-old-secret' });
    await oauthRepo.createClient({
      clientId: 'mcp_test_client',
      clientName: 'Test Client',
      redirectUris: ['http://localhost/callback'],
    });

    await oauthRepo.createToken({
      accessToken: 'pox_access_one',
      refreshToken: 'por_refresh_one',
      clientId: 'mcp_test_client',
      keyName: 'rotating-key',
      apiKeySecretHash: hashSecret('sk-old-secret'),
      resource: 'http://localhost/mcp',
      scope: 'mcp:read mcp:write',
      accessTokenExpiresAt: Date.now() + 60_000,
      refreshTokenExpiresAt: Date.now() + 120_000,
    });
    await oauthRepo.createToken({
      accessToken: 'pox_access_two',
      refreshToken: 'por_refresh_two',
      clientId: 'mcp_test_client',
      keyName: 'rotating-key',
      apiKeySecretHash: hashSecret('sk-old-secret'),
      resource: 'http://localhost/mcp',
      scope: 'mcp:read mcp:write',
      accessTokenExpiresAt: Date.now() + 60_000,
      refreshTokenExpiresAt: Date.now() + 120_000,
    });

    await configRepo.saveKey('rotating-key', { secret: 'sk-new-secret' });

    const rows = await db.select().from(schema.mcpOauthTokens);
    expect(rows).toHaveLength(2);
    expect(rows.every((row: any) => row.revokedAt !== null)).toBe(true);
  });
});
