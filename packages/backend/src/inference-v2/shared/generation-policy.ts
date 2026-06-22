/**
 * Layer 4 — generation policy resolution for the inference-v2 path.
 *
 * Combines the per-request {@link GenerationIntent} (from the inbound parser)
 * with operator policy declared on the API key and/or model alias, plus an
 * out-of-band `x-plexus-reasoning` header override for reasoning effort. The
 * result is a single {@link GenerationIntent} the egress layer acts on.
 *
 * Reasoning precedence (highest first):
 *   1. `x-plexus-reasoning` request header   (source: 'header')
 *   2. request body intent                   (source: 'client')
 *   3. key policy `reasoning.default`        (source: 'key')
 *   4. alias policy `reasoning.default`      (source: 'alias')
 *   5. model native default                  (intent left undefined)
 * After the winning effort is chosen, key + alias `floor`/`ceiling` clamps
 * apply (most-restrictive wins). `allowClientOverride: false` pins the default.
 *
 * maxTokens / verbosity / serviceTier follow the same key→alias→default
 * precedence (no header). `maxTokens.ceiling` caps the client's value;
 * `*.default` fills in only when the client omitted the value. The model's
 * physical token ceiling is still applied later by buildGenerationOptions().
 *
 * The model-name suffix convention (e.g. `gpt-5:high`, `model:off`) is handled
 * by {@link splitReasoningSuffix}, which the executor calls before routing.
 */

import type { FastifyRequest } from 'fastify';
import { getConfig, type GenerationPolicy, type ReasoningEffortPolicy } from '../../config';
import type { RouteResult } from '../../services/router';
import {
  type ReasoningEffort,
  type ReasoningIntent,
  clampEffortToWindow,
  normalizeEffort,
} from './reasoning';
import type { GenerationIntent, TextVerbosity } from './generation';

const HEADER = 'x-plexus-reasoning';

/**
 * Split a trailing `:effort` suffix off a model alias.
 *
 * Returns the bare alias plus an intent when a recognised suffix is present
 * (`:off|minimal|low|medium|high|xhigh|max`). Unknown suffixes are left intact
 * on the alias (they may be a legitimate part of the model name).
 */
export function splitReasoningSuffix(modelAlias: string): {
  alias: string;
  intent?: ReasoningIntent;
} {
  const idx = modelAlias.lastIndexOf(':');
  if (idx <= 0 || idx === modelAlias.length - 1) return { alias: modelAlias };
  const suffix = modelAlias.slice(idx + 1);
  const effort = normalizeEffort(suffix);
  if (effort === undefined) return { alias: modelAlias };
  const alias = modelAlias.slice(0, idx);
  if (effort === 'off') {
    return { alias, intent: { enabled: false, source: 'client' } };
  }
  return { alias, intent: { effort, enabled: true, source: 'client' } };
}

/** Parse the `x-plexus-reasoning` header into an intent, if present/valid. */
function headerIntent(request: FastifyRequest): ReasoningIntent | undefined {
  const raw = (request.headers as Record<string, unknown>)?.[HEADER];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string') return undefined;
  const effort = normalizeEffort(value);
  if (effort === undefined) return undefined;
  if (effort === 'off') return { enabled: false, source: 'header' };
  return { effort, enabled: true, source: 'header' };
}

/** Look up the alias-level generation policy for a resolved route. */
function aliasPolicy(route: RouteResult): GenerationPolicy | undefined {
  const aliasName = route.canonicalModel ?? route.incomingModelAlias;
  if (!aliasName) return undefined;
  return getConfig().models?.[aliasName]?.generation;
}

function reasoningDefaultIntent(
  policy: ReasoningEffortPolicy | undefined,
  source: ReasoningIntent['source']
): ReasoningIntent | undefined {
  if (!policy?.default) return undefined;
  if (policy.default === 'off') return { enabled: false, source };
  return { effort: policy.default as ReasoningEffort, enabled: true, source };
}

export interface ResolveGenerationInput {
  /** Generation intent parsed from the request body (Layer 1). */
  requestIntent: GenerationIntent;
  /** Reasoning suffix stripped from the model alias (e.g. ":high"), if any. */
  suffixReasoning?: ReasoningIntent;
  request: FastifyRequest;
  route: RouteResult;
}

/**
 * Resolve the effective {@link GenerationIntent} after applying key/alias
 * policy, the reasoning header override, suffix fallback, and clamps.
 */
export function resolveGenerationIntent(input: ResolveGenerationInput): GenerationIntent {
  const { requestIntent, suffixReasoning, request, route } = input;
  const keyPolicy = (request as any).keyConfig?.generation as GenerationPolicy | undefined;
  const aPolicy = aliasPolicy(route);

  return {
    reasoning: resolveReasoning(
      requestIntent.reasoning,
      suffixReasoning,
      keyPolicy,
      aPolicy,
      request
    ),
    maxTokens: resolveMaxTokens(requestIntent.maxTokens, keyPolicy, aPolicy),
    temperature: requestIntent.temperature,
    verbosity: resolveVerbosity(requestIntent.verbosity, keyPolicy, aPolicy),
    serviceTier: resolveServiceTier(requestIntent.serviceTier, keyPolicy, aPolicy),
  };
}

// ─── Reasoning ─────────────────────────────────────────────────────────────

function resolveReasoning(
  bodyReasoning: ReasoningIntent,
  suffixReasoning: ReasoningIntent | undefined,
  keyPolicy: GenerationPolicy | undefined,
  aPolicy: GenerationPolicy | undefined,
  request: FastifyRequest
): ReasoningIntent {
  const keyR = keyPolicy?.reasoning;
  const aliasR = aPolicy?.reasoning;

  // A body reasoning intent counts as a "signal" only when it actually carries
  // one; an empty { source } means the client said nothing, so a suffix applies.
  const bodyHasSignal =
    bodyReasoning.effort != null ||
    bodyReasoning.budgetTokens != null ||
    bodyReasoning.enabled != null;
  const requestReasoning = bodyHasSignal ? bodyReasoning : (suffixReasoning ?? bodyReasoning);

  // Header beats body for the client-side signal. A reasoning intent with no
  // actual signal (effort/budget/enabled all unset) counts as "no client
  // request" so policy defaults can apply.
  const hasSignal = (i: ReasoningIntent | undefined): i is ReasoningIntent =>
    i != null && (i.effort != null || i.budgetTokens != null || i.enabled != null);
  const headerR = headerIntent(request);
  const clientIntent = hasSignal(headerR)
    ? headerR
    : hasSignal(requestReasoning)
      ? requestReasoning
      : undefined;

  const keyForbids = keyR?.allowClientOverride === false;
  const aliasForbids = aliasR?.allowClientOverride === false;

  let chosen: ReasoningIntent | undefined;
  if (keyForbids) {
    chosen = reasoningDefaultIntent(keyR, 'key') ?? clientIntent;
  } else if (aliasForbids) {
    chosen =
      reasoningDefaultIntent(aliasR, 'alias') ??
      clientIntent ??
      reasoningDefaultIntent(keyR, 'key');
  } else {
    chosen =
      clientIntent ??
      reasoningDefaultIntent(keyR, 'key') ??
      reasoningDefaultIntent(aliasR, 'alias');
  }

  if (!chosen) return { source: 'client' };

  // floor/ceiling clamp the magnitude of a concrete effort; 'off' is left as-is.
  const floor = mostRestrictiveFloor(keyR?.floor, aliasR?.floor);
  const ceiling = mostRestrictiveCeiling(keyR?.ceiling, aliasR?.ceiling);
  if (chosen.effort && (floor || ceiling)) {
    const clamped = clampEffortToWindow(chosen.effort, floor, ceiling);
    if (clamped !== chosen.effort) chosen = { ...chosen, effort: clamped };
  }
  return chosen;
}

function mostRestrictiveFloor(
  a?: ReasoningEffortPolicy['floor'],
  b?: ReasoningEffortPolicy['floor']
): ReasoningEffort | undefined {
  const order = ['minimal', 'low', 'medium', 'high', 'xhigh'];
  const candidates = [a, b].filter((v): v is ReasoningEffort => !!v && v !== 'off');
  if (candidates.length === 0) return undefined;
  return candidates.reduce((hi, cur) => (order.indexOf(cur) > order.indexOf(hi) ? cur : hi));
}

function mostRestrictiveCeiling(
  a?: ReasoningEffortPolicy['ceiling'],
  b?: ReasoningEffortPolicy['ceiling']
): ReasoningEffort | undefined {
  const order = ['minimal', 'low', 'medium', 'high', 'xhigh'];
  const candidates = [a, b].filter((v): v is ReasoningEffort => !!v && v !== 'off');
  if (candidates.length === 0) return undefined;
  return candidates.reduce((lo, cur) => (order.indexOf(cur) < order.indexOf(lo) ? cur : lo));
}

// ─── max tokens ────────────────────────────────────────────────────────────

function resolveMaxTokens(
  requested: number | undefined,
  keyPolicy: GenerationPolicy | undefined,
  aPolicy: GenerationPolicy | undefined
): number | undefined {
  // Default fills in only when the client omitted the value (key beats alias).
  let value = requested ?? keyPolicy?.maxTokens?.default ?? aPolicy?.maxTokens?.default;
  if (value == null) return undefined;
  // Most-restrictive ceiling caps it (model ceiling is applied later at egress).
  const ceilings = [keyPolicy?.maxTokens?.ceiling, aPolicy?.maxTokens?.ceiling].filter(
    (c): c is number => typeof c === 'number'
  );
  if (ceilings.length > 0) value = Math.min(value, ...ceilings);
  return value;
}

// ─── verbosity ─────────────────────────────────────────────────────────────

function resolveVerbosity(
  requested: TextVerbosity | undefined,
  keyPolicy: GenerationPolicy | undefined,
  aPolicy: GenerationPolicy | undefined
): TextVerbosity | undefined {
  const keyV = keyPolicy?.verbosity;
  const aliasV = aPolicy?.verbosity;
  if (keyV?.allowClientOverride === false && keyV.default) return keyV.default;
  if (aliasV?.allowClientOverride === false && aliasV.default) return aliasV.default;
  return requested ?? keyV?.default ?? aliasV?.default;
}

// ─── service tier ──────────────────────────────────────────────────────────

function resolveServiceTier(
  requested: string | undefined,
  keyPolicy: GenerationPolicy | undefined,
  aPolicy: GenerationPolicy | undefined
): string | undefined {
  const keyS = keyPolicy?.serviceTier;
  const aliasS = aPolicy?.serviceTier;
  if (keyS?.allowClientOverride === false && keyS.default) return keyS.default;
  if (aliasS?.allowClientOverride === false && aliasS.default) return aliasS.default;
  return requested ?? keyS?.default ?? aliasS?.default;
}
