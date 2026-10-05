import type { UnifiedChatRequest } from '../../types/unified';
import { getApiBaseType } from '../../utils/api-format';
import { logger } from '../../utils/logger';

/**
 * Plexus's canonical service-tier vocabulary. Providers spell the same idea
 * differently (`default`/`on_demand`/`standard_only`, `fast`), so inbound tiers
 * are normalized to these five canonical values before a model capability map
 * decides the provider-native value (or that the tier is unsupported).
 */
export type CanonicalServiceTier = 'auto' | 'standard' | 'flex' | 'priority' | 'ultrafast';

/** Wire shape a model's `serviceTierMap` values are projected through. */
export type ServiceTierFormat = 'service-tier' | 'anthropic-speed';

/** Per-model capability map: native value string, or `null` = unsupported. */
export interface ServiceTierMap {
  auto?: string | null;
  standard?: string | null;
  flex?: string | null;
  priority?: string | null;
  ultrafast?: string | null;
}

/**
 * Nearest same-idea fallback when the requested tier (or a value already tried)
 * is unsupported. `standard` is the floor; once it is unsupported too the tier
 * is dropped and the provider's native default applies.
 */
const SERVICE_TIER_FALLBACKS: Record<CanonicalServiceTier, CanonicalServiceTier[]> = {
  ultrafast: ['ultrafast', 'priority', 'standard'],
  priority: ['priority', 'standard'],
  flex: ['flex', 'standard'],
  standard: ['standard'],
  auto: ['auto'],
};

/** Normalize an inbound wire tier to canonical form. */
export function normalizeServiceTier(
  raw: string | undefined | null
): CanonicalServiceTier | undefined {
  if (typeof raw !== 'string') return undefined;
  switch (raw.trim().toLowerCase()) {
    case 'auto':
      return 'auto';
    case 'default':
    case 'on_demand':
    case 'standard_only':
    case 'standard':
      return 'standard';
    case 'flex':
      return 'flex';
    case 'fast':
    case 'priority':
      return 'priority';
    case 'ultrafast':
      return 'ultrafast';
    default:
      return undefined;
  }
}

/** Infer the wire shape from the upstream API when no explicit format is set. */
export function inferServiceTierFormat(api: string | undefined): ServiceTierFormat | undefined {
  if (api === 'anthropic-messages') return 'anthropic-speed';
  if (
    api === 'openai-completions' ||
    api === 'openai-responses' ||
    api === 'openai-codex-responses' ||
    api === 'azure-openai-responses'
  ) {
    return 'service-tier';
  }
  return undefined;
}

export interface ResolvedServiceTier {
  /** Native value to write; `undefined` means native default (omit). */
  value?: string;
}

/**
 * Resolve an inbound tier against a model's capability map + wire format.
 *
 * Returns `undefined` when there is no tier intent (emit nothing). Otherwise the
 * caller always receives a result: a `value` to write, or an empty result that
 * means "omit the field and let the provider native default apply". An empty
 * result must not delete an unrelated native control (e.g. Anthropic
 * `service_tier` when only `speed` is mapped).
 */
export function resolveServiceTier(
  intent: string | undefined,
  map: ServiceTierMap | undefined,
  format: ServiceTierFormat
): ResolvedServiceTier | undefined {
  if (intent === undefined) return undefined;

  const canonical = normalizeServiceTier(intent);
  if (!canonical) {
    // A provider-specific value Plexus does not canonicalize (e.g. OpenAI
    // `scale`/`reserved`). Preserve it verbatim rather than silently dropping
    // it; `anthropic-speed` has no spelling for it, so leave the body alone.
    return format === 'service-tier' ? { value: intent } : {};
  }

  for (const tier of SERVICE_TIER_FALLBACKS[canonical]) {
    const native = map?.[tier];
    if (typeof native === 'string' && native.length > 0) {
      if (format === 'anthropic-speed') {
        // Fast mode is the only `speed` value that needs the beta flag; the
        // header is resolved later against the final outbound body (see
        // request-payload-builder.ts ensureAnthropicFastModeBeta).
        if (native === 'fast') return { value: 'fast' };
        if (native === 'standard') return { value: 'standard' };
        // Any other native (notably `auto`) has no `speed` spelling: omit
        // `speed` and leave the body's native `service_tier` untouched.
        return {};
      }
      return { value: native };
    }
    // `null` or absent -> try the next nearest tier.
  }

  // No supported tier in the fallback chain: native default. An empty result
  // tells the projection to omit the field (and never leak the rejected value).
  return {};
}

/**
 * `service_tier`/`speed` only exist on wire formats that declare a
 * `serviceTierFormat`. This legacy writer handles `@<tier>` suffixes for
 * providers with no capability map: it writes OpenAI-style bodies (normalizing
 * the standard/ultrafast wire aliases) and leaves every other body untouched.
 * Mapped models are overwritten afterwards by the registry auto-compat
 * projection.
 */
/** Target base types whose bodies carry an OpenAI-style `service_tier` field. */
export const SERVICE_TIER_API_TYPES = new Set(['chat', 'responses']);

/** True when a body-shaped value carries a non-empty `speed` or `service_tier`. */
export function hasExplicitTier(value: any): boolean {
  if (!value || typeof value !== 'object') return false;
  return (
    (typeof value.speed === 'string' && value.speed.length > 0) ||
    (typeof value.service_tier === 'string' && value.service_tier.length > 0)
  );
}

/**
 * The per-key default service tier attached to the request metadata by
 * attachKeyAccessPolicy(). Returns undefined when the key declared none.
 */
export function getDefaultServiceTier(request: UnifiedChatRequest): string | undefined {
  const value = request.metadata?.plexus_metadata?.defaultServiceTier;
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * OpenAI wire aliases for the legacy (unmapped) writer. OpenAI spells the
 * standard tier `default`, has no `fast` value (`fast` is Plexus's alias for
 * `priority`), and has no `ultrafast` capacity value — the nearest
 * same-idea tier is `priority`. Only the emitted value is rewritten; the
 * request's canonical `serviceTier` is left untouched so a model capability map
 * still sees `ultrafast`.
 */
const LEGACY_SERVICE_TIER_WIRE_ALIASES: Record<string, string> = {
  standard: 'default',
  fast: 'priority',
  ultrafast: 'priority',
};

function legacyServiceTierWireValue(tier: string): string {
  return LEGACY_SERVICE_TIER_WIRE_ALIASES[tier.trim().toLowerCase()] ?? tier;
}

/**
 * Apply the service tier selected by an `@<tier>` model-name suffix to the
 * upstream body, falling back to the per-key `defaultServiceTier` when the
 * client requested no tier of its own.
 *
 * The suffix is the most specific thing the client said, so it replaces a
 * `service_tier` already in the body. Provider, model, and alias `extraBody`
 * are merged after this and still win. An explicit body `service_tier`/`speed`
 * (including a cross-format value preserved on `originalBody`) also beats the
 * key default, and the body is left untouched in that case so the injected
 * default cannot mask the explicit tier in the registry projection later.
 */
export function applyServiceTierSelection(
  payload: any,
  request: UnifiedChatRequest,
  targetApiType: string
): any {
  const apiBaseType = getApiBaseType(targetApiType);

  if (request.serviceTier) {
    if (!SERVICE_TIER_API_TYPES.has(apiBaseType)) {
      logger.debug(
        `Service tier '${request.serviceTier}' not applied: ${targetApiType} bodies have no service_tier`
      );
      return payload;
    }
    return { ...payload, service_tier: legacyServiceTierWireValue(request.serviceTier) };
  }

  // No suffix. An explicit `service_tier`/`speed` the client sent in the body
  // (possibly transformed away from the payload, so `originalBody` is
  // authoritative for cross-format routing) always beats the key default.
  if (hasExplicitTier(payload) || hasExplicitTier(request.originalBody)) {
    return payload;
  }

  const defaultTier = getDefaultServiceTier(request);
  if (!defaultTier) return payload;

  if (!SERVICE_TIER_API_TYPES.has(apiBaseType)) {
    logger.debug(
      `Default service tier '${defaultTier}' not applied: ${targetApiType} bodies have no service_tier`
    );
    return payload;
  }

  return { ...payload, service_tier: legacyServiceTierWireValue(defaultTier) };
}

/**
 * Remove a per-key-default tier previously injected by
 * {@link applyServiceTierSelection} when the target turns out to declare no
 * tier support. Key defaults are best-effort: sending one to a provider that
 * does not understand `service_tier` (or the value) fails the whole request,
 * so unknown support means omit and let the provider native default apply.
 * Explicit tiers are never touched here — a suffix, body `service_tier`, or
 * `speed` is a deliberate client demand that keeps its legacy pass-through.
 *
 * Provenance: with the client `originalBody` present (always true on the
 * live request path), any payload tier coexisting with "no explicit tier
 * anywhere" can only be our injection. Without an `originalBody` (unit-level
 * direct calls) provenance is ambiguous, so only an exact wire-form match
 * against the key default is removed and a genuinely different explicit tier
 * is preserved.
 *
 * Returns the payload unchanged when there is nothing to strip; otherwise a
 * shallow copy without `service_tier` (never mutates its input).
 */
export function stripKeyDefaultTier(payload: any, request: UnifiedChatRequest): any {
  if (!payload || typeof payload !== 'object') return payload;
  if (typeof request.serviceTier === 'string' && request.serviceTier.length > 0) return payload;
  if (hasExplicitTier(request.originalBody)) return payload;
  const keyDefault = getDefaultServiceTier(request);
  if (!keyDefault) return payload;
  const current = (payload as Record<string, unknown>).service_tier;
  if (typeof current !== 'string' || current.length === 0) return payload;
  if (current.trim().toLowerCase() !== legacyServiceTierWireValue(keyDefault).toLowerCase()) {
    return payload;
  }
  const next = { ...payload };
  delete next.service_tier;
  logger.debug(
    `Stripped key-default service tier '${current}' for ${request.model ?? '<unknown model>'}: target declares no tier support`
  );
  return next;
}
