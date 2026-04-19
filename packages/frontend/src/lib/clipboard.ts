/**
 * Clipboard and crypto utility that handles secure and non-secure contexts.
 *
 * The Clipboard API (navigator.clipboard) and crypto.randomUUID() are only available
 * in secure contexts (HTTPS or localhost). In non-secure HTTP contexts, we provide
 * fallbacks that work everywhere.
 */

/**
 * Check if clipboard operations are available in the current context.
 * Requires secure context (HTTPS or localhost) for modern Clipboard API.
 */
export const isClipboardAvailable = (): boolean => {
  return typeof navigator !== 'undefined' && !!navigator.clipboard;
};

/**
 * Check if we're in a secure context where clipboard operations work.
 */
export const isSecureContext = (): boolean => {
  // @ts-ignore - secureContext may not be defined in older browsers
  return typeof window !== 'undefined' && (window.isSecureContext ?? true);
};

/**
 * Get a user-friendly message explaining why clipboard is unavailable.
 */
export const getClipboardUnavailableMessage = (): string => {
  if (!isSecureContext()) {
    return 'Copy requires HTTPS connection';
  }
  return 'Copy not available in this browser';
};

/**
 * Attempt to copy text to clipboard.
 * Returns success status. Falls back gracefully in non-secure contexts.
 */
export const copyToClipboard = async (text: string): Promise<boolean> => {
  if (!isClipboardAvailable()) {
    return false;
  }

  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
};

/**
 * Generate a UUID v4 using crypto.getRandomValues().
 * Works in both secure (HTTPS) and non-secure (HTTP) contexts.
 * Falls back to Math.random() if crypto is unavailable.
 */
export const generateUUID = (): string => {
  // Use crypto.getRandomValues if available (works in all contexts including HTTP)
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);

    // Set version (4) and variant (2) bits per RFC 4122
    bytes[6] = (bytes[6] & 0x0f) | 0x40; // Version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // Variant 10

    // Convert to hex string with dashes
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  // Fallback to Math.random() - not cryptographically secure but sufficient for API keys
  // when running in very old browsers without crypto support
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};
