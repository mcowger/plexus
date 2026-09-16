/**
 * Clipboard and crypto utility that handles secure and non-secure contexts.
 *
 * The Clipboard API (navigator.clipboard) and crypto.randomUUID() are only available
 * in secure contexts (HTTPS or localhost). In non-secure HTTP contexts, we provide
 * fallbacks that work everywhere.
 */

/**
 * Check if clipboard operations are available in the current context.
 * True when the modern Clipboard API exists, or when the legacy
 * document.execCommand('copy') fallback can be used (covers non-secure
 * HTTP contexts where navigator.clipboard is undefined).
 */
export const isClipboardAvailable = (): boolean => {
  if (typeof navigator !== 'undefined' && !!navigator.clipboard) {
    return true;
  }
  return typeof document !== 'undefined' && typeof document.execCommand === 'function';
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
 * Legacy copy path for non-secure contexts (plain HTTP) where
 * navigator.clipboard is unavailable. Uses a temporary off-screen textarea
 * with document.execCommand('copy'), which is not restricted to secure
 * contexts. Must be called from a user gesture in most browsers.
 */
const legacyCopyToClipboard = (text: string): boolean => {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.top = '0';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  try {
    textarea.select();
    // Needed for iOS Safari, which ignores select() alone.
    textarea.setSelectionRange(0, textarea.value.length);
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    textarea.parentNode?.removeChild(textarea);
  }
};

/**
 * Attempt to copy text to clipboard.
 * Tries the modern Clipboard API first, then falls back to
 * document.execCommand('copy') which also works in non-secure (HTTP) contexts.
 * Returns success status.
 */
export const copyToClipboard = async (text: string): Promise<boolean> => {
  if (typeof navigator !== 'undefined' && !!navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to the legacy path below.
    }
  }

  if (typeof document !== 'undefined' && typeof document.execCommand === 'function') {
    return legacyCopyToClipboard(text);
  }

  return false;
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
