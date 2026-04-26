/**
 * Fixture record format for E2E test record/replay.
 *
 * Each line in an NDJSON fixture file is one FixtureRecord,
 * representing a single request/response exchange captured from
 * an upstream AI API.
 */
export interface FixtureRecord {
  request: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body: string;
  };
  response: {
    status: number;
    headers: Record<string, string>;
    /** Full response body for non-streaming responses */
    body?: string;
    /** Ordered array of raw SSE event strings for streaming responses */
    sseEvents?: string[];
  };
}

/**
 * Headers that vary between runs and should not affect fixture matching.
 */
const SKIP_HEADERS = new Set([
  'x-request-id',
  'cf-ray',
  'date',
  'set-cookie',
  'authorization',
  'x-api-key',
]);

/**
 * Remove headers that vary between recording and replay sessions
 * and shouldn't affect fixture matching.
 */
export function normalizeHeaders(
  headers: Record<string, string | string[]>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (!SKIP_HEADERS.has(k.toLowerCase())) {
      out[k] = Array.isArray(v) ? v.join(', ') : v;
    }
  }
  return out;
}

/**
 * Split a raw SSE body into individual event strings.
 * Each event ends with a double newline.
 */
export function parseSSEEvents(raw: string): string[] {
  return raw
    .split(/\n\n/)
    .map((e) => e.trim())
    .filter((e) => e.length > 0)
    .map((e) => e + '\n\n');
}

/**
 * Hash a request body for use in fixture lookup keys.
 */
export function bodyHash(body: string): string {
  const hasher = new Bun.CryptoHasher('sha256');
  hasher.update(body);
  return hasher.digest('hex').slice(0, 16);
}

/**
 * Normalize a request body before hashing so that matching is stable
 * across runs even if non-semantic fields differ.
 */
export function normalizeRequestBody(body: string): string {
  try {
    const parsed = JSON.parse(body);
    delete parsed.user;
    delete parsed.metadata?.request_id;
    return JSON.stringify(parsed, Object.keys(parsed).sort());
  } catch {
    return body;
  }
}

/**
 * Compute a stable key for fixture lookup.
 * Uses method + URL path (no host) + a hash of the normalized request body.
 */
export function fixtureKey(method: string, url: string, body: string): string {
  const parsed = new URL(url);
  const pathAndQuery = parsed.pathname + parsed.search;
  const hash = bodyHash(normalizeRequestBody(body));
  return `${method.toUpperCase()}:${pathAndQuery}:${hash}`;
}
