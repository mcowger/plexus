/**
 * Canonical reasoning/thinking intent for pi-ai registry compatibility.
 *
 * Every inbound protocol (OpenAI chat, Anthropic messages, OpenAI Responses,
 * Gemini) expresses "how much should the model think" differently:
 *
 *   - OpenAI chat / Responses : reasoning_effort | reasoning.effort  (effort string)
 *   - Anthropic               : thinking.budget_tokens               (token budget)
 *   - Gemini                  : thinkingConfig.thinkingLevel | thinkingBudget
 *
 * Rather than collapse all of these to a single lossy effort string at ingress
 * (the old behaviour), each parser produces a `ReasoningIntent` that preserves
 * the *richest* signal the client gave us:
 *
 *   - `effort`       : a normalized effort bucket, when the client spoke in buckets
 *   - `budgetTokens` : the raw token budget, when the client spoke in tokens
 *   - `enabled`      : tri-state. true = explicitly on, false = explicitly off,
 *                      undefined = client said nothing → use the model default
 *   - `summary`      : whether the client asked for a reasoning summary
 *   - `source`       : provenance, for debugging / policy resolution
 *
 * The egress side (`registry.ts`) consumes this intent together with the
 * resolved pi-ai model's capabilities to produce the correct per-provider
 * request options. Preserving `budgetTokens` lets us round-trip the client's
 * exact budget when the ingress and egress families match (e.g. Anthropic →
 * Anthropic), instead of re-quantizing through a coarse bucket.
 */

/** pi-ai's thinking vocabulary. "off" means thinking disabled. */
export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

/**
 * Unified reasoning-output visibility, normalized across protocols:
 *   - 'hidden'  → do not surface thinking (or client didn't ask)
 *   - 'summary' → surface a summarized form of the reasoning
 *   - 'full'    → surface raw reasoning where the provider allows it
 *
 * Maps from: OpenAI Responses `reasoning.summary`, Gemini
 * `thinkingConfig.includeThoughts`, Anthropic `thinking` display semantics.
 */
export type ReasoningVisibility = 'hidden' | 'summary' | 'full';

export interface ReasoningIntent {
  /** Normalized effort bucket, when known. */
  effort?: ReasoningEffort;
  /** Raw token budget the client supplied, when known. Preserved for round-trip fidelity. */
  budgetTokens?: number;
  /**
   * Tri-state thinking switch:
   *   true      → client explicitly enabled thinking
   *   false     → client explicitly disabled thinking
   *   undefined → client said nothing; defer to the model's native default
   */
  enabled?: boolean;
  /**
   * Adaptive thinking: the client enabled reasoning but did NOT commit to a
   * magnitude — the model decides how much to think (Anthropic
   * `thinking.type: 'adaptive'`, the only mode on Claude 5+).
   *
   * On a native adaptive-thinking Anthropic egress this is passed through as
   * `thinkingEnabled: true` with no `effort`, so the model chooses. On egress
   * families that cannot express "let the model decide" (OpenAI-completions /
   * OpenRouter, Gemini, legacy budget-based Anthropic) it resolves to the
   * documented adaptive default effort via {@link intentToEffort}.
   */
  adaptive?: boolean;
  /** Unified reasoning-output visibility (summary / full / hidden). */
  visibility?: ReasoningVisibility;
  /**
   * OpenAI-specific summary granularity (`auto` | `concise` | `detailed`),
   * preserved verbatim so an OpenAI→OpenAI route keeps the exact value.
   */
  summaryDetail?: string;
  /** Where this intent came from. */
  source: 'client' | 'header' | 'key' | 'alias' | 'default';
}

/**
 * Ordered effort ladder, lowest → highest. Mirrors pi-ai's EXTENDED_THINKING
 * levels minus "off" (which is represented by `enabled: false`).
 */
export const EFFORT_LADDER: readonly ReasoningEffort[] = [
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
] as const;

/**
 * Single source of truth mapping an effort bucket → a representative token
 * budget. Used when an effort-only client routes to a budget-based provider
 * (e.g. Gemini 2.x). Kept as the exact inverse of {@link budgetToEffort} so
 * round-tripping a value through both is stable.
 */
const EFFORT_TO_BUDGET: Record<ReasoningEffort, number> = {
  minimal: 1024,
  low: 2048,
  medium: 8192,
  high: 16384,
  xhigh: 32768,
};

export function effortToBudget(effort: ReasoningEffort): number {
  return EFFORT_TO_BUDGET[effort] ?? EFFORT_TO_BUDGET.high;
}

/**
 * Map a raw token budget → an effort bucket. Replaces the two divergent
 * threshold tables that previously lived in `transformers/utils.ts`
 * (`getThinkLevel`) and `gemini-to-context.ts`.
 *
 * A budget <= 0 means "disable thinking" and returns `'off'`.
 */
export function budgetToEffort(budget: number): ReasoningEffort | 'off' {
  if (budget <= 0) return 'off';
  if (budget <= 1024) return 'minimal';
  if (budget <= 2048) return 'low';
  if (budget <= 8192) return 'medium';
  if (budget <= 16384) return 'high';
  return 'xhigh';
}

/** Normalize an arbitrary client effort string to our vocabulary, if possible. */
export function normalizeEffort(raw: unknown): ReasoningEffort | 'off' | undefined {
  if (typeof raw !== 'string') return undefined;
  const v = raw.trim().toLowerCase();
  switch (v) {
    case 'none':
    case 'off':
    case 'disabled':
      return 'off';
    case 'minimal':
      return 'minimal';
    case 'low':
      return 'low';
    case 'medium':
      return 'medium';
    case 'high':
      return 'high';
    case 'xhigh':
    case 'max':
    case 'maximum':
      return 'xhigh';
    default:
      return undefined;
  }
}

/**
 * Normalize a client-supplied visibility expression to our vocabulary.
 * Accepts OpenAI summary strings, Anthropic display strings, and booleans.
 */
export function normalizeVisibility(raw: unknown): ReasoningVisibility | undefined {
  if (raw === true) return 'summary';
  if (raw === false) return 'hidden';
  if (typeof raw !== 'string') return undefined;
  const v = raw.trim().toLowerCase();
  switch (v) {
    case 'hidden':
    case 'none':
    case 'off':
      return 'hidden';
    case 'summary':
    case 'summarized':
    case 'concise':
    case 'detailed':
    case 'auto':
      return 'summary';
    case 'full':
    case 'raw':
    case 'all':
      return 'full';
    default:
      return undefined;
  }
}

/** Clamp an effort to a [floor, ceiling] window on the effort ladder. */
export function clampEffortToWindow(
  effort: ReasoningEffort,
  floor?: ReasoningEffort,
  ceiling?: ReasoningEffort
): ReasoningEffort {
  let idx = EFFORT_LADDER.indexOf(effort);
  if (idx === -1) return effort;
  if (floor) {
    const f = EFFORT_LADDER.indexOf(floor);
    if (f > idx) idx = f;
  }
  if (ceiling) {
    const c = EFFORT_LADDER.indexOf(ceiling);
    if (c !== -1 && c < idx) idx = c;
  }
  return EFFORT_LADDER[idx] ?? effort;
}

/**
 * Default effort for adaptive thinking when it must be flattened to a concrete
 * bucket (egress families that cannot express "let the model decide"). Matches
 * the documented adaptive default, e.g. OpenRouter Claude 5: "adaptive thinking
 * on at effort high".
 */
export const ADAPTIVE_DEFAULT_EFFORT: ReasoningEffort = 'high';

/**
 * Resolve a ReasoningIntent to a concrete effort bucket (or 'off'), using
 * `budgetTokens` when no explicit `effort` was given.
 */
export function intentToEffort(intent: ReasoningIntent): ReasoningEffort | 'off' | undefined {
  if (intent.enabled === false) return 'off';
  if (intent.effort) return intent.effort;
  if (intent.budgetTokens != null) return budgetToEffort(intent.budgetTokens);
  // Adaptive: model-decides-magnitude, flattened to the documented default for
  // egress paths that require a concrete effort.
  if (intent.adaptive) return ADAPTIVE_DEFAULT_EFFORT;
  if (intent.enabled === true) return 'medium'; // enabled but unspecified magnitude
  return undefined;
}

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
