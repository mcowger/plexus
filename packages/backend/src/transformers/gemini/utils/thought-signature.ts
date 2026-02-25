/**
 * Thought signature validation utilities for Gemini API.
 *
 * Validates that thought signatures are valid base64-encoded strings
 * to prevent malformed signatures from being passed through the system.
 */

const base64SignaturePattern = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * Validates that a thought signature is a valid base64-encoded string.
 *
 * @param signature - The signature string to validate
 * @returns true if the signature is valid or undefined, false otherwise
 */
export function isValidThoughtSignature(signature: string | undefined): boolean {
  if (!signature) return true; // Undefined signatures are valid (no thinking)

  // Check base64 padding length is valid
  if (signature.length % 4 !== 0) return false;

  // Check that the signature matches base64 pattern
  return base64SignaturePattern.test(signature);
}

/**
 * Validates and sanitizes a thought signature.
 * Returns undefined if the signature is invalid.
 *
 * @param signature - The signature to sanitize
 * @returns The valid signature or undefined if invalid
 */
export function sanitizeThoughtSignature(signature: string | undefined): string | undefined {
  if (!signature) return undefined;

  if (isValidThoughtSignature(signature)) {
    return signature;
  }

  return undefined;
}
