import type { RouteResult } from '../routing/router';

/**
 * OAuth route predicates.
 *
 * The pi-ai `Context` IR + `OAuthDispatcher` executor were removed.
 * ALL OAuth providers (Anthropic, Codex, Copilot) now run through the standard
 * dispatch path via the native OAuth builders (see `oauth-native-request.ts`).
 * What remains here are the pure routing predicates used to (a) recognize an
 * `oauth://` route and (b) recognize the Claude-masking API-key route — both of
 * which select the native OAuth handling in `request-payload-builder.ts` /
 * `request-manager.ts`. No request/response translation, no token handling.
 */

export function isOAuthRoute(route: RouteResult, targetApiType: string): boolean {
  if (targetApiType.toLowerCase() === 'oauth') return true;
  if (typeof route.config.api_base_url === 'string') {
    return route.config.api_base_url.startsWith('oauth://');
  }
  const urlMap = route.config.api_base_url as Record<string, string>;
  return Object.values(urlMap).some((value) => value.startsWith('oauth://'));
}

export function isClaudeMaskingApiKeyRoute(route: RouteResult, targetApiType: string): boolean {
  if (isOAuthRoute(route, targetApiType)) {
    return false;
  }

  if (targetApiType.toLowerCase() !== 'messages') {
    return false;
  }

  return route.config.useClaudeMasking === true;
}

/**
 * Whether a route uses OAuth-style handling (an `oauth://` provider or the
 * Claude-masking API-key route). Native OAuth providers are gated separately by
 * `isNativeOAuthProvider`; a non-native `oauth://` provider is rejected at
 * dispatch (dead config — Gemini/Antigravity were removed).
 */
export function isPiAiRoute(route: RouteResult, targetApiType: string): boolean {
  return isOAuthRoute(route, targetApiType) || isClaudeMaskingApiKeyRoute(route, targetApiType);
}
