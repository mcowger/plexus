/**
 * Shared pi-ai registry helpers used by the standard dispatch path and
 * registry-aware adapter work.
 *
 * This module owns:
 *  - resolveBaseUrl: resolve the api_base_url union and apply SDK-specific
 *    base-URL stripping rules, keyed off the upstream pi-ai API.
 *  - buildReasoningOptionsForModel / buildGenerationOptions: capability-aware
 *    egress reasoning + generation options from the pi-ai Model record.
 *  - resolvePiAiModel: resolve a pi-ai Model for a (provider, model) pair.
 *  - isPlaceholderThinkingSignature: guard against pi-ai's field-name placeholder
 *    thinking signatures.
 */

import { clampThinkingLevel, getSupportedThinkingLevels } from '@earendil-works/pi-ai';
import type { Model as PiAiModel, ModelThinkingLevel } from '@earendil-works/pi-ai';

import { getCatalogModel } from './catalog';

import type { RouteResult } from '../routing/router';
import type { ReasoningEffort, ReasoningIntent } from './reasoning';
import { effortToBudget, intentToEffort } from './reasoning';
import type { GenerationIntent } from './generation';

// ─── resolveBaseUrl ───────────────────────────────────────────────────────────
//
// Resolves the `api_base_url` from a `string | Record<string, string>` union
// using the *upstream* pi-ai API as the primary key (not the client-facing
// route type), then applies SDK-specific base-URL rules:
//
//  - anthropic-messages: strip a trailing bare `/v\d+` because the Anthropic
//    SDK appends `/v1` itself.
//  - all other API types: preserve the full URL (those SDKs only append the
//    endpoint path, e.g. `/chat/completions`).
//
// When apiBaseUrl is a Record, the key lookup order is:
//   1. Exact match on upstreamApi (e.g. "anthropic-messages")
//   2. Known Plexus alias for that upstream API
//   3. "default"
//   4. First value in the record

const UPSTREAM_API_ALIASES: Record<string, string[]> = {
  'openai-completions': ['chat'],
  'openai-responses': ['responses'],
  'anthropic-messages': ['messages'],
  'google-generative-ai': ['gemini'],
  'openai-codex-responses': ['codex'],
  'azure-openai-responses': ['azure'],
  'google-generative-ai-vertex': ['vertex'],
};

export function resolveBaseUrl(
  apiBaseUrl: string | Record<string, string> | undefined,
  upstreamApi: string,
  _incomingApiType?: string
): string {
  let rawUrl: string;

  if (!apiBaseUrl) {
    rawUrl = '';
  } else if (typeof apiBaseUrl === 'string') {
    rawUrl = apiBaseUrl;
  } else {
    // Record: try the upstream API key first, then known aliases, then "default", then first value
    const aliases = UPSTREAM_API_ALIASES[upstreamApi] ?? [];
    const keys = [upstreamApi, ...aliases, 'default'];
    let found: string | undefined;
    for (const key of keys) {
      if (key in apiBaseUrl) {
        found = apiBaseUrl[key];
        break;
      }
    }
    if (found === undefined) {
      // Fall back to first value
      const firstEntry = Object.values(apiBaseUrl)[0];
      found = firstEntry ?? '';
    }
    rawUrl = found;
  }

  // Apply SDK-specific base-URL rules:
  // Anthropic SDK appends /v1 itself — strip a trailing bare /v<digits>
  if (upstreamApi === 'anthropic-messages') {
    // Strip trailing /v<digits> (e.g. /v1, /v2) but not /v1/something
    rawUrl = rawUrl.replace(/\/v\d+\/?$/, '');
  }
  // Remove trailing slash for consistency
  rawUrl = rawUrl.replace(/\/$/, '');

  return rawUrl;
}

// ─── Capability-aware reasoning (Layer 2 + Layer 3) ───────────────────────────
//
// `buildReasoningOptionsForModel` builds egress reasoning options from the
// authoritative pi-ai `Model` record instead of matching model-ID substrings:
//
//   - `model.reasoning`                  → does this model reason at all?
//   - `model.thinkingLevelMap`           → which effort levels are supported,
//                                          and what provider value each maps to;
//                                          `off: null` means "cannot disable".
//   - `model.compat.forceAdaptiveThinking` (Anthropic) → adaptive `effort` mode
//                                          vs legacy `thinkingBudgetTokens`.
//
// Level clamping is delegated to pi-ai's own `clampThinkingLevel` /
// `getSupportedThinkingLevels`, so as new models land in the pi-ai registry the
// correct behaviour comes for free with no Plexus code change.
//
// Layer 3 default semantics (tri-state `enabled`):
//   - intent resolves to a concrete effort  → enable thinking at that effort
//   - intent explicitly 'off'               → disable, but only if the model
//                                              actually supports disabling
//   - intent is undefined (client said       → emit NOTHING and let the model
//     nothing)                                 use its native default

function modelSupportsDisable(model: PiAiModel<any>): boolean {
  // thinkingLevelMap.off === null means the provider cannot turn thinking off.
  return (model.thinkingLevelMap as any)?.off !== null;
}

/** Build the egress thinking options for a resolved pi-ai model + intent. */
export function buildReasoningOptionsForModel(
  model: Pick<PiAiModel<any>, 'api' | 'reasoning' | 'thinkingLevelMap' | 'compat'> & {
    id?: string;
  },
  intent: ReasoningIntent | undefined
): Record<string, any> {
  const api = model.api as string | undefined;

  // Non-reasoning models never receive thinking params, regardless of request.
  if (!model.reasoning) return {};

  const resolved = intent ? intentToEffort(intent) : undefined;

  // ── Client said nothing → defer to the model's native default ──────────────
  // (Layer 3: do NOT force-disable. The previous behaviour silently turned
  //  thinking off for reason-by-default models, surprising users.)
  if (resolved === undefined) return {};

  // ── Explicit disable ───────────────────────────────────────────────────────
  if (resolved === 'off') {
    if (!modelSupportsDisable(model as PiAiModel<any>)) {
      // Model cannot disable thinking — clamp to its lowest supported level
      // instead of emitting an option the provider will reject.
      const supported = getSupportedThinkingLevels(model as PiAiModel<any>).filter(
        (l) => l !== 'off'
      );
      const lowest = supported[0] as ReasoningEffort | undefined;
      if (!lowest) return {};
      return buildEnabledOptions(model, lowest, intent);
    }
    if (api === 'anthropic-messages') return { thinkingEnabled: false, reasoning: 'off' };
    if (api === 'google-generative-ai' || api === 'google-generative-ai-vertex') {
      return { thinking: { enabled: false }, reasoning: 'off' };
    }
    // OpenAI family: pi-ai emits the off-level via thinkingLevelMap itself.
    return { reasoning: 'off' };
  }

  // ── Enable at a concrete (clamped) effort ──────────────────────────────────
  const clamped = clampThinkingLevel(model as PiAiModel<any>, resolved as ModelThinkingLevel);
  if (clamped === 'off') {
    // The requested level isn't supported and clamped down to off — treat as
    // "let the model default" rather than forcing disable.
    return {};
  }
  return buildEnabledOptions(model, clamped as ReasoningEffort, intent);
}

/** Construct the per-API enabled-thinking option object for a known effort. */
function buildEnabledOptions(
  model: Pick<PiAiModel<any>, 'api' | 'thinkingLevelMap' | 'compat'> & { id?: string },
  effort: ReasoningEffort,
  intent: ReasoningIntent | undefined
): Record<string, any> {
  const api = model.api as string | undefined;
  // streamSimple-compatibility field; pi-ai's stream() clamps it again safely.
  const base: Record<string, any> = { reasoning: effort };

  if (
    api === 'openai-responses' ||
    api === 'openai-codex-responses' ||
    api === 'openai-completions' ||
    api === 'azure-openai-responses'
  ) {
    base.reasoningEffort = effort;
    // Reasoning visibility → OpenAI `reasoning.summary`. Prefer the client's
    // exact granularity (summaryDetail) when given; otherwise map visibility.
    if (intent?.visibility === 'summary' || intent?.visibility === 'full') {
      base.reasoningSummary = intent.summaryDetail ?? 'auto';
    }
    return base;
  }

  if (api === 'anthropic-messages') {
    base.thinkingEnabled = true;
    // Reasoning visibility → Anthropic thinking display. 'full' → raw thoughts,
    // 'summary' → summarized; pi-ai defaults to 'summarized' when unset.
    if (intent?.visibility === 'full') {
      base.thinkingDisplay = 'raw';
    } else if (intent?.visibility === 'summary') {
      base.thinkingDisplay = 'summarized';
    }
    if ((model.compat as { forceAdaptiveThinking?: boolean })?.forceAdaptiveThinking === true) {
      if (intent?.adaptive === true && intent?.effort == null) {
        // True adaptive: the client enabled thinking without committing to a
        // magnitude. Pass `thinkingEnabled: true` alone and let the model
        // decide how much to think — the native semantics of Anthropic
        // `thinking.type: 'adaptive'`. Do NOT pin `effort`, and drop the
        // streamSimple-compat `reasoning` level so nothing re-quantizes it.
        delete base.reasoning;
      } else {
        // Client committed to a magnitude (explicit effort / reasoning suffix):
        // pass it and let pi-ai map it via thinkingLevelMap (e.g. xhigh → "max"
        // on Opus 4.6).
        base.effort = effort;
      }
    } else {
      // Budget-based thinking for older Claude models. Round-trip the client's
      // exact budget when they gave one; otherwise derive from the effort.
      base.thinkingBudgetTokens = intent?.budgetTokens ?? effortToBudget(effort);
    }
    return base;
  }

  if (api === 'google-generative-ai' || api === 'google-generative-ai-vertex') {
    // pi-ai's stream() google path passes `thinking.level` through verbatim and
    // `thinking.budgetTokens` through verbatim — it does NOT apply
    // thinkingLevelMap (that only happens in streamSimpleGoogle). So we must
    // pick the right shape ourselves:
    //   - Level-based models (Gemini 3 / Gemma 4) carry concrete level entries
    //     in thinkingLevelMap; map the effort → provider value (e.g. "HIGH").
    //   - Budget-based models (Gemini 2.x) have no level map; send budgetTokens
    //     (round-trip the client's budget when present).
    const tlm = model.thinkingLevelMap as Record<string, string | null> | undefined;
    const isLevelBased =
      tlm != null &&
      (['minimal', 'low', 'medium', 'high', 'xhigh'] as const).some(
        (l) => typeof tlm[l] === 'string'
      );
    // Gemini surfaces thinking via includeThoughts; default to visible unless
    // the client explicitly asked to hide it.
    const includeThoughts = intent?.visibility !== 'hidden';
    if (isLevelBased) {
      const providerLevel = tlm?.[effort];
      base.thinking = {
        enabled: true,
        includeThoughts,
        level: typeof providerLevel === 'string' ? providerLevel : effort.toUpperCase(),
      };
    } else {
      base.thinking = {
        enabled: true,
        includeThoughts,
        budgetTokens: intent?.budgetTokens ?? effortToBudget(effort),
      };
    }
    return base;
  }

  return base;
}

// ─── buildGenerationOptions (generalized egress) ────────────────────────────
//
// Capability-aware egress for the full GenerationIntent: reasoning (delegated to
// buildReasoningOptionsForModel) plus the non-reasoning knobs that also need
// model-aware handling:
//
//   - maxTokens   → clamped to model.maxTokens (omitting it lets pi-ai apply
//                   the model default; an over-limit value would 400).
//   - temperature → DROPPED when thinking is enabled or the model rejects it
//                   (compat.supportsTemperature === false, e.g. Opus 4.7+).
//                   Mirrors pi-ai's own anthropic guard so we never send a
//                   value the provider will reject.
//   - verbosity   → OpenAI-family only (textVerbosity).
//   - serviceTier → OpenAI-family / responses only.

export function buildGenerationOptions(
  model: Pick<PiAiModel<any>, 'api' | 'reasoning' | 'thinkingLevelMap' | 'compat' | 'maxTokens'> & {
    id?: string;
  },
  intent: GenerationIntent | undefined
): Record<string, any> {
  if (!intent) return {};
  const api = model.api as string | undefined;
  const opts: Record<string, any> = buildReasoningOptionsForModel(model, intent.reasoning);

  // ── maxTokens: clamp to the model's advertised ceiling ───────────────────
  if (intent.maxTokens != null && intent.maxTokens > 0) {
    const ceiling =
      typeof model.maxTokens === 'number' && model.maxTokens > 0 ? model.maxTokens : undefined;
    opts.maxTokens = ceiling != null ? Math.min(intent.maxTokens, ceiling) : intent.maxTokens;
  }

  // ── temperature: incompatibility guards ───────────────────────────────
  if (intent.temperature != null) {
    const thinkingOn = opts.thinkingEnabled === true || opts.reasoningEffort != null;
    const tempSupported =
      (model.compat as { supportsTemperature?: boolean })?.supportsTemperature !== false;
    const tempIncompatibleWithThinking = api === 'anthropic-messages' && thinkingOn;
    if (tempSupported && !tempIncompatibleWithThinking) {
      opts.temperature = intent.temperature;
    }
  }

  // ── verbosity: OpenAI family only ──────────────────────────────────
  if (intent.verbosity != null && isOpenAiFamily(api)) {
    opts.textVerbosity = intent.verbosity;
  }

  // ── serviceTier: OpenAI family only ────────────────────────────────
  if (intent.serviceTier != null && isOpenAiFamily(api)) {
    opts.serviceTier = intent.serviceTier;
  }

  return opts;
}

function isOpenAiFamily(api: string | undefined): boolean {
  return (
    api === 'openai-responses' ||
    api === 'openai-codex-responses' ||
    api === 'openai-completions' ||
    api === 'azure-openai-responses'
  );
}

/**
 * Resolve a pi-ai Model for a (provider, modelId) pair from the dynamic
 * catalog (built-in baseline + pi.dev overlay). Returns null when unresolved.
 */
export function resolvePiAiModel(piAiProvider: string, piAiModelId: string): PiAiModel<any> | null {
  return getCatalogModel(piAiProvider, piAiModelId);
}

// ─── Thinking signature validation ───────────────────────────────────────────
//
// pi-ai's openai-completions parser (ensureThinkingBlock) stamps a thinking
// block's `thinkingSignature` with the *JSON field name* it matched
// (`reasoning` | `reasoning_content` | `reasoning_text`) as soon as any
// reasoning delta arrives — before it knows whether the provider will ever
// send a real cryptographic signature via `reasoning_details[].signature`.
// When a provider's `reasoning_details` entries don't match pi-ai's
// `isEncryptedReasoningDetail` shape (Gemini-style {type, id, data}) — e.g.
// Bedrock/OpenRouter's `{type: "reasoning.text", signature: "..."}` — the real
// signature is never picked up, and this placeholder field-name string is all
// that's left on the block. Forwarding it to a client as if it were a genuine
// signature is worse than omitting it: a later replay to a provider that
// actually validates signatures (e.g. Anthropic) is rejected outright with
// "Invalid signature in thinking block", and it could just as easily be
// mistaken for a signature from an entirely different provider.

const THINKING_SIGNATURE_FIELD_NAME_PLACEHOLDERS = new Set([
  'reasoning',
  'reasoning_content',
  'reasoning_text',
]);

/** True when `signature` is pi-ai's leftover field-name placeholder, not a real signature. */
export function isPlaceholderThinkingSignature(signature: string | undefined): boolean {
  return signature != null && THINKING_SIGNATURE_FIELD_NAME_PLACEHOLDERS.has(signature);
}
