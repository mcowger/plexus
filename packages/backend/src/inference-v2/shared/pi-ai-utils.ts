/**
 * Shared pi-ai utilities for the beta inference path.
 *
 * This module owns:
 *  - buildThinkingOptions: per-provider reasoning option construction (moved from oauth-transformer.ts)
 *  - resolveBaseUrl: resolve api_base_url union and apply SDK-specific stripping rules
 *  - buildReasoningOptions: wrap buildThinkingOptions with explicit-disable defaults
 *  - buildPiAiModel: construct a call-ready pi-ai Model with base URL override applied
 */

import { clampThinkingLevel, getSupportedThinkingLevels } from '@earendil-works/pi-ai';
import { getBuiltinModel, builtinModels } from '@earendil-works/pi-ai/providers/all';
import type { Model as PiAiModel, ModelThinkingLevel } from '@earendil-works/pi-ai';

export const piAiModels = builtinModels();
import {
  getConfig,
  type ProviderConfig,
  type PiAiCustomModel,
  type PiAiCustomProvider,
} from '../../config';
import type { RouteResult } from '../../services/router';
import { estimateKwhUsed } from '../../services/inference-energy';
import { resolveModelParams, DEFAULT_GPU_PARAMS } from '@plexus/shared';
import type { ReasoningEffort, ReasoningIntent } from './reasoning';
import { effortToBudget, intentToEffort } from './reasoning';
import type { GenerationIntent } from './generation';

// ─── buildThinkingOptions ─────────────────────────────────────────────────────
//
// Returns the pi-ai request options needed to enable thinking/reasoning for a
// given model API and effort level. Each pi-ai stream implementation uses
// different field names:
//
//  - anthropic-messages          → thinkingEnabled + (effort | thinkingBudgetTokens)
//  - openai-responses /
//    openai-codex-responses       → reasoningEffort
//  - google-gemini-cli Gemini 3  → thinking.level
//  - everything else (Gemini 2.x)→ thinking.budgetTokens
//
// `reasoning` is always included for streamSimple* compatibility.

export function buildThinkingOptions(
  modelApi: string | undefined,
  modelId: string | undefined,
  effort: string,
  maxTokens?: number,
  summary?: string,
  textVerbosity?: string
): Record<string, any> {
  const BUDGET: Record<string, number> = {
    minimal: 1024,
    low: 2048,
    medium: 8192,
    high: 16384,
  };

  // streamSimple compatibility — always included regardless of API type
  const base: Record<string, any> = { reasoning: effort };

  if (
    modelApi === 'openai-responses' ||
    modelApi === 'openai-codex-responses' ||
    modelApi === 'openai-completions'
  ) {
    base.reasoningEffort = effort;
    if (summary) base.reasoningSummary = summary;
    if (textVerbosity) base.textVerbosity = textVerbosity;
    return base;
  }

  if (modelApi === 'anthropic-messages') {
    const isAdaptive =
      modelId?.includes('opus-4-6') ||
      modelId?.includes('opus-4.6') ||
      modelId?.includes('sonnet-4-6') ||
      modelId?.includes('sonnet-4.6');

    base.thinkingEnabled = true;
    if (isAdaptive) {
      const effortMap: Record<string, string> = {
        minimal: 'low',
        low: 'low',
        medium: 'medium',
        high: 'high',
        xhigh: modelId?.includes('opus-4-6') || modelId?.includes('opus-4.6') ? 'max' : 'high',
      };
      base.effort = effortMap[effort] ?? 'high';
    } else {
      base.thinkingBudgetTokens = maxTokens ?? BUDGET[effort] ?? 16384;
    }
    return base;
  }

  // Gemini providers use `options.thinking` object
  const isGemini3 = modelId?.includes('3-pro') || modelId?.includes('3-flash');
  if (isGemini3) {
    const levelMap: Record<string, string> = {
      minimal: 'MINIMAL',
      low: 'LOW',
      medium: 'MEDIUM',
      high: 'HIGH',
    };
    base.thinking = { enabled: true, level: levelMap[effort] ?? 'HIGH' };
  } else {
    base.thinking = { enabled: true, budgetTokens: maxTokens ?? BUDGET[effort] ?? 16384 };
  }
  return base;
}

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

// ─── buildReasoningOptions ────────────────────────────────────────────────────
//
// When `effort` is present, delegates to buildThinkingOptions to enable
// thinking/reasoning.
//
// When `effort` is absent, explicitly disables thinking per provider to prevent
// silent thinking-token consumption (mirrors what streamSimple does internally):
//  - anthropic-messages     → { thinkingEnabled: false }
//  - google-generative-ai   → { thinking: { enabled: false } }
//  - OpenAI family          → {} (no thinking field needed)

export function buildReasoningOptions(
  piApi: string | undefined,
  piModelId: string | undefined,
  effort?: string
): Record<string, any> {
  if (effort) {
    return buildThinkingOptions(piApi, piModelId, effort);
  }

  // Explicitly disable thinking
  if (piApi === 'anthropic-messages') {
    return { thinkingEnabled: false };
  }
  if (piApi === 'google-generative-ai' || piApi === 'google-generative-ai-vertex') {
    return { thinking: { enabled: false } };
  }
  // OpenAI family: no thinking field needed
  return {};
}

// ─── Capability-aware reasoning (Layer 2 + Layer 3) ───────────────────────────
//
// `buildReasoningOptionsForModel` is the capability-aware replacement for
// `buildReasoningOptions`. Instead of matching model-ID substrings, it consults
// the authoritative pi-ai `Model` record:
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
      // Adaptive thinking: pass the effort and let pi-ai map it via
      // thinkingLevelMap (e.g. xhigh → "max" on Opus 4.6).
      base.effort = effort;
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

// ─── resolvePiAiModel ─────────────────────────────────────────────────────────
//
// Single resolution point for a pi-ai Model object given a (provider, modelId)
// pair from Plexus config. Resolution precedence:
//
//   1. Custom model registry  (config.pi_ai_custom_models[modelId])
//        - provider-scoped: only matches when the model's `provider` equals
//          the referencing provider.
//        - `inherits` clones a registry base, then deep-merges overrides;
//        - otherwise a full standalone spec.
//   2. Custom provider registry (config.pi_ai_custom_providers[provider])
//        - supplies the wire `api` + compat for a base model resolved from the
//          registry (or a custom model), for niche hosts pi-ai doesn't know.
//   3. pi-ai built-in registry (getModel()).
//   4. null when nothing resolves.
//
// IMPORTANT: pi-ai 0.79.x `getModel()` returns `undefined` (it does NOT throw)
// for unknown pairs, so callers MUST null-check the result of this function
// rather than relying on a try/catch.

function deepMerge<T>(base: T, patch: Partial<T> | undefined): T {
  if (!patch) return base;
  const out: any = Array.isArray(base) ? [...(base as any)] : { ...(base as any) };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    const cur = (out as any)[k];
    if (
      v !== null &&
      typeof v === 'object' &&
      !Array.isArray(v) &&
      cur !== null &&
      typeof cur === 'object' &&
      !Array.isArray(cur)
    ) {
      (out as any)[k] = deepMerge(cur, v as any);
    } else {
      (out as any)[k] = v;
    }
  }
  return out;
}

/** Apply a custom-model spec's fields onto a base Model via deep merge. */
function applyCustomModelFields(base: PiAiModel<any>, spec: PiAiCustomModel): PiAiModel<any> {
  const overrides: Record<string, any> = {};
  if (spec.api != null) overrides.api = spec.api;
  if (spec.name != null) overrides.name = spec.name;
  if (spec.contextWindow != null) overrides.contextWindow = spec.contextWindow;
  if (spec.maxTokens != null) overrides.maxTokens = spec.maxTokens;
  if (spec.reasoning != null) overrides.reasoning = spec.reasoning;
  if (spec.thinkingLevelMap != null) overrides.thinkingLevelMap = spec.thinkingLevelMap;
  if (spec.input != null) overrides.input = spec.input;
  if (spec.cost != null) overrides.cost = spec.cost;
  if (spec.compat != null) overrides.compat = spec.compat;
  return deepMerge(base, overrides);
}

/**
 * getModel may return undefined (pi-ai 0.79.x) or throw (older versions /
 * mocked) for unknown pairs — normalise both to null.
 */
function safeGetModel(provider: string, modelId: string): PiAiModel<any> | null {
  try {
    return getBuiltinModel(provider as any, modelId as any) ?? null;
  } catch {
    return null;
  }
}

/** A minimal Model skeleton used when a custom model has no inheritance base. */
function emptyModelSkeleton(id: string, provider: string, api: string): PiAiModel<any> {
  return {
    id,
    name: id,
    api,
    provider,
    baseUrl: '',
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 0,
    maxTokens: 0,
  } as PiAiModel<any>;
}

function resolveCustomModel(
  spec: PiAiCustomModel,
  provider: string,
  modelId: string
): PiAiModel<any> | null {
  let base: PiAiModel<any> | null = null;
  if (spec.inherits) {
    base = safeGetModel(spec.inherits.provider, spec.inherits.model_id);
    if (!base) return null; // inheritance target missing → unresolved
  }
  if (!base) {
    const api = spec.api;
    if (!api) return null; // standalone spec must declare an api
    base = emptyModelSkeleton(modelId, provider, api);
  }
  // Preserve the caller's id/provider identity on the resolved model.
  const merged = applyCustomModelFields(base, spec);
  return { ...merged, id: modelId, provider };
}

const API_TO_BUILTIN_PROVIDER: Record<string, string> = {
  'anthropic-messages': 'anthropic',
  'google-generative-ai': 'google',
  'google-generative-ai-vertex': 'google',
  'azure-openai-responses': 'azure',
  'openai-completions': 'openai',
  'openai-responses': 'openai',
  'openai-codex-responses': 'openai',
};

/**
 * Resolve a pi-ai Model for a (provider, modelId) pair, consulting the custom
 * registries before the built-in pi-ai registry. Returns null when unresolved.
 */
export function resolvePiAiModel(piAiProvider: string, piAiModelId: string): PiAiModel<any> | null {
  // Config may not be loaded in some unit contexts; degrade to registry-only.
  let cfg: ReturnType<typeof getConfig> | undefined;
  try {
    cfg = getConfig();
  } catch {
    cfg = undefined;
  }
  const customModels = (cfg as any)?.pi_ai_custom_models as
    | Record<string, PiAiCustomModel>
    | undefined;
  const customProviders = (cfg as any)?.pi_ai_custom_providers as
    | Record<string, PiAiCustomProvider>
    | undefined;

  // 1. Custom model definition. A model is provider-scoped: it only matches
  //    when its `provider` field equals the referencing pi-ai provider.
  const modelSpec = customModels?.[piAiModelId];
  if (modelSpec && modelSpec.provider === piAiProvider) {
    const resolved = resolveCustomModel(modelSpec, piAiProvider, piAiModelId);
    if (resolved) {
      // A custom provider may still override the wire api/compat.
      return applyCustomProvider(resolved, customProviders?.[piAiProvider]);
    }
    return null;
  }

  // 2. Custom provider with a registry/base model.
  const providerSpec = customProviders?.[piAiProvider];
  if (providerSpec) {
    // The base model still has to be a known registry model id (the custom
    // provider only supplies api/compat, not the model's token/cost metadata).
    // We try the registry under any known provider that owns this model id by
    // using the spec.api as the wire; if not found, build a skeleton.
    const builtinProvider = API_TO_BUILTIN_PROVIDER[providerSpec.api] ?? 'openai';
    const base =
      safeGetModel(builtinProvider, piAiModelId) ??
      emptyModelSkeleton(piAiModelId, piAiProvider, providerSpec.api);
    return applyCustomProvider({ ...base, id: piAiModelId, provider: piAiProvider }, providerSpec);
  }

  // 3. Built-in registry.
  return safeGetModel(piAiProvider, piAiModelId);
}

function applyCustomProvider(
  model: PiAiModel<any>,
  providerSpec: PiAiCustomProvider | undefined
): PiAiModel<any> {
  if (!providerSpec) return model;
  const merged: any = { ...model, api: providerSpec.api };
  if (providerSpec.compat) {
    merged.compat = deepMerge((model as any).compat ?? {}, providerSpec.compat);
  }
  return merged;
}

// ─── buildPiAiModel ───────────────────────────────────────────────────────────
//
// Resolves a pi-ai Model (registry or custom) and applies the baseUrl override
// from the Plexus provider config. Returns null when the model cannot be
// resolved (caller fails the candidate). Base URL resolution keys off the
// *upstream* pi-ai API (piModel.api), not the client-facing route type.

export function buildPiAiModel(
  providerConfig: Pick<ProviderConfig, 'api_base_url'>,
  piAiProvider: string,
  piAiModelId: string,
  incomingApiType?: string
): PiAiModel<any> | null {
  const piModel = resolvePiAiModel(piAiProvider, piAiModelId);
  if (!piModel) return null;
  const baseUrl = resolveBaseUrl(providerConfig.api_base_url, piModel.api, incomingApiType);
  return { ...piModel, baseUrl };
}

// ─── Energy helpers ───────────────────────────────────────────────────────────

/**
 * Build GPU params from a route's provider config, falling back to defaults.
 * Mirrors the same logic used in the Dispatcher and management config routes.
 */
export function buildGpuParams(routeConfig: RouteResult['config']) {
  return {
    ram_gb: (routeConfig as any).gpu_ram_gb ?? DEFAULT_GPU_PARAMS.ram_gb,
    bandwidth_tb_s: (routeConfig as any).gpu_bandwidth_tb_s ?? DEFAULT_GPU_PARAMS.bandwidth_tb_s,
    flops_tflop: (routeConfig as any).gpu_flops_tflop ?? DEFAULT_GPU_PARAMS.flops_tflop,
    power_draw_watts:
      (routeConfig as any).gpu_power_draw_watts ?? DEFAULT_GPU_PARAMS.power_draw_watts,
  };
}

/**
 * Estimate kWh used for a request given token counts and route metadata.
 * Returns null when no model architecture is configured for the route.
 */
export function computeKwhUsed(
  tokensInput: number,
  tokensOutput: number,
  route: RouteResult
): number | null {
  if (!route.modelArchitecture) return null;
  const gpuParams = buildGpuParams(route.config);
  const modelParams = resolveModelParams(route.modelArchitecture);
  const kwh = estimateKwhUsed(tokensInput, tokensOutput, modelParams, gpuParams);
  return kwh > 0 ? kwh : null;
}
