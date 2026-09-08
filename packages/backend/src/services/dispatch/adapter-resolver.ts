import type { ResolvedAdapter } from '../../types/provider-adapter';
import type { RouteResult } from '../routing/router';
import type { AdapterEntry } from '../../config';
import { ADAPTER_REGISTRY } from '../../transformers/adapters/index';
import { normalizeAnthropicToolIdsAdapter } from '../../transformers/adapters/normalize-anthropic-tool-ids.adapter';
import { stripUnsignedThinkingAdapter } from '../../transformers/adapters/strip-unsigned-thinking.adapter';
import { stripUnsupportedToolSearchAdapter } from '../../transformers/adapters/strip-unsupported-tool-search.adapter';
import { suppressUnsupportedGpt5OptionsAdapter } from '../../transformers/adapters/suppress-unsupported-gpt5-options.adapter';
import { getApiBaseType } from '../../utils/api-format';
import { logger } from '../../utils/logger';

/**
 * Resolves the ordered list of ProviderAdapters for a given route.
 *
 * Resolution order:
 *   1. Implicit adapters automatically injected for the route's target
 *      provider (currently: tool-search stripping for `pi_ai_provider ===
 *      'openrouter'`), its model (GPT-5 option suppression) and its
 *      provider+wire-format pair (Anthropic tool-id normalization, gated on
 *      BOTH the outbound wire format being Anthropic Messages AND the target
 *      looking like an Anthropic provider — an `anthropic.com` base URL,
 *      Anthropic OAuth, or Claude masking). These run first so
 *      user-configured adapters see the cleaned-up payload if they inspect it.
 *   2. Provider-level `adapter` (applies to all models under the provider)
 *   3. Model-level `adapter`   (appended after provider-level adapters)
 *
 * An `{ name, enabled: false }` entry removes earlier instances of that adapter,
 * including implicit defaults. A later enabled entry restores it. That makes the
 * provider/model `adapter` array the override channel in BOTH directions: a
 * `{ name, enabled: false }` tombstone opts a detected-Anthropic route out, and
 * a `{ name, options: {}, enabled: true }` entry force-enables the adapter on a
 * route the implicit gate skipped (e.g. an Anthropic-compatible gateway hosted
 * on some other domain).
 *
 * Each entry is an { name, options } object. Unknown adapter names are logged
 * as warnings and skipped (rather than throwing) so that a misconfigured
 * adapter doesn't take down the whole route.
 *
 * Returns an empty array when no adapters are configured — zero-cost path.
 *
 * @param effectiveApiType Pass the FINAL outbound wire type — request-manager's
 *   `effectiveApiType`, NOT `targetApiType` (which can be 'oauth' or
 *   subtype-carrying). When omitted (e.g. legacy callers/tests), no
 *   format-scoped implicit adapters are injected.
 */
export function resolveAdapters(route: RouteResult, effectiveApiType?: string): ResolvedAdapter[] {
  const entries: AdapterEntry[] = [
    ...resolveImplicitAdapters(route, effectiveApiType),
    ...(route.config.adapter ?? []),
    ...(route.modelConfig?.adapter ?? []),
  ];

  if (entries.length === 0) return [];

  let resolved: ResolvedAdapter[] = [];
  for (const entry of entries) {
    if (entry.enabled === false) {
      resolved = resolved.filter((resolvedEntry) => resolvedEntry.adapter.name !== entry.name);
      continue;
    }
    const adapter = ADAPTER_REGISTRY[entry.name];
    if (!adapter) {
      logger.warn(
        `Unknown adapter '${entry.name}' configured for provider '${route.provider}' ` +
          `model '${route.model}' — skipping`
      );
      continue;
    }
    resolved.push({ adapter, options: entry.options });
  }

  return resolved;
}

/**
 * Adapters automatically injected for a route based on its target pi-ai
 * provider, its model id and its provider/outbound-wire-format pair,
 * independent of user-configured adapters.
 *
 * The `pi_ai_provider === 'openrouter'` entry fires because OpenRouter's
 * Anthropic-compat /v1/messages endpoint only accepts a small subset of
 * Anthropic server-tool shorthands and rejects the rest with HTTP 400
 * "Unknown server-tool shorthand". We strip the unsupported ones (currently
 * `tool_search_tool_*`) so that messages<>messages pass-through and the
 * transformer-driven dispatch both end up with a body OpenRouter will accept.
 *
 * The tool-id normalizer's gate has TWO parts, and both must hold:
 *
 *   1. The route's FINAL outbound wire type is Anthropic Messages (base type of
 *      `effectiveApiType`, so subtypes such as `messages:<subtype>` are covered
 *      too). Foreign ids reach an Anthropic-shaped body both through the
 *      messages->messages pass-through and through cross-format transforms, so
 *      the repair cannot be attached to a single transformer.
 *   2. The target actually looks like an Anthropic provider
 *      (`isAnthropicTargetProvider`: an `anthropic.com` base URL, Anthropic
 *      OAuth, or Claude masking) — judged on the URL this very dispatch would
 *      use, so a record `api_base_url` is read at its `effectiveApiType` key
 *      rather than collectively. Not every messages-format target is
 *      Anthropic — plenty of proxies and self-hosted gateways speak the
 *      Messages wire format without enforcing Anthropic's tool-id charset, and
 *      rewriting ids there would mutate ids the client matches against on the
 *      next turn for no benefit.
 *
 * Anthropic itself hard-400s on tool ids outside `^[a-zA-Z0-9_-]+$`. For an
 * Anthropic-compatible gateway on some other host that enforces the same
 * charset, add `{ name: 'normalize_anthropic_tool_ids', options: {}, enabled:
 * true }` to that provider's (or model's) `adapter` array; conversely a
 * `{ name: 'normalize_anthropic_tool_ids', enabled: false }` entry opts a
 * detected-Anthropic route out. `effectiveApiType` (not `targetApiType`) is the
 * only value that reflects the real protocol for native-OAuth routes.
 *
 * Implicit adapters go through the same registry path as user-configured
 * adapters, so an unresolved name here would fail loudly rather than
 * silently no-op.
 */
function resolveImplicitAdapters(route: RouteResult, effectiveApiType?: string): AdapterEntry[] {
  const adapters: AdapterEntry[] = [];
  if (isGpt5Model(route.model)) {
    adapters.push({ name: suppressUnsupportedGpt5OptionsAdapter.name, options: {}, enabled: true });
  }
  if (route.config.pi_ai_provider === 'openrouter') {
    adapters.push({ name: stripUnsupportedToolSearchAdapter.name, options: {}, enabled: true });
  }
  if (
    effectiveApiType &&
    getApiBaseType(effectiveApiType) === 'messages' &&
    isAnthropicTargetProvider(route, effectiveApiType)
  ) {
    adapters.push({ name: normalizeAnthropicToolIdsAdapter.name, options: {}, enabled: true });
    // Same gate: Anthropic itself 400s on a `thinking` block without a
    // `signature`, but other Messages-speaking upstreams (e.g. Kimi) need
    // unsigned thinking preserved, so the strip is target-aware, not global.
    adapters.push({ name: stripUnsignedThinkingAdapter.name, options: {}, enabled: true });
  }
  return adapters;
}

/**
 * Does this route target Anthropic itself (as opposed to some other upstream
 * that merely speaks the Messages wire format)?
 *
 * Three signals, any of which is sufficient:
 *
 *   - An `anthropic.com` base URL. This mirrors the idiom `getProviderTypes()`
 *     already uses to infer the 'messages' type from a string URL
 *     (`config.ts`), extended to the record form so that
 *     `{ messages: 'https://…anthropic.com/v1' }` is recognized too.
 *   - An `oauth://` base URL whose OAuth provider is `anthropic`. The
 *     `oauth://` test mirrors `isOAuthRouteForNative`
 *     (`request-payload-builder.ts`) minus its `targetApiType === 'oauth'`
 *     short-circuit: this resolver only ever sees `effectiveApiType`, and
 *     native-OAuth Anthropic routes arrive here already resolved to 'messages'.
 *     The `oauth_provider || route.provider` slug fallback copies
 *     `request-manager.ts`'s own resolution of the native OAuth provider.
 *     `isNativeOAuthRoute` is deliberately NOT reused: it matches codex and
 *     copilot too, which are not Anthropic targets.
 *   - `useClaudeMasking`, the provider-name-agnostic Claude-masking API-key
 *     route, which is Anthropic by construction (and so is URL-independent).
 *
 * The `includes('anthropic.com')` substring test is as loose as
 * `getProviderTypes()`'s — accepted for parity. A false positive only injects an
 * idempotent, deterministic id rewrite that a
 * `{ name: 'normalize_anthropic_tool_ids', enabled: false }` adapter entry
 * disables.
 *
 * @param effectiveApiType The FINAL outbound wire type. For the RECORD form of
 *   `api_base_url` this scopes the URL check to the entry the dispatcher would
 *   actually send to (see `selectDispatchUrls`), so a provider whose `messages`
 *   URL is a third-party proxy is not judged by an unrelated `chat` URL that
 *   happens to point at anthropic.com. Omit it (legacy callers/tests) to fall
 *   back to scanning every value in the record.
 */
export function isAnthropicTargetProvider(route: RouteResult, effectiveApiType?: string): boolean {
  if (route.config.useClaudeMasking === true) return true;
  const lowered = selectDispatchUrls(route.config.api_base_url, effectiveApiType).map((url) =>
    url.toLowerCase()
  );
  if (lowered.some((url) => url.includes('anthropic.com'))) return true;
  const isOAuth = lowered.some((url) => url.startsWith('oauth://'));
  return isOAuth && (route.config.oauth_provider || route.provider) === 'anthropic';
}

/**
 * The base URL(s) a dispatch for `effectiveApiType` would be sent to.
 *
 * String form: the one URL, whatever the API type — there is nothing to select.
 *
 * Record form with an API type: mirrors `resolveProviderBaseUrl`'s key
 * selection (`provider-api-selection.ts`) — the exact lower-cased API-type key
 * first, then the base-type key, so a `messages:<subtype>` route resolves to the
 * same `messages` URL the dispatcher uses. Only that URL is returned, because
 * only that URL is the one the request reaches.
 *
 * A miss on BOTH keys returns nothing, i.e. "not Anthropic". `resolveProviderBaseUrl`
 * does keep going in that case (`default` key, `API_TYPE_ALIASES`, then the first
 * key with a warning), but those fallbacks are deliberately NOT treated as an
 * Anthropic signal: a provider that doesn't advertise the wire type at all is
 * not evidence of an Anthropic target, and mis-injecting rewrites ids on a
 * non-Anthropic upstream. The `{ name: 'normalize_anthropic_tool_ids', options:
 * {}, enabled: true }` escape hatch covers the residual case.
 *
 * Record form without an API type: every value, preserving the pre-scoping
 * behaviour for callers that have no wire type to scope by.
 */
function selectDispatchUrls(
  base: string | Record<string, string> | undefined,
  effectiveApiType?: string
): string[] {
  if (typeof base === 'string') return [base];
  const urlMap = base ?? {};
  if (!effectiveApiType) {
    return Object.values(urlMap).filter((value): value is string => typeof value === 'string');
  }
  const typeKey = effectiveApiType.toLowerCase();
  const selected = urlMap[typeKey] || urlMap[getApiBaseType(typeKey)];
  return typeof selected === 'string' && selected.length > 0 ? [selected] : [];
}

function isGpt5Model(model: string): boolean {
  // Matches bare ids ("gpt-5", "gpt-5.2", "gpt-5-mini") AND provider-prefixed
  // target ids ("openai/gpt-5.5") used by pi-ai-registry-backed targets (e.g.
  // an OpenLimits aggregator route). Must not match lookalikes like "gpt-55",
  // "chatgpt-5", or "my-gpt-5x".
  return /(?:^|\/)gpt-5(?:[.-]|$)/i.test(model);
}
