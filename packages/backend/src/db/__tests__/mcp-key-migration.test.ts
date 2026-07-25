import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDatabase, getDatabase, getSchema, initializeDatabase } from '../client';
import { runMigrations } from '../migrate';
import { runMcpKeyMigration } from '../mcp-key-migration';
import { decryptJson, encrypt } from '../../utils/encryption';
import { toDbBoolean } from '../../utils/normalize';

describe('MCP key migration', () => {
  let db: ReturnType<typeof getDatabase>;
  let schema: ReturnType<typeof getSchema>;

  beforeEach(async () => {
    await closeDatabase();
    process.env.DATABASE_URL = process.env.PLEXUS_TEST_DB_URL ?? process.env.DATABASE_URL;
    initializeDatabase(process.env.DATABASE_URL);
    await runMigrations();
    db = getDatabase();
    schema = getSchema();
    await db.delete(schema.mcpServers);
  });

  afterEach(async () => {
    await closeDatabase();
  });

  it('moves a remote x-api-key header into mcp_keys', async () => {
    const timestamp = Date.now();
    await db.insert(schema.mcpServers).values({
      name: 'exa',
      upstreamUrl: 'https://mcp.exa.ai/mcp',
      enabled: toDbBoolean(true),
      headers: encrypt(JSON.stringify({ 'x-api-key': 'exa-secret', Accept: 'application/json' })),
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    expect(await runMcpKeyMigration()).toBe(1);

    const [server] = await db.select().from(schema.mcpServers);
    const [key] = await db.select().from(schema.mcpKeys);
    expect(key).toMatchObject({ mcpServerId: server!.id, key: 'exa-secret' });
    expect(server!.authScheme).toBe('x-api-key');
    expect(decryptJson(server!.headers)).toEqual({ Accept: 'application/json' });
  });

  it('does not replace existing keys or migrate local servers', async () => {
    const timestamp = Date.now();
    await db.insert(schema.mcpServers).values([
      {
        name: 'configured',
        upstreamUrl: 'https://example.com/mcp',
        enabled: toDbBoolean(true),
        headers: JSON.stringify({ Authorization: 'Bearer legacy-secret' }),
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      {
        name: 'local',
        upstreamUrl: 'http://127.0.0.1:3000/mcp',
        enabled: toDbBoolean(true),
        mode: 'local_http',
        headers: JSON.stringify({ 'x-api-key': 'local-secret' }),
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ]);
    const [configured] = await db
      .select()
      .from(schema.mcpServers)
      .where(eq(schema.mcpServers.name, 'configured'));
    await db.insert(schema.mcpKeys).values({
      mcpServerId: configured!.id,
      key: 'existing-secret',
      createdAt: new Date(timestamp),
      updatedAt: new Date(timestamp),
    });

    expect(await runMcpKeyMigration()).toBe(0);
    const keys = await db.select().from(schema.mcpKeys);
    const servers = await db.select().from(schema.mcpServers);
    expect(keys).toHaveLength(1);
    expect(keys[0]!.key).toBe('existing-secret');
    expect(
      decryptJson(servers.find((server: { name: string }) => server.name === 'configured')!.headers)
    ).toEqual({
      Authorization: 'Bearer legacy-secret',
    });
  });
});
