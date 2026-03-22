import { beforeEach, afterEach, describe, expect, it } from 'bun:test';
import { eq } from 'drizzle-orm';
import { closeDatabase, getDatabase, getSchema, initializeDatabase } from '../client';
import { runMigrations } from '../migrate';
import { runEncryptionMigration } from '../encrypt-migration';
import {
  decrypt,
  hashSecret,
  isEncrypted,
  resetEncryptionKeyCache,
} from '../../utils/encryption';

const TEST_KEY = 'b'.repeat(64);

function setEncryptionKey(key: string | undefined) {
  if (key === undefined) {
    delete process.env.ENCRYPTION_KEY;
  } else {
    process.env.ENCRYPTION_KEY = key;
  }
  resetEncryptionKeyCache();
}

describe('encryption migration', () => {
  let db: ReturnType<typeof getDatabase>;
  let schema: ReturnType<typeof getSchema>;

  beforeEach(async () => {
    await closeDatabase();
    process.env.DATABASE_URL = 'sqlite://:memory:';
    initializeDatabase(process.env.DATABASE_URL);
    await runMigrations();
    db = getDatabase();
    schema = getSchema();
  });

  afterEach(async () => {
    setEncryptionKey(undefined);
    await closeDatabase();
  });

  it('skips when ENCRYPTION_KEY is not set', async () => {
    setEncryptionKey(undefined);

    // Insert plaintext API key
    const ts = Date.now();
    await db.insert(schema.apiKeys).values({
      name: 'test-key',
      secret: 'sk-plaintext-123',
      createdAt: ts,
      updatedAt: ts,
    });

    await runEncryptionMigration();

    // Should remain plaintext
    const rows = await db.select().from(schema.apiKeys);
    expect(rows[0]!.secret).toBe('sk-plaintext-123');
    expect(rows[0]!.secretHash).toBeNull();
  });

  it('encrypts plaintext API keys and sets secret_hash', async () => {
    const ts = Date.now();
    await db.insert(schema.apiKeys).values({
      name: 'test-key',
      secret: 'sk-plaintext-123',
      createdAt: ts,
      updatedAt: ts,
    });

    setEncryptionKey(TEST_KEY);
    await runEncryptionMigration();

    const rows = await db.select().from(schema.apiKeys);
    expect(isEncrypted(rows[0]!.secret)).toBe(true);
    expect(decrypt(rows[0]!.secret)).toBe('sk-plaintext-123');
    expect(rows[0]!.secretHash).toBe(hashSecret('sk-plaintext-123'));
  });

  it('encrypts OAuth credentials', async () => {
    const ts = Date.now();
    await db.insert(schema.oauthCredentials).values({
      oauthProviderType: 'anthropic',
      accountId: 'test-account',
      accessToken: 'access-token-plaintext',
      refreshToken: 'refresh-token-plaintext',
      expiresAt: ts + 3600000,
      createdAt: ts,
      updatedAt: ts,
    });

    setEncryptionKey(TEST_KEY);
    await runEncryptionMigration();

    const rows = await db.select().from(schema.oauthCredentials);
    expect(isEncrypted(rows[0]!.accessToken)).toBe(true);
    expect(isEncrypted(rows[0]!.refreshToken)).toBe(true);
    expect(decrypt(rows[0]!.accessToken)).toBe('access-token-plaintext');
    expect(decrypt(rows[0]!.refreshToken)).toBe('refresh-token-plaintext');
  });

  it('encrypts provider API keys', async () => {
    const ts = Date.now();
    await db.insert(schema.providers).values({
      slug: 'test-provider',
      apiBaseUrl: '"https://api.example.com"',
      apiKey: 'provider-api-key-123',
      enabled: 1,
      disableCooldown: 0,
      estimateTokens: 0,
      useClaudeMasking: 0,
      quotaCheckerEnabled: 1,
      quotaCheckerInterval: 30,
      createdAt: ts,
      updatedAt: ts,
    });

    setEncryptionKey(TEST_KEY);
    await runEncryptionMigration();

    const rows = await db.select().from(schema.providers);
    expect(isEncrypted(rows[0]!.apiKey!)).toBe(true);
    expect(decrypt(rows[0]!.apiKey!)).toBe('provider-api-key-123');
  });

  it('encrypts provider JSON fields (headers, quotaCheckerOptions) but not extraBody', async () => {
    const ts = Date.now();
    const headers = JSON.stringify({ Authorization: 'Bearer secret-token' });
    const extraBody = JSON.stringify({ custom: 'data', nested: { key: 'val' } });
    const quotaOpts = JSON.stringify({ endpoint: '/usage', threshold: 90 });
    await db.insert(schema.providers).values({
      slug: 'json-provider',
      apiBaseUrl: '"https://api.example.com"',
      apiKey: 'pk-123',
      headers,
      extraBody,
      quotaCheckerOptions: quotaOpts,
      enabled: 1,
      disableCooldown: 0,
      estimateTokens: 0,
      useClaudeMasking: 0,
      quotaCheckerEnabled: 1,
      quotaCheckerInterval: 30,
      createdAt: ts,
      updatedAt: ts,
    });

    setEncryptionKey(TEST_KEY);
    await runEncryptionMigration();

    const rows = await db.select().from(schema.providers);
    const row = rows[0]!;
    expect(isEncrypted(row.headers as string)).toBe(true);
    expect(isEncrypted(row.quotaCheckerOptions as string)).toBe(true);
    expect(JSON.parse(decrypt(row.headers as string))).toEqual({ Authorization: 'Bearer secret-token' });
    expect(JSON.parse(decrypt(row.quotaCheckerOptions as string))).toEqual({ endpoint: '/usage', threshold: 90 });
    // extraBody should NOT be encrypted (non-sensitive config data)
    expect(row.extraBody as string).toBe(extraBody);
  });

  it('encrypts MCP server headers', async () => {
    const ts = Date.now();
    const headers = JSON.stringify({ 'X-Api-Key': 'mcp-secret' });
    await db.insert(schema.mcpServers).values({
      name: 'test-mcp',
      upstreamUrl: 'https://mcp.example.com/mcp',
      enabled: 1,
      headers,
      createdAt: ts,
      updatedAt: ts,
    });

    setEncryptionKey(TEST_KEY);
    await runEncryptionMigration();

    const rows = await db.select().from(schema.mcpServers);
    const row = rows[0]!;
    expect(isEncrypted(row.headers as string)).toBe(true);
    expect(JSON.parse(decrypt(row.headers as string))).toEqual({ 'X-Api-Key': 'mcp-secret' });
  });

  it('is idempotent (does not double-encrypt)', async () => {
    const ts = Date.now();
    await db.insert(schema.apiKeys).values({
      name: 'test-key',
      secret: 'sk-test-secret',
      createdAt: ts,
      updatedAt: ts,
    });

    setEncryptionKey(TEST_KEY);

    // Run migration twice — per-row isEncrypted checks prevent double-encryption
    await runEncryptionMigration();
    await runEncryptionMigration();

    // Should still decrypt to original value (not double-encrypted)
    const rows = await db.select().from(schema.apiKeys);
    expect(decrypt(rows[0]!.secret)).toBe('sk-test-secret');
  });
});
