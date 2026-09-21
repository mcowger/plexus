/**
 * pi-ai provider auto-detection for new provider configs.
 *
 * When a user points a new provider at a known API endpoint (one of pi-ai's
 * builtin `baseUrl`s) or picks an OAuth provider (whose id *is* a pi-ai
 * provider id — see services/oauth/oauth-providers.ts), the management UI
 * can resolve the matching pi-ai provider id and pre-select it alongside
 * `auto_compat`. The matching itself lives here so both the HTTP route
 * (`POST /v0/management/pi/resolve-provider`) and unit tests share one
 * implementation, enumerated live from pi-ai rather than a hardcoded map.
 */

import { builtinModels, getBuiltinProviders } from '@earendil-works/pi-ai/providers/all';

/** A pi-ai builtin provider id paired with the base URL pi-ai dispatches to. */
export interface PiAiEndpointProvider {
  id: string;
  baseUrl: string;
}

/**
 * Every pi-ai builtin provider with its dispatch base URL, sorted by id.
 * Providers without a fixed base URL (azure, bedrock, vertex, radius, …)
 * report an empty string and can never match by endpoint — only by OAuth id.
 */
export function listPiAiEndpointProviders(): PiAiEndpointProvider[] {
  const models = builtinModels();
  return getBuiltinProviders()
    .sort()
    .map((id) => {
      let baseUrl = '';
      try {
        baseUrl = models.getProvider(id)?.baseUrl ?? '';
      } catch {
        baseUrl = '';
      }
      return { id, baseUrl };
    });
}

/**
 * Normalize an endpoint URL for comparison: trim, drop trailing slashes,
 * lowercase. Paths are lowercased too — matching is lenient by design, and
 * pi-ai base URLs are all lowercase in practice.
 */
export function normalizeEndpointUrl(url: string): string {
  return url.trim().toLowerCase().replace(/\/+$/, '');
}

interface ParsedEndpoint {
  /** Lowercased host (with port when present); scheme is ignored. */
  origin: string;
  /** Lowercased pathname with no trailing slash; the root is '/'. */
  path: string;
}

/** Split an endpoint into origin + path for boundary-aware comparison. */
function parseEndpointUrl(url: string): ParsedEndpoint | null {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  const path = parsed.pathname.toLowerCase().replace(/\/+$/, '') || '/';
  return { origin: parsed.host.toLowerCase(), path };
}

/**
 * True when `prefix` is a path prefix of `full` at a `/` segment boundary.
 * A bare-host prefix ('/') matches any path on the same origin, so entering
 * just `https://api.openai.com` still resolves — but `/v1` never matches
 * `/v10`, and sibling hostnames never match because origins are compared
 * separately.
 */
function isPathPrefix(prefix: string, full: string): boolean {
  if (prefix === '/') return true;
  return full === prefix || full.startsWith(`${prefix}/`);
}

/**
 * Match user-supplied endpoint URL(s) against pi-ai builtin base URLs.
 *
 * Origins must be equal and paths must match exactly or at a `/` segment
 * boundary. An exact match wins. Otherwise the longest builtin `baseUrl`
 * that is a path-prefix of a user URL (or vice versa, e.g. a user entering
 * just `https://api.openai.com` against pi-ai's `https://api.openai.com/v1`)
 * wins, so URLs with extra path segments (gateway prefixes, `/v1` variants)
 * still resolve. Providers with no base URL never match. Ties (two
 * providers sharing one base URL) resolve deterministically to the first id
 * in sort order. Returns null when nothing matches.
 */
export function matchPiAiProviderByUrls(
  urls: readonly string[],
  endpoints: readonly PiAiEndpointProvider[] = listPiAiEndpointProviders()
): string | null {
  const candidates = urls
    .map(parseEndpointUrl)
    .filter((parsed): parsed is ParsedEndpoint => parsed !== null);
  if (candidates.length === 0) return null;

  const known = endpoints
    .map(({ id, baseUrl }) => ({ id, parsed: parseEndpointUrl(baseUrl) }))
    .filter((entry): entry is { id: string; parsed: ParsedEndpoint } => entry.parsed !== null);
  if (known.length === 0) return null;

  for (const url of candidates) {
    const exact = known.find(
      (entry) => entry.parsed.origin === url.origin && entry.parsed.path === url.path
    );
    if (exact) return exact.id;
  }

  let best: { id: string; length: number } | null = null;
  for (const url of candidates) {
    for (const entry of known) {
      if (entry.parsed.origin !== url.origin) continue;
      const prefix =
        isPathPrefix(entry.parsed.path, url.path) || isPathPrefix(url.path, entry.parsed.path);
      if (!prefix) continue;
      if (!best || entry.parsed.path.length > best.length) {
        best = { id: entry.id, length: entry.parsed.path.length };
      }
    }
  }
  return best?.id ?? null;
}

export interface ResolvePiAiProviderInput {
  /** Raw endpoint URL(s) from the provider's api_base_url map or string form. */
  urls?: readonly string[];
  /** OAuth provider id when the provider uses `oauth://` (is a pi-ai id). */
  oauthProvider?: string;
}

/**
 * Resolve the pi-ai provider for a new provider config. An OAuth provider
 * singularly identifies its pi-ai provider, so it takes precedence when it
 * names a known builtin; otherwise fall back to endpoint matching.
 */
export function resolvePiAiProvider(
  input: ResolvePiAiProviderInput,
  deps: {
    builtinProviderIds?: readonly string[];
    endpoints?: readonly PiAiEndpointProvider[];
  } = {}
): string | null {
  const oauthProvider = input.oauthProvider?.trim();
  if (oauthProvider) {
    const knownIds = deps.builtinProviderIds ?? getBuiltinProviders();
    if (knownIds.includes(oauthProvider)) return oauthProvider;
  }
  return matchPiAiProviderByUrls(input.urls ?? [], deps.endpoints);
}
