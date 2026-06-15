/**
 * Shared pi-ai utilities for the beta inference path.
 *
 * This module owns:
 *  - buildThinkingOptions: per-provider reasoning option construction (moved from oauth-transformer.ts)
 *  - resolveBaseUrl: resolve api_base_url union and apply SDK-specific stripping rules
 *  - buildReasoningOptions: wrap buildThinkingOptions with explicit-disable defaults
 *  - buildPiAiModel: construct a call-ready pi-ai Model with base URL override applied
 */

import { getModel } from '@earendil-works/pi-ai';
import type { Model as PiAiModel } from '@earendil-works/pi-ai';
import type { ProviderConfig } from '../../config';
import type { RouteResult } from '../../services/router';
import { estimateKwhUsed } from '../../services/inference-energy';
import { resolveModelParams, DEFAULT_GPU_PARAMS } from '@plexus/shared';

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

// ─── buildPiAiModel ───────────────────────────────────────────────────────────
//
// Wraps getModel() and applies the baseUrl override from the Plexus provider
// config. Returns a shallow copy of the pi-ai Model with `baseUrl` set to the
// resolved configured URL.
//
// Base URL resolution keys off the *upstream* pi-ai API (piModel.api), not
// the client-facing route type. The `incomingApiType` param is kept for
// context but must not be the primary key for upstream base URL selection.

export function buildPiAiModel(
  providerConfig: Pick<ProviderConfig, 'api_base_url'>,
  piAiProvider: string,
  piAiModelId: string,
  incomingApiType?: string
): PiAiModel<any> {
  const piModel = getModel(piAiProvider as any, piAiModelId as any);
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
