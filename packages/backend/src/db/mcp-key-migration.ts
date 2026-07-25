import { eq } from 'drizzle-orm';
import { getCurrentDialect, getDatabase, getSchema } from './client';
import { decryptJson, encrypt } from '../utils/encryption';
import { toDbTimestampMs } from '../utils/normalize';
import { logger } from '../utils/logger';

const AUTH_HEADERS = new Map([
  ['x-api-key', 'x-api-key'],
  ['x-goog-api-key', 'x-goog-api-key'],
  ['x-subscription-token', 'x-subscription-token'],
]);

type AuthScheme = 'bearer' | 'x-api-key' | 'x-goog-api-key' | 'x-subscription-token';

function extractLegacyCredential(
  headers: unknown
):
  | { key: string; scheme: AuthScheme; header: string; headers: Record<string, string> }
  | undefined {
  const parsed = decryptJson(headers);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;

  const entries = Object.entries(parsed).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string'
  );
  const legacyHeaders = Object.fromEntries(entries);

  for (const [header, value] of entries) {
    const normalizedHeader = header.toLowerCase();
    if (normalizedHeader === 'authorization') {
      const match = /^Bearer\s+(.+)$/i.exec(value.trim());
      if (match?.[1]) {
        return { key: match[1], scheme: 'bearer', header, headers: legacyHeaders };
      }
      continue;
    }

    const scheme = AUTH_HEADERS.get(normalizedHeader);
    if (scheme && value.trim()) {
      return { key: value.trim(), scheme: scheme as AuthScheme, header, headers: legacyHeaders };
    }
  }

  return undefined;
}

/**
 * Moves legacy remote MCP credentials from persisted headers into mcp_keys.
 * This is idempotent: servers with an existing key are left untouched.
 */
export async function runMcpKeyMigration(): Promise<number> {
  const db = getDatabase();
  const schema = getSchema();
  const timestamp = toDbTimestampMs(Date.now(), getCurrentDialect());
  let migratedCount = 0;

  const servers = await db.select().from(schema.mcpServers);
  for (const server of servers) {
    if (server.mode === 'local_http' || !server.headers) continue;

    const credential = extractLegacyCredential(server.headers);
    if (!credential) continue;

    await db.transaction(async (tx: typeof db) => {
      const existingKeys = await tx
        .select({ id: schema.mcpKeys.id })
        .from(schema.mcpKeys)
        .where(eq(schema.mcpKeys.mcpServerId, server.id))
        .limit(1);
      if (existingKeys.length > 0) return;

      delete credential.headers[credential.header];
      await tx.insert(schema.mcpKeys).values({
        mcpServerId: server.id,
        key: encrypt(credential.key),
        createdAt: timestamp!,
        updatedAt: timestamp!,
      });
      await tx
        .update(schema.mcpServers)
        .set({
          authScheme: credential.scheme,
          headers: Object.keys(credential.headers).length
            ? encrypt(JSON.stringify(credential.headers))
            : null,
          updatedAt: Date.now(),
        })
        .where(eq(schema.mcpServers.id, server.id));
      migratedCount++;
    });
  }

  if (migratedCount > 0) {
    logger.info(`Migrated ${migratedCount} legacy MCP server credential(s)`);
  }
  return migratedCount;
}
