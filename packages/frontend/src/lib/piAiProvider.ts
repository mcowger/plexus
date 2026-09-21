import { isOAuthPlaceholderUrl } from '@plexus/shared';
import type { Provider } from './api';

/**
 * Shared bits for pi-ai provider auto-detection in the provider form.
 *
 * Both the new-provider auto-detect (useProviderForm) and the pi-ai
 * dropdown's `- auto -` entry (ProviderAdvancedEditor) resolve through the
 * same backend lookup (`POST /v0/management/pi/resolve-provider`), so a
 * known API endpoint or an OAuth provider id yields the same answer in both
 * places.
 */

/** Dropdown value for `- auto -`. Never persisted — it resolves to a concrete id (or none) on select. */
export const PI_AI_AUTO_VALUE = '__auto__';

/**
 * Collect the endpoint URLs to match from a provider draft: every
 * api_base_url map value, or the string form unless it is the `oauth://`
 * placeholder (OAuth mode matches by provider id instead).
 */
export function collectProviderEndpointUrls(apiBaseUrl: Provider['apiBaseUrl']): string[] {
  if (typeof apiBaseUrl === 'string') {
    return isOAuthPlaceholderUrl(apiBaseUrl) || !apiBaseUrl.trim() ? [] : [apiBaseUrl];
  }
  if (apiBaseUrl && typeof apiBaseUrl === 'object' && !Array.isArray(apiBaseUrl)) {
    return Object.values(apiBaseUrl).filter(
      (url): url is string => typeof url === 'string' && url.trim().length > 0
    );
  }
  return [];
}

/** True when the draft is in OAuth mode (matches by oauth provider id). */
export function isOAuthProviderDraft(apiBaseUrl: Provider['apiBaseUrl']): boolean {
  return typeof apiBaseUrl === 'string' && isOAuthPlaceholderUrl(apiBaseUrl);
}
