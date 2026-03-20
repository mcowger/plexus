import { eq } from 'drizzle-orm';
import { getDatabase, getSchema } from './client';
import { ConfigRepository } from './config-repository';
import { logger } from '../utils/logger';
import {
  encrypt,
  encryptField,
  hashSecret,
  isEncrypted,
  isEncryptionEnabled,
} from '../utils/encryption';

const MIGRATION_FLAG_KEY = 'system.encryptionMigrationCompleted';

/**
 * Migrate existing plaintext sensitive data to encrypted form.
 * This runs at startup after schema migrations, before config service init.
 *
 * - Skips if ENCRYPTION_KEY is not set
 * - Skips if migration has already been completed
 * - Detects plaintext vs encrypted values by the `enc:v1:` prefix
 * - Idempotent: safe to run multiple times
 */
export async function runEncryptionMigration(): Promise<void> {
  if (!isEncryptionEnabled()) {
    logger.debug('ENCRYPTION_KEY not set, skipping encryption migration');
    return;
  }

  const repo = new ConfigRepository();
  const alreadyDone = await repo.getSetting<boolean>(MIGRATION_FLAG_KEY, false);
  if (alreadyDone) {
    logger.debug('Encryption migration already completed, skipping');
    return;
  }

  logger.info('Starting encryption migration for existing plaintext data...');

  const db = getDatabase();
  const schema = getSchema();

  let migratedCount = 0;

  // ─── API Keys ───────────────────────────────────────────────────
  try {
    const apiKeyRows = await db.select().from(schema.apiKeys);
    for (const row of apiKeyRows) {
      if (!isEncrypted(row.secret)) {
        const secretHash = hashSecret(row.secret);
        const encryptedSecret = encrypt(row.secret);
        await db
          .update(schema.apiKeys)
          .set({ secret: encryptedSecret, secretHash })
          .where(eq(schema.apiKeys.id, row.id));
        migratedCount++;
      }
    }
    logger.info(`Encrypted ${migratedCount} API key(s)`);
  } catch (error) {
    logger.error('Failed to encrypt API keys:', error);
    throw error;
  }

  // ─── OAuth Credentials ──────────────────────────────────────────
  try {
    let oauthCount = 0;
    const oauthRows = await db.select().from(schema.oauthCredentials);
    for (const row of oauthRows) {
      const updates: Record<string, string> = {};
      if (!isEncrypted(row.accessToken)) {
        updates.accessToken = encrypt(row.accessToken);
      }
      if (!isEncrypted(row.refreshToken)) {
        updates.refreshToken = encrypt(row.refreshToken);
      }
      if (Object.keys(updates).length > 0) {
        await db
          .update(schema.oauthCredentials)
          .set(updates as any)
          .where(eq(schema.oauthCredentials.id, row.id));
        oauthCount++;
      }
    }
    logger.info(`Encrypted ${oauthCount} OAuth credential(s)`);
  } catch (error) {
    logger.error('Failed to encrypt OAuth credentials:', error);
    throw error;
  }

  // ─── Providers ──────────────────────────────────────────────────
  try {
    let providerCount = 0;
    const providerRows = await db.select().from(schema.providers);
    for (const row of providerRows) {
      const updates: Record<string, any> = {};

      // Encrypt apiKey
      if (row.apiKey && !isEncrypted(row.apiKey)) {
        updates.apiKey = encrypt(row.apiKey);
      }

      // Encrypt JSONB fields that may contain sensitive data
      const jsonFields = ['headers', 'extraBody', 'quotaCheckerOptions'] as const;
      for (const field of jsonFields) {
        const val = row[field];
        if (val !== null && val !== undefined) {
          const strVal = typeof val === 'string' ? val : JSON.stringify(val);
          if (!isEncrypted(strVal)) {
            updates[field] = encrypt(strVal);
          }
        }
      }

      if (Object.keys(updates).length > 0) {
        await db
          .update(schema.providers)
          .set(updates)
          .where(eq(schema.providers.id, row.id));
        providerCount++;
      }
    }
    logger.info(`Encrypted ${providerCount} provider(s)`);
  } catch (error) {
    logger.error('Failed to encrypt providers:', error);
    throw error;
  }

  // ─── MCP Servers ────────────────────────────────────────────────
  try {
    let mcpCount = 0;
    const mcpRows = await db.select().from(schema.mcpServers);
    for (const row of mcpRows) {
      if (row.headers !== null && row.headers !== undefined) {
        const strVal = typeof row.headers === 'string' ? row.headers : JSON.stringify(row.headers);
        if (!isEncrypted(strVal)) {
          await db
            .update(schema.mcpServers)
            .set({ headers: encrypt(strVal) as any })
            .where(eq(schema.mcpServers.id, row.id));
          mcpCount++;
        }
      }
    }
    logger.info(`Encrypted ${mcpCount} MCP server(s)`);
  } catch (error) {
    logger.error('Failed to encrypt MCP servers:', error);
    throw error;
  }

  // Mark migration as completed
  await repo.setSetting(MIGRATION_FLAG_KEY, true);
  logger.info('Encryption migration completed successfully');
}
