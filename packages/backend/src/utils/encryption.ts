import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const PREFIX = 'enc:v1:';

let encryptionKey: Buffer | null = null;
let keyInitialized = false;

function getEncryptionKey(): Buffer | null {
  if (keyInitialized) return encryptionKey;
  keyInitialized = true;

  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    encryptionKey = null;
    return null;
  }

  // If exactly 64 hex chars, use directly as 32-byte key
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    encryptionKey = Buffer.from(raw, 'hex');
  } else {
    // Derive 32-byte key via SHA-256
    encryptionKey = crypto.createHash('sha256').update(raw).digest();
  }

  return encryptionKey;
}

/**
 * Reset key cache (for testing).
 */
export function resetEncryptionKeyCache(): void {
  encryptionKey = null;
  keyInitialized = false;
}

/**
 * Check if encryption is enabled (ENCRYPTION_KEY env var is set).
 */
export function isEncryptionEnabled(): boolean {
  return getEncryptionKey() !== null;
}

/**
 * Check if a value has the encrypted prefix.
 */
export function isEncrypted(value: string): boolean {
  return value.startsWith(PREFIX);
}

/**
 * Encrypt a plaintext string using AES-256-GCM.
 * Returns the original value if ENCRYPTION_KEY is not set.
 * Format: enc:v1:<iv_hex>:<auth_tag_hex>:<ciphertext_hex>
 */
export function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  if (!key) return plaintext;

  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return `${PREFIX}${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypt an encrypted string. If the value does not have the encrypted prefix,
 * returns it unchanged (backward compatibility with plaintext values).
 */
export function decrypt(value: string): string {
  if (!isEncrypted(value)) return value;

  const key = getEncryptionKey();
  if (!key) {
    throw new Error(
      'Cannot decrypt value: ENCRYPTION_KEY is not set but encrypted data was found'
    );
  }

  const parts = value.slice(PREFIX.length).split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted value format');
  }

  const [ivHex, authTagHex, ciphertextHex] = parts;
  const iv = Buffer.from(ivHex!, 'hex');
  const authTag = Buffer.from(authTagHex!, 'hex');
  const ciphertext = Buffer.from(ciphertextHex!, 'hex');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
}

/**
 * Compute SHA-256 hash of a secret for indexed lookups.
 * Always works regardless of whether encryption is enabled.
 */
export function hashSecret(secret: string): string {
  return crypto.createHash('sha256').update(secret).digest('hex');
}

/**
 * Encrypt a JSON-serializable object. Returns the encrypted string,
 * or the original JSON string if encryption is not enabled.
 */
export function encryptJson(obj: unknown): string {
  const json = JSON.stringify(obj);
  return encrypt(json);
}

/**
 * Decrypt a value that may be an encrypted JSON string, a plain JSON string,
 * or an already-parsed object (from JSONB columns).
 */
export function decryptJson(value: unknown): unknown {
  if (value === null || value === undefined) return value;

  // If it's a string, it could be encrypted or plain JSON
  if (typeof value === 'string') {
    const decrypted = decrypt(value);
    try {
      return JSON.parse(decrypted);
    } catch {
      return decrypted;
    }
  }

  // If it's an object (already parsed JSONB from PostgreSQL),
  // check if it's a JSON string value containing encrypted data
  if (typeof value === 'object') {
    return value;
  }

  return value;
}

/**
 * Encrypt a field value, returning null if input is null/undefined.
 */
export function encryptField(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return encrypt(value);
}

/**
 * Decrypt a field value, returning null if input is null/undefined.
 */
export function decryptField(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return decrypt(value);
}
