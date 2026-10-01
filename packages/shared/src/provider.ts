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

/**
 * OpenAI Responses API extensions that agent clients (Codex CLI, Muse Code)
 * put on the wire and many Responses-compatible upstreams reject. A provider
 * declares which of these it accepts verbatim; a request carrying any other
 * extension is flattened by Plexus instead of passed through.
 */
export const RESPONSES_EXTENSIONS = [
  'namespace_tools',
  'namespaced_calls',
  'dotted_calls',
  'custom_tools',
  'custom_calls',
  'additional_tools',
  'tool_search',
] as const;

export const ResponsesExtensionSchema = z.enum(RESPONSES_EXTENSIONS);

export type ResponsesExtension = z.infer<typeof ResponsesExtensionSchema>;

/**
 * The `responses:lite` wire contract (OpenAI's Codex lite header) accepts
 * Codex's input-item extensions but only `function`, `custom`, and
 * `tool_search` declarations in the top-level `tools` array, and enforces
 * OpenAI's `^[a-zA-Z0-9_-]+$` tool-name pattern on history.
 */
export const RESPONSES_LITE_EXTENSIONS: readonly ResponsesExtension[] = RESPONSES_EXTENSIONS.filter(
  (extension) => extension !== 'namespace_tools' && extension !== 'dotted_calls'
);

/**
 * Plain Responses targets with no known endpoint: OpenAI `custom` tool
 * declarations are part of the public Responses API (debug trace 755ef44a).
 */
const BASE_RESPONSES_EXTENSIONS: readonly ResponsesExtension[] = ['custom_tools'];

/** Muse Code's own endpoint: its namespace grouping and both call spellings. */
const META_RESPONSES_EXTENSIONS: readonly ResponsesExtension[] = [
  'namespace_tools',
  'namespaced_calls',
  'dotted_calls',
];

/**
 * OpenAI's public /v1/responses, verified live: namespace tools and
 * `{namespace, name}` history, custom tools (top-level or nested in a
 * namespace) and custom-call history. Dotted names fail its tool-name
 * pattern. Lite-only items never reach a plain responses target verbatim.
 */
const OPENAI_RESPONSES_EXTENSIONS: readonly ResponsesExtension[] = [
  'namespace_tools',
  'namespaced_calls',
  'custom_tools',
  'custom_calls',
];

/** The ChatGPT Codex backend: every Codex extension, OpenAI's name pattern. */
const CODEX_RESPONSES_EXTENSIONS: readonly ResponsesExtension[] = RESPONSES_EXTENSIONS.filter(
  (extension) => extension !== 'dotted_calls'
);

function responsesHost(apiBaseUrl: string | Record<string, string> | undefined): string {
  const url = typeof apiBaseUrl === 'string' ? apiBaseUrl : apiBaseUrl?.responses;
  if (!url) return '';
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/**
 * Extensions a provider's plain `responses` endpoint accepts verbatim when the
 * admin hasn't set `responses_extensions`. Derived from the OAuth provider or
 * the host the provider's Responses URL points at. Shared by the backend
 * resolver and the frontend editor so the two cannot drift.
 */
export function getDefaultResponsesExtensions(provider: {
  oauthProvider?: string;
  apiBaseUrl?: string | Record<string, string>;
}): ResponsesExtension[] {
  if (provider.oauthProvider === 'openai-codex') return [...CODEX_RESPONSES_EXTENSIONS];
  if (provider.oauthProvider === 'meta') return [...META_RESPONSES_EXTENSIONS];
  const host = responsesHost(provider.apiBaseUrl);
  if (host === 'api.meta.ai') return [...META_RESPONSES_EXTENSIONS];
  if (host === 'api.openai.com') return [...OPENAI_RESPONSES_EXTENSIONS];
  return [...BASE_RESPONSES_EXTENSIONS];
}

export interface ResponsesExtensionOption {
  value: ResponsesExtension;
  label: string;
  description: string;
}

export const RESPONSES_EXTENSION_OPTIONS: ResponsesExtensionOption[] = [
  {
    value: 'namespace_tools',
    label: 'Namespace tools',
    description: 'tools[] entries of type "namespace" grouping sub-tools (Codex, Muse Code).',
  },
  {
    value: 'namespaced_calls',
    label: 'Namespaced call history',
    description: 'function_call history with a "namespace" field (Codex, OpenAI output).',
  },
  {
    value: 'dotted_calls',
    label: 'Dotted call history',
    description: 'function_call history named "<namespace>.<tool>" (Muse Code).',
  },
  {
    value: 'custom_tools',
    label: 'Custom tools',
    description: 'tools[] entries of type "custom" taking raw string input (e.g. apply_patch).',
  },
  {
    value: 'custom_calls',
    label: 'Custom call history',
    description: 'custom_tool_call / custom_tool_call_output history items.',
  },
  {
    value: 'additional_tools',
    label: 'Turn-local tools',
    description: 'additional_tools input items (Codex lite mode).',
  },
  {
    value: 'tool_search',
    label: 'Tool search',
    description: 'Client-executed tool_search tools and history items (Codex lite mode).',
  },
];
