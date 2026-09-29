import { z } from 'zod';

/**
 * Marks a provider whose upstream URL is resolved through OAuth at request time.
 * OAuth placeholders are not dispatchable endpoints.
 */
export function isOAuthPlaceholderUrl(value: string): boolean {
  return value.trim().toLowerCase().startsWith('oauth://');
}

/**
 * Where Plexus injects the per-run cache/session key it derives from inbound
 * request affinity, so upstream prompt-cache routing does not depend on the
 * client sending the right field. Body fields are set on the wire body; header
 * fields are set on the upstream HTTP request. Field names are taken from the
 * cache-routing surface Plexus already understands
 * (`services/providers/provider-request-headers.ts`) plus the OpenAI/Meta body
 * fields.
 */
export const PROVIDER_CACHE_KEY_INJECTION_VALUES = [
  'off',
  'prompt_cache_key',
  'session_id',
  'x-client-request-id',
  'x-session-affinity',
  'x-session-id',
  'x-prompt-cache-isolation-key',
  'x-multi-turn-session-id',
] as const;

export const ProviderCacheKeyInjectionSchema = z.enum(PROVIDER_CACHE_KEY_INJECTION_VALUES);

export type ProviderCacheKeyInjection = z.infer<typeof ProviderCacheKeyInjectionSchema>;

/** Body fields (as opposed to headers) that carry the injected cache key. */
const CACHE_KEY_INJECTION_BODY_FIELDS = new Set<string>(['prompt_cache_key']);

export function isBodyCacheKeyInjectionField(value: string): boolean {
  return CACHE_KEY_INJECTION_BODY_FIELDS.has(value);
}

/**
 * Default injection destination for a provider's OAuth id, or `undefined` to
 * leave the client request untouched. Shared by the backend resolver and the
 * frontend editor so the two cannot drift.
 *
 * Meta (Muse) OAuth defaults to `prompt_cache_key` because its Responses
 * prompt caching depends on a routing key clients may omit or vary.
 */
export function getDefaultCacheKeyInjection(
  oauthProvider: string | undefined
): ProviderCacheKeyInjection | undefined {
  return oauthProvider === 'meta' ? 'prompt_cache_key' : undefined;
}

export interface ProviderCacheKeyInjectionOption {
  value: ProviderCacheKeyInjection;
  label: string;
  description: string;
}

export const PROVIDER_CACHE_KEY_INJECTION_OPTIONS: ProviderCacheKeyInjectionOption[] = [
  {
    value: 'off',
    label: 'Off — do not inject',
    description: 'Forward the client request unchanged.',
  },
  {
    value: 'prompt_cache_key',
    label: 'Body: prompt_cache_key',
    description:
      'OpenAI / Meta Responses (and Chat Completions) prompt-cache routing key. The default for Meta OAuth.',
  },
  {
    value: 'session_id',
    label: 'Header: session_id',
    description: 'OpenAI / Codex session affinity header (sent on the wire as session-id).',
  },
  {
    value: 'x-client-request-id',
    label: 'Header: x-client-request-id',
    description: 'Generic client request id used for cache affinity.',
  },
  {
    value: 'x-session-affinity',
    label: 'Header: x-session-affinity',
    description: 'Replica affinity header (e.g. Fireworks).',
  },
  {
    value: 'x-session-id',
    label: 'Header: x-session-id',
    description: 'OpenRouter-style session header.',
  },
  {
    value: 'x-prompt-cache-isolation-key',
    label: 'Header: x-prompt-cache-isolation-key',
    description: 'Isolates a prompt-cache namespace across callers.',
  },
  {
    value: 'x-multi-turn-session-id',
    label: 'Header: x-multi-turn-session-id',
    description: 'Multi-turn session affinity header.',
  },
];
