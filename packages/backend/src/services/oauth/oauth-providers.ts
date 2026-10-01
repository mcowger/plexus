/**
 * Plexus's OAuth provider facade over pi-ai's built-in providers.
 *
 * pi-ai 0.80.8 removed the pi-ai/oauth provider registry — OAuth is now owned
 * by each built-in Provider as `provider.auth.oauth` (login/refresh/toAuth).
 * This module is the single place Plexus resolves OAuth providers, plus the
 * provider metadata the management UI needs.
 *
 * Every pi-ai built-in provider with `auth.oauth` is exposed automatically —
 * Plexus does not maintain a per-provider allowlist, so new OAuth flows pi-ai
 * ships (e.g. xAI, Kimi Code, OpenRouter) become available with no code
 * changes here. `radius` is the one deliberate exception: it's a factory
 * (`radiusProvider({ id, name, gateway })`) for pointing at an arbitrary
 * self-hosted gateway, not a fixed identity provider like the others, so it
 * doesn't fit the "pick a provider, log in" model this facade assumes.
 */

import { builtinModels } from '@earendil-works/pi-ai/providers/all';
import type { OAuthAuth } from '@earendil-works/pi-ai';
import { withCopyCodeLogin } from './anthropic';

/** Provider id of an OAuth provider (e.g. 'anthropic', 'openai-codex'). */
export type OAuthProvider = string;
export type OAuthProviderId = string;

/**
 * Well-known default account id. The runtime resolver prefers it over
 * single-account fallback regardless of how many accounts exist, so code
 * that reasons about credential consumers must treat it as always reachable.
 */
export const LEGACY_ACCOUNT_ID = 'legacy';

export interface OAuthProviderDescriptor {
  id: string;
  /** Display name from pi-ai (e.g. "Anthropic (Claude Pro/Max)"). */
  name: string;
  /** Whether login runs a local callback server with manual code fallback. */
  usesCallbackServer: boolean;
  /** pi-ai's OAuth flow implementation (login/refresh/toAuth). */
  oauth: OAuthAuth;
}

const models = builtinModels();

/**
 * Plexus-owned OAuth implementations for providers pi-ai does not ship.
 * Checked before the pi-ai registry in `toDescriptor`, so these ids resolve
 * even with no pi-ai catalog entry, baseUrl, or model list. Entries here
 * automatically flow into config validation (`isKnownOAuthProviderId`), the
 * management UI (`listOAuthProviders`), and login sessions — the same
 * single-place guarantee the pi-ai side of the facade provides.
 *
 * `anthropic` overrides pi-ai's built-in login with the copy-code method (see
 * `anthropic.ts`) while keeping pi-ai's `refresh`/`toAuth`; Meta Muse
 * subscriptions (`meta`) used to live here as `muse-code` until pi-ai 0.86
 * shipped a native `meta` provider with the same device-flow OAuth, so the
 * facade resolves it from pi-ai directly.
 */
const upstreamAnthropicOAuth = models.getProvider('anthropic')?.auth?.oauth;

const CUSTOM_OAUTH_PROVIDERS: Readonly<Record<string, { name: string; oauth: OAuthAuth }>> =
  upstreamAnthropicOAuth
    ? {
        anthropic: {
          name: upstreamAnthropicOAuth.name,
          oauth: withCopyCodeLogin(upstreamAnthropicOAuth),
        },
      }
    : {};

/** Providers whose login flow runs a local callback server. */
// Anthropic only falls back to pi-ai's loopback login when the copy-code
// override is unavailable, so keep its callback-server handling for that case.
const CALLBACK_SERVER_PROVIDERS = new Set(
  upstreamAnthropicOAuth ? ['openai-codex'] : ['anthropic', 'openai-codex']
);

/**
 * Providers excluded from Plexus's OAuth surface despite having
 * `auth.oauth` in pi-ai. See module doc comment for why `radius` is excluded.
 */
const BLOCKED_PROVIDERS = new Set(['radius']);

function toDescriptor(providerId: string): OAuthProviderDescriptor | undefined {
  if (BLOCKED_PROVIDERS.has(providerId)) return undefined;
  const custom = CUSTOM_OAUTH_PROVIDERS[providerId];
  if (custom) {
    return {
      id: providerId,
      name: custom.name,
      usesCallbackServer: CALLBACK_SERVER_PROVIDERS.has(providerId),
      oauth: custom.oauth,
    };
  }
  const provider = models.getProvider(providerId);
  const oauth = provider?.auth?.oauth;
  if (!provider || !oauth) return undefined;
  return {
    id: provider.id,
    name: oauth.name,
    usesCallbackServer: CALLBACK_SERVER_PROVIDERS.has(provider.id),
    oauth,
  };
}

/** Resolve an OAuth provider by id; undefined when unknown, blocked, or OAuth-less. */
export function getOAuthProviderAuth(providerId: string): OAuthProviderDescriptor | undefined {
  return toDescriptor(providerId);
}

/** List all built-in providers that support OAuth login (excluding blocked ones). */
export function listOAuthProviders(): OAuthProviderDescriptor[] {
  const customIds = new Set(Object.keys(CUSTOM_OAUTH_PROVIDERS));
  const custom = Object.keys(CUSTOM_OAUTH_PROVIDERS)
    .map((id) => toDescriptor(id))
    .filter((descriptor): descriptor is OAuthProviderDescriptor => descriptor !== undefined);
  const builtin = models
    .getProviders()
    .filter((provider) => !customIds.has(provider.id))
    .map((provider) => toDescriptor(provider.id))
    .filter((descriptor): descriptor is OAuthProviderDescriptor => descriptor !== undefined);
  return [...custom, ...builtin];
}

/** Whether `providerId` is a usable OAuth provider (for config validation). */
export function isKnownOAuthProviderId(providerId: string): boolean {
  return toDescriptor(providerId) !== undefined;
}
