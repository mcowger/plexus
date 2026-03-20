import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import {
  encrypt,
  decrypt,
  hashSecret,
  isEncrypted,
  isEncryptionEnabled,
  encryptJson,
  decryptJson,
  encryptField,
  decryptField,
  resetEncryptionKeyCache,
} from '../encryption';

const TEST_KEY_HEX = 'a'.repeat(64); // 64 hex chars = 32 bytes
const TEST_KEY_PASSPHRASE = 'my-secret-passphrase';

function setEncryptionKey(key: string | undefined) {
  if (key === undefined) {
    delete process.env.ENCRYPTION_KEY;
  } else {
    process.env.ENCRYPTION_KEY = key;
  }
  resetEncryptionKeyCache();
}

describe('encryption utility', () => {
  let originalEncryptionKey: string | undefined;

  beforeEach(() => {
    originalEncryptionKey = process.env.ENCRYPTION_KEY;
  });

  afterEach(() => {
    setEncryptionKey(originalEncryptionKey);
  });

  describe('isEncryptionEnabled', () => {
    test('returns false when ENCRYPTION_KEY is not set', () => {
      setEncryptionKey(undefined);
      expect(isEncryptionEnabled()).toBe(false);
    });

    test('returns true when ENCRYPTION_KEY is set', () => {
      setEncryptionKey(TEST_KEY_HEX);
      expect(isEncryptionEnabled()).toBe(true);
    });
  });

  describe('encrypt / decrypt round-trip', () => {
    test('encrypts and decrypts correctly with hex key', () => {
      setEncryptionKey(TEST_KEY_HEX);
      const plaintext = 'sk-test-api-key-12345';
      const encrypted = encrypt(plaintext);
      expect(encrypted).toStartWith('enc:v1:');
      expect(encrypted).not.toBe(plaintext);
      expect(decrypt(encrypted)).toBe(plaintext);
    });

    test('encrypts and decrypts correctly with passphrase key', () => {
      setEncryptionKey(TEST_KEY_PASSPHRASE);
      const plaintext = 'oauth-refresh-token-xyz';
      const encrypted = encrypt(plaintext);
      expect(encrypted).toStartWith('enc:v1:');
      expect(decrypt(encrypted)).toBe(plaintext);
    });

    test('handles empty string', () => {
      setEncryptionKey(TEST_KEY_HEX);
      const encrypted = encrypt('');
      expect(encrypted).toStartWith('enc:v1:');
      expect(decrypt(encrypted)).toBe('');
    });

    test('handles unicode characters', () => {
      setEncryptionKey(TEST_KEY_HEX);
      const plaintext = 'password-with-émojis-🔑-和中文';
      const encrypted = encrypt(plaintext);
      expect(decrypt(encrypted)).toBe(plaintext);
    });

    test('produces different ciphertexts for same plaintext (random IV)', () => {
      setEncryptionKey(TEST_KEY_HEX);
      const plaintext = 'same-secret';
      const enc1 = encrypt(plaintext);
      const enc2 = encrypt(plaintext);
      expect(enc1).not.toBe(enc2);
      expect(decrypt(enc1)).toBe(plaintext);
      expect(decrypt(enc2)).toBe(plaintext);
    });
  });

  describe('backward compatibility (no encryption key)', () => {
    test('encrypt returns plaintext when key not set', () => {
      setEncryptionKey(undefined);
      const plaintext = 'my-api-key';
      expect(encrypt(plaintext)).toBe(plaintext);
    });

    test('decrypt returns plaintext string as-is when not encrypted', () => {
      setEncryptionKey(TEST_KEY_HEX);
      const plaintext = 'not-encrypted-value';
      expect(decrypt(plaintext)).toBe(plaintext);
    });

    test('decrypt throws when encrypted data found but key not set', () => {
      setEncryptionKey(TEST_KEY_HEX);
      const encrypted = encrypt('secret');
      setEncryptionKey(undefined);
      expect(() => decrypt(encrypted)).toThrow('ENCRYPTION_KEY is not set');
    });
  });

  describe('isEncrypted', () => {
    test('returns true for encrypted values', () => {
      setEncryptionKey(TEST_KEY_HEX);
      const encrypted = encrypt('test');
      expect(isEncrypted(encrypted)).toBe(true);
    });

    test('returns false for plaintext values', () => {
      expect(isEncrypted('plaintext-value')).toBe(false);
      expect(isEncrypted('')).toBe(false);
    });
  });

  describe('hashSecret', () => {
    test('produces consistent SHA-256 hashes', () => {
      const hash1 = hashSecret('my-secret');
      const hash2 = hashSecret('my-secret');
      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64); // SHA-256 hex = 64 chars
    });

    test('produces different hashes for different inputs', () => {
      expect(hashSecret('secret-a')).not.toBe(hashSecret('secret-b'));
    });

    test('works regardless of encryption key', () => {
      setEncryptionKey(undefined);
      const hash = hashSecret('test');
      expect(hash).toHaveLength(64);

      setEncryptionKey(TEST_KEY_HEX);
      expect(hashSecret('test')).toBe(hash);
    });
  });

  describe('GCM auth tag verification', () => {
    test('throws on tampered ciphertext', () => {
      setEncryptionKey(TEST_KEY_HEX);
      const encrypted = encrypt('sensitive-data');
      // Tamper with the last hex character of ciphertext
      const tampered = encrypted.slice(0, -1) + (encrypted.endsWith('0') ? '1' : '0');
      expect(() => decrypt(tampered)).toThrow();
    });

    test('throws on invalid format', () => {
      setEncryptionKey(TEST_KEY_HEX);
      expect(() => decrypt('enc:v1:invalid')).toThrow();
    });
  });

  describe('encryptJson / decryptJson', () => {
    test('round-trips objects', () => {
      setEncryptionKey(TEST_KEY_HEX);
      const obj = { Authorization: 'Bearer sk-123', 'X-Custom': 'value' };
      const encrypted = encryptJson(obj);
      expect(typeof encrypted).toBe('string');
      expect(isEncrypted(encrypted as string)).toBe(true);
      const decrypted = decryptJson(encrypted);
      expect(decrypted).toEqual(obj);
    });

    test('handles already-parsed objects (PG jsonb)', () => {
      const obj = { key: 'value' };
      expect(decryptJson(obj)).toEqual(obj);
    });

    test('handles null/undefined', () => {
      expect(decryptJson(null)).toBeNull();
      expect(decryptJson(undefined)).toBeUndefined();
    });

    test('returns plaintext JSON when key not set', () => {
      setEncryptionKey(undefined);
      const obj = { key: 'value' };
      const result = encryptJson(obj);
      expect(result).toBe(JSON.stringify(obj));
    });
  });

  describe('encryptField / decryptField', () => {
    test('handles null input', () => {
      expect(encryptField(null)).toBeNull();
      expect(encryptField(undefined)).toBeNull();
      expect(decryptField(null)).toBeNull();
      expect(decryptField(undefined)).toBeNull();
    });

    test('encrypts and decrypts string values', () => {
      setEncryptionKey(TEST_KEY_HEX);
      const encrypted = encryptField('my-api-key');
      expect(encrypted).not.toBeNull();
      expect(isEncrypted(encrypted!)).toBe(true);
      expect(decryptField(encrypted)).toBe('my-api-key');
    });
  });
});
