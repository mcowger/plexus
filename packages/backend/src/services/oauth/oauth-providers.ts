/**
 * Plexus's OAuth provider facade over pi-ai's built-in providers.
 *
 * pi-ai 0.80.8 removed the pi-ai/oauth provider registry — OAuth is now owned
 * by each built-in Provider as `provider.auth.oauth` (login/refresh/toAuth).
 * This module is the single place Plexus resolves OAuth providers, plus the
 * provider metadata the management UI needs.
 */

import { builtinModels } from '@earendil-works/pi-ai/providers/all';
import type { OAuthAuth } from '@earendil-works/pi-ai';

/** Provider id of an OAuth provider (e.g. 'anthropic', 'openai-codex'). */
export type OAuthProvider = string;
export type OAuthProviderId = string;

export interface OAuthProviderDescriptor {
  id: string;
  /** Display name from pi-ai (e.g. "Anthropic (Claude Pro/Max)"). */
  name: string;
  /** Whether login runs a local callback server with manual code fallback. */
  usesCallbackServer: boolean;
  /** pi-ai's OAuth flow implementation (login/refresh/toAuth). */
  oauth: OAuthAuth;
}

/** Providers whose login flow runs a local callback server. */
const CALLBACK_SERVER_PROVIDERS = new Set(['anthropic', 'openai-codex']);

const models = builtinModels();

function toDescriptor(providerId: string): OAuthProviderDescriptor | undefined {
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

/** Resolve an OAuth provider by id; undefined when unknown or OAuth-less. */
export function getOAuthProviderAuth(providerId: string): OAuthProviderDescriptor | undefined {
  return toDescriptor(providerId);
}

/** List all built-in providers that support OAuth login. */
export function listOAuthProviders(): OAuthProviderDescriptor[] {
  return models
    .getProviders()
    .map((provider) => toDescriptor(provider.id))
    .filter((descriptor): descriptor is OAuthProviderDescriptor => descriptor !== undefined);
}
