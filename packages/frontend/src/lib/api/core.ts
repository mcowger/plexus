import { isOAuthPlaceholderUrl } from '@plexus/shared';
import { formatNumber, formatPoints } from '../format';
import type { Principal } from '../../types/settings';

export const API_BASE = ''; // Proxied via server.ts

export const formatLargeNumber = formatNumber;
export { formatPoints };

export const STAT_LABELS = {
  REQUESTS: 'Total Requests',
  PROVIDERS: 'Active Providers',
  TOKENS: 'Total Tokens',
  DURATION: 'Avg. Duration',
} as const;

/**
 * Extract supported API types from the provider configuration.
 * Infers types from api_base_url field: if it's a record/map, the keys are the supported types.
 * If it's a string, we infer the type from the URL pattern.
 * @param apiBaseUrl The api_base_url from provider configuration
 * @returns Array of supported API types (e.g., ["chat"], ["messages"], ["chat", "messages"])
 */
export function inferProviderTypes(apiBaseUrl?: string | Record<string, string>): string[] {
  if (!apiBaseUrl) {
    return ['chat']; // Default fallback
  }

  if (typeof apiBaseUrl === 'string') {
    // Single URL - infer type from URL pattern
    const url = apiBaseUrl.trim().toLowerCase();

    if (isOAuthPlaceholderUrl(apiBaseUrl)) {
      return ['oauth'];
    }

    // Check for known patterns
    if (url.includes('anthropic.com')) {
      return ['messages'];
    } else if (url.includes('generativelanguage.googleapis.com')) {
      return ['gemini'];
    } else {
      // Default to 'chat' for OpenAI-compatible APIs
      return ['chat'];
    }
  } else {
    // Record/map format - keys are the supported types
    return Object.keys(apiBaseUrl).filter((key) => {
      const value = apiBaseUrl[key];
      return typeof value === 'string' && value.length > 0;
    });
  }
}

/**
 * Verify a credential against the backend. Returns the resolved principal on
 * success, or null on 401/network error.
 */
export async function verifyAdminKey(key: string): Promise<Principal | null> {
  try {
    const res = await fetch('/v0/management/auth/verify', {
      method: 'GET',
      headers: { 'x-admin-key': key },
    });
    if (res.status !== 200) return null;
    const body = (await res.json()) as {
      ok: boolean;
      role: 'admin' | 'limited';
      keyName?: string;
      allowedProviders?: string[];
      allowedModels?: string[];
      excludedProviders?: string[];
      excludedModels?: string[];
      quotaName?: string | null;
      comment?: string | null;
    };
    if (!body.ok) return null;
    if (body.role === 'admin') return { role: 'admin' };
    if (body.role === 'limited' && typeof body.keyName === 'string') {
      return {
        role: 'limited',
        keyName: body.keyName,
        allowedProviders: Array.isArray(body.allowedProviders) ? body.allowedProviders : [],
        allowedModels: Array.isArray(body.allowedModels) ? body.allowedModels : [],
        excludedProviders: Array.isArray(body.excludedProviders) ? body.excludedProviders : [],
        excludedModels: Array.isArray(body.excludedModels) ? body.excludedModels : [],
        quotaName: typeof body.quotaName === 'string' ? body.quotaName : null,
        comment: typeof body.comment === 'string' ? body.comment : null,
      };
    }
    return null;
  } catch {
    return null;
  }
}

export const fetchWithAuth = async (url: string, options: RequestInit = {}) => {
  const headers = new Headers(options.headers || {});
  const adminKey = localStorage.getItem('plexus_admin_key');
  if (adminKey) {
    headers.set('x-admin-key', adminKey);
  }

  const res = await fetch(url, { ...options, headers });

  if (res.status === 401) {
    // If unauthorized, clear key to trigger re-login only if key has not changed
    if (adminKey && localStorage.getItem('plexus_admin_key') === adminKey) {
      localStorage.removeItem('plexus_admin_key');
      if (window.location.pathname !== '/ui/login') {
        window.location.href = '/ui/login';
      }
    }
  }
  return res;
};

export const CONFIG_CACHE_TTL_MS = 20000;
export const configRequestCache = new Map<
  string,
  { expiresAt: number; promise: Promise<Record<string, unknown>> }
>();

export const fetchConfigCached = async (): Promise<Record<string, unknown>> => {
  const cached = configRequestCache.get('config');
  if (cached && cached.expiresAt > Date.now()) {
    return cached.promise;
  }

  const promise = (async () => {
    const res = await fetchWithAuth(`${API_BASE}/v0/management/config`);
    if (!res.ok) throw new Error('Failed to fetch config');
    return await res.json();
  })();

  configRequestCache.set('config', { expiresAt: Date.now() + CONFIG_CACHE_TTL_MS, promise });
  promise.catch(() => configRequestCache.delete('config'));
  return promise;
};

export const encodePathPreservingSlashes = (value: string): string =>
  value.split('/').map(encodeURIComponent).join('/');
