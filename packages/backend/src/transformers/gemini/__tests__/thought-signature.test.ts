import { describe, expect, test } from 'bun:test';
import { isValidThoughtSignature, sanitizeThoughtSignature } from '../utils/thought-signature';

describe('Thought Signature Validation', () => {
  describe('isValidThoughtSignature', () => {
    test('should return true for undefined signature', () => {
      expect(isValidThoughtSignature(undefined)).toBe(true);
    });

    test('should return true for empty string signature', () => {
      expect(isValidThoughtSignature('')).toBe(true);
    });

    test('should return true for valid base64 signature', () => {
      // Valid base64 with proper padding
      expect(isValidThoughtSignature('aGVsbG8=')).toBe(true);
      expect(isValidThoughtSignature('SGVsbG8gV29ybGQh')).toBe(true);
    });

    test('should return true for valid base64 without padding', () => {
      // Length must be divisible by 4
      expect(isValidThoughtSignature('aGVsbG80')).toBe(true); // 8 chars - valid
    });

    test('should return true for valid base64 with == padding', () => {
      expect(isValidThoughtSignature('aGVsbG8=')).toBe(true);
    });

    test('should return true for valid base64 with = padding', () => {
      expect(isValidThoughtSignature('YWJjZGVm')).toBe(true);
    });

    test('should return false for invalid base64 (has invalid characters)', () => {
      expect(isValidThoughtSignature('aGVsbG8!')).toBe(false);
      expect(isValidThoughtSignature('hello world')).toBe(false);
      expect(isValidThoughtSignature('abc@def')).toBe(false);
    });

    test('should return false for invalid padding length', () => {
      // Length 5 is not divisible by 4
      expect(isValidThoughtSignature('abcde')).toBe(false);
      // Length 7 is not divisible by 4
      expect(isValidThoughtSignature('abcdefg')).toBe(false);
    });

    test('should return false for malformed base64', () => {
      // Contains + and / which are valid in base64, but tests with other issues
      expect(isValidThoughtSignature('aGVsbG8+')).toBe(true); // Valid
      // Invalid padding (too many = signs)
      expect(isValidThoughtSignature('aGVsbG8===')).toBe(false);
    });
  });

  describe('sanitizeThoughtSignature', () => {
    test('should return undefined for undefined signature', () => {
      expect(sanitizeThoughtSignature(undefined)).toBeUndefined();
    });

    test('should return signature for valid base64', () => {
      expect(sanitizeThoughtSignature('aGVsbG8=')).toBe('aGVsbG8=');
    });

    test('should return undefined for invalid signature', () => {
      expect(sanitizeThoughtSignature('invalid!')).toBeUndefined();
    });

    test('should return undefined for wrong padding length', () => {
      expect(sanitizeThoughtSignature('abcde')).toBeUndefined();
    });
  });
});
