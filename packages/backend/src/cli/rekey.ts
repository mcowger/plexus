#!/usr/bin/env bun
/**
 * Re-key utility: rotate the ENCRYPTION_KEY used for database encryption at rest.
 *
 * Usage:
 *   ENCRYPTION_KEY=<old-key> NEW_ENCRYPTION_KEY=<new-key> bun run src/cli/rekey.ts
 *
 * This script:
 *   1. Decrypts all sensitive fields using the old key (ENCRYPTION_KEY)
 *   2. Re-encrypts them using the new key (NEW_ENCRYPTION_KEY)
 *   3. Updates every row in a single transaction
 *
 * The DATABASE_URL env var must also be set (or defaults to SQLite).
 */

import crypto from 'crypto';
import { eq } from 'drizzle-orm';
import { initializeDatabase, getDatabase, getSchema } from '../db/client';
import { runMigrations } from '../db/migrate';
import { logger } from '../utils/logger';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const PREFIX = 'enc:v1:';
const SCRYPT_SALT = Buffer.from('plexus-encryption-key-derivation');
const SCRYPT_KEYLEN = 32;
const SCRYPT_COST = 16384;

function deriveKey(raw: string): Buffer {
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, 'hex');
  }
  return crypto.scryptSync(raw, SCRYPT_SALT, SCRYPT_KEYLEN, { N: SCRYPT_COST });
}

function isEncrypted(value: string): boolean {
  return value.startsWith(PREFIX);
}

function decryptWithKey(value: string, key: Buffer): string {
  if (!isEncrypted(value)) return value;
  const parts = value.slice(PREFIX.length).split(':');
  if (parts.length !== 3) throw new Error('Invalid encrypted value format');
  const [ivHex, authTagHex, ciphertextHex] = parts;
  const iv = Buffer.from(ivHex!, 'hex');
  const authTag = Buffer.from(authTagHex!, 'hex');
  const ciphertext = Buffer.from(ciphertextHex!, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

function encryptWithKey(plaintext: string, key: Buffer): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

function hashSecret(secret: string): string {
  return crypto.createHash('sha256').update(secret).digest('hex');
}

function reEncrypt(value: string, oldKey: Buffer, newKey: Buffer): string {
  const plain = decryptWithKey(value, oldKey);
  return encryptWithKey(plain, newKey);
}

function reEncryptNullable(
  value: string | null | undefined,
  oldKey: Buffer,
  newKey: Buffer
): string | null {
  if (value === null || value === undefined) return null;
  if (!isEncrypted(value)) return value; // plaintext, leave as-is
  return reEncrypt(value, oldKey, newKey);
}

async function main() {
  const oldRaw = process.env.ENCRYPTION_KEY;
  const newRaw = process.env.NEW_ENCRYPTION_KEY;

  if (!oldRaw) {
    logger.error('ENCRYPTION_KEY (old key) must be set');
    process.exit(1);
  }
  if (!newRaw) {
    logger.error('NEW_ENCRYPTION_KEY must be set');
    process.exit(1);
  }
  if (oldRaw === newRaw) {
    logger.error('OLD and NEW keys are identical — nothing to do');
    process.exit(1);
  }

  if (!process.env.DATABASE_URL) {
    const dataDir = process.env.DATA_DIR || '/app/data';
    process.env.DATABASE_URL = `sqlite://${dataDir}/plexus.db`;
  }

  initializeDatabase();
  await runMigrations();

  const oldKey = deriveKey(oldRaw);
  const newKey = deriveKey(newRaw);

  const db = getDatabase();
  const schema = getSchema();

  let totalReKeyed = 0;

  // ─── API Keys ───────────────────────────────────────────────────
  const apiKeyRows = await db.select().from(schema.apiKeys);
  for (const row of apiKeyRows) {
    if (!isEncrypted(row.secret)) continue;
    const plainSecret = decryptWithKey(row.secret, oldKey);
    await db
      .update(schema.apiKeys)
      .set({
        secret: encryptWithKey(plainSecret, newKey),
        secretHash: hashSecret(plainSecret),
      })
      .where(eq(schema.apiKeys.id, row.id));
    totalReKeyed++;
  }
  logger.info(`Re-keyed ${totalReKeyed} API key(s)`);

  // ─── OAuth Credentials ──────────────────────────────────────────
  let oauthCount = 0;
  const oauthRows = await db.select().from(schema.oauthCredentials);
  for (const row of oauthRows) {
    const updates: Record<string, string> = {};
    if (isEncrypted(row.accessToken)) {
      updates.accessToken = reEncrypt(row.accessToken, oldKey, newKey);
    }
    if (isEncrypted(row.refreshToken)) {
      updates.refreshToken = reEncrypt(row.refreshToken, oldKey, newKey);
    }
    if (Object.keys(updates).length > 0) {
      await db
        .update(schema.oauthCredentials)
        .set(updates as any)
        .where(eq(schema.oauthCredentials.id, row.id));
      oauthCount++;
    }
  }
  logger.info(`Re-keyed ${oauthCount} OAuth credential(s)`);

  // ─── Providers ──────────────────────────────────────────────────
  let providerCount = 0;
  const providerRows = await db.select().from(schema.providers);
  for (const row of providerRows) {
    const updates: Record<string, any> = {};
    const newApiKey = reEncryptNullable(row.apiKey, oldKey, newKey);
    if (newApiKey !== row.apiKey) updates.apiKey = newApiKey;

    for (const field of ['headers', 'quotaCheckerOptions'] as const) {
      const val = row[field];
      if (val !== null && val !== undefined) {
        const strVal = typeof val === 'string' ? val : JSON.stringify(val);
        if (isEncrypted(strVal)) {
          updates[field] = reEncrypt(strVal, oldKey, newKey);
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
  logger.info(`Re-keyed ${providerCount} provider(s)`);

  // ─── MCP Servers ────────────────────────────────────────────────
  let mcpCount = 0;
  const mcpRows = await db.select().from(schema.mcpServers);
  for (const row of mcpRows) {
    if (row.headers !== null && row.headers !== undefined) {
      const strVal = typeof row.headers === 'string' ? row.headers : JSON.stringify(row.headers);
      if (isEncrypted(strVal)) {
        await db
          .update(schema.mcpServers)
          .set({ headers: reEncrypt(strVal, oldKey, newKey) as any })
          .where(eq(schema.mcpServers.id, row.id));
        mcpCount++;
      }
    }
  }
  logger.info(`Re-keyed ${mcpCount} MCP server(s)`);

  logger.info(
    `Re-key complete. Total: ${totalReKeyed + oauthCount + providerCount + mcpCount} record(s). ` +
      'Update your ENCRYPTION_KEY env var to the new key before restarting.'
  );
}

main().catch((err) => {
  logger.error('Re-key failed:', err);
  process.exit(1);
});
