type Headers = Record<string, string | string[] | undefined>;

const CLIENT_REQUEST_ID_HEADER = 'x-client-request-id';
const MAX_CLIENT_REQUEST_ID_LENGTH = 255;

/**
 * Returns the caller's opaque request-correlation ID when one was supplied.
 * This is intentionally separate from Plexus's server-generated request ID.
 */
export function getClientRequestId(headers: Headers): string | null {
  const value = headers[CLIENT_REQUEST_ID_HEADER];
  const clientRequestId = Array.isArray(value) ? value[0] : value;
  if (!clientRequestId) return null;

  const normalized = clientRequestId.trim();
  return normalized.length > 0 && normalized.length <= MAX_CLIENT_REQUEST_ID_LENGTH
    ? normalized
    : null;
}

export { CLIENT_REQUEST_ID_HEADER };
