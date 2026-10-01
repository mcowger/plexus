/**
 * Pure auto-routing policy slice: composes a validated judgment into a demand
 * and required tier, checks capability suitability, scores preferences, prices
 * cache economics, and returns one deterministic candidate ordering.
 *
 * No I/O and no classifier calls. Config/profile types come from
 * `@plexus/shared`; the remaining types are this policy's integration boundary.
 */

import {
  AUTO_CAPABILITY_TIERS,
  AUTO_TASK_KINDS,
  DEFAULT_AUTO_ROUTING_CONFIG,
  DEFAULT_AUTO_ROUTING_PREFERENCES,
  DEFAULT_AUTO_ROUTING_SCORING,
  DEFAULT_AUTO_ROUTING_SWITCHING,
} from '@plexus/shared';
import type {
  AutoCapabilityTier,
  AutoReasoningSuitability,
  AutoRoutingConfig,
  AutoRoutingPreferences,
  AutoRoutingScoring,
  AutoRoutingSwitching,
  AutoTargetProfile,
  AutoTaskKind,
} from '@plexus/shared';

export { AUTO_CAPABILITY_TIERS, AUTO_TASK_KINDS };
export type {
  AutoCapabilityTier,
  AutoReasoningSuitability,
  AutoRoutingConfig,
  AutoRoutingPreferences,
  AutoRoutingScoring,
  AutoRoutingSwitching,
  AutoTargetProfile,
  AutoTaskKind,
};

export type AutoTierBoundaries = AutoRoutingScoring['tier_boundaries'];

export interface ResolvedAutoPolicyConfig {
  baseline_policy: 'in_order' | 'cost';
  uncertainty_minimum_tier: AutoCapabilityTier;
  scoring: AutoRoutingScoring;
  preferences: AutoRoutingPreferences;
  switching: AutoRoutingSwitching;
}

/** Fill optional/partial policy config with the documented v1 defaults. */
export function resolveAutoPolicyConfig(
  config?: Partial<AutoRoutingConfig>
): ResolvedAutoPolicyConfig {
  const provided = config ?? {};
  return {
    baseline_policy: provided.baseline_policy ?? DEFAULT_AUTO_ROUTING_CONFIG.baseline_policy,
    uncertainty_minimum_tier:
      provided.uncertainty_minimum_tier ?? DEFAULT_AUTO_ROUTING_CONFIG.uncertainty_minimum_tier,
    scoring: {
      ...DEFAULT_AUTO_ROUTING_SCORING,
      ...provided.scoring,
      tier_boundaries: {
        ...DEFAULT_AUTO_ROUTING_SCORING.tier_boundaries,
        ...provided.scoring?.tier_boundaries,
      },
      // A supplied `task_minimum_tiers` (including `{}`) replaces the defaults
      // rather than merging with them, so an admin can disable task floors.
      task_minimum_tiers:
        provided.scoring?.task_minimum_tiers ?? DEFAULT_AUTO_ROUTING_SCORING.task_minimum_tiers,
    },
    preferences: { ...DEFAULT_AUTO_ROUTING_PREFERENCES, ...provided.preferences },
    switching: { ...DEFAULT_AUTO_ROUTING_SWITCHING, ...provided.switching },
  };
}

export interface AutoJudgment {
  task_kind: AutoTaskKind | 'unknown';
  /** 0–3 rubric. */
  complexity: number;
  /** 0–3 rubric, ignoring price. */
  capability_required: number;
  /** 0–1 normalized noul likelihood. */
  deep_reasoning: number;
  /** Optional, uncalibrated 0–1 confidence. Missing is neutral. */
  confidence?: number;
}

/** Normalized marginal rates, USD per 1,000,000 tokens. Undefined cache rates mean unknown, never zero. */
export interface AutoNormalizedRates {
  inputPerMillion: number;
  outputPerMillion: number;
  cacheReadPerMillion?: number;
  cacheWritePerMillion?: number;
}

export interface AutoRawPriceRange {
  lower_bound?: number;
  upper_bound?: number | null;
  input_per_m: number;
  output_per_m: number;
  cached_per_m?: number;
  cache_write_per_m?: number;
}

export type AutoPricingSource =
  | {
      source: 'simple';
      input: number;
      output: number;
      cached?: number;
      cache_write?: number;
      discount?: number;
    }
  | { source: 'defined'; range: AutoRawPriceRange[]; discount?: number }
  | { source: 'per_request'; amount: number }
  | { source: 'openrouter'; slug: string; discount?: number };

/** Either already-normalized rates or an existing Plexus pricing object. */
export type AutoPricingInput = AutoNormalizedRates | AutoPricingSource | null | undefined;

export type AutoPricingSourceKind =
  | 'normalized'
  | 'simple'
  | 'defined'
  | 'per_request'
  | 'openrouter'
  | 'none';

export interface AutoResolvedPricing {
  /** Null when token rates cannot be resolved (e.g. unresolved OpenRouter slug). */
  rates: AutoNormalizedRates | null;
  /** Null when the request fee is unknown. */
  requestFeeUsd: number | null;
  source: AutoPricingSourceKind;
}

function isNormalizedRates(pricing: AutoPricingInput): pricing is AutoNormalizedRates {
  return (
    !!pricing &&
    typeof pricing === 'object' &&
    !('source' in pricing) &&
    'inputPerMillion' in pricing &&
    'outputPerMillion' in pricing
  );
}

/**
 * calculate-costs applies `1 - discount` and lets a per-pricing discount win
 * over the provider-level fallback. Zero is a real discount value, so only a
 * nullish discount falls through to the provider default.
 */
function autoDiscountMultiplier(
  discount: number | undefined,
  providerDiscount: number | undefined
): number {
  const effective = discount ?? providerDiscount;
  return effective ? 1 - effective : 1;
}

/**
 * Resolve pricing for a request whose normalized uncached input is
 * `uncachedInputTokens`. Defined context ranges match that normalized count,
 * matching calculate-costs' post-normalization `tokensInput`. Discounts use the
 * calculate-costs `1 - discount` convention, with a per-pricing discount
 * overriding the provider default. OpenRouter slugs need the catalog and must be
 * pre-resolved by the caller; null rates mean unknown, never free.
 */
export function resolveAutoPricing(
  pricing: AutoPricingInput,
  uncachedInputTokens: number,
  providerDiscount?: number
): AutoResolvedPricing {
  if (!pricing) return { rates: null, requestFeeUsd: null, source: 'none' };
  if (isNormalizedRates(pricing)) {
    return { rates: pricing, requestFeeUsd: 0, source: 'normalized' };
  }

  switch (pricing.source) {
    case 'simple': {
      const multiplier = autoDiscountMultiplier(pricing.discount, providerDiscount);
      return {
        rates: {
          inputPerMillion: pricing.input * multiplier,
          outputPerMillion: pricing.output * multiplier,
          cacheReadPerMillion:
            pricing.cached === undefined ? undefined : pricing.cached * multiplier,
          cacheWritePerMillion:
            pricing.cache_write === undefined ? undefined : pricing.cache_write * multiplier,
        },
        requestFeeUsd: 0,
        source: 'simple',
      };
    }
    case 'defined': {
      const upper = (r: AutoRawPriceRange) => r.upper_bound ?? Infinity;
      const match = pricing.range.find(
        (r) => uncachedInputTokens >= (r.lower_bound ?? 0) && uncachedInputTokens <= upper(r)
      );
      if (!match) return { rates: null, requestFeeUsd: 0, source: 'defined' };
      const multiplier = autoDiscountMultiplier(pricing.discount, providerDiscount);
      return {
        rates: {
          inputPerMillion: match.input_per_m * multiplier,
          outputPerMillion: match.output_per_m * multiplier,
          cacheReadPerMillion:
            match.cached_per_m === undefined ? undefined : match.cached_per_m * multiplier,
          cacheWritePerMillion:
            match.cache_write_per_m === undefined
              ? undefined
              : match.cache_write_per_m * multiplier,
        },
        requestFeeUsd: 0,
        source: 'defined',
      };
    }
    case 'per_request':
      return {
        rates: {
          inputPerMillion: 0,
          outputPerMillion: 0,
          cacheReadPerMillion: 0,
          cacheWritePerMillion: 0,
        },
        requestFeeUsd: pricing.amount,
        source: 'per_request',
      };
    case 'openrouter':
      return { rates: null, requestFeeUsd: null, source: 'openrouter' };
  }
}

export interface AutoWarmthObservation {
  /** Provider-reported cached-read input tokens from a prior dispatch. */
  cachedInputTokens: number;
  /** Provider-reported cache-write input tokens from a prior dispatch. */
  cacheWriteTokens: number;
  /** Effective wire-prefix fingerprint; a mismatch invalidates the warmth. */
  prefixFingerprint?: string;
  /** Epoch ms after which this observation must not be treated as warmth. */
  expiresAt?: number;
  /** Monotonic dispatch sequence, used to reject late completions. */
  sequence?: number;
}

export interface AutoPolicyContext {
  judgment?: AutoJudgment;
  incumbentId?: string;
  previousDemand?: number;
  previousRequiredTier?: AutoCapabilityTier | number;
  /** Hard protocol continuation. Wins over every other policy input. */
  continuationLocked?: boolean;
  inputTokens: number;
  /** Predicted output tokens. Missing means output cost is unknown. */
  expectedOutputTokens?: number;
  /**
   * Plausible output-token bounds for cost uncertainty. `lower`/`upper` bound
   * the output charge in `lowerUsd`/`upperUsd`; `expectedOutputTokens` still
   * supplies the point estimate.
   */
  outputTokenRange?: { lower: number; upper: number };
  observations?: Record<string, AutoWarmthObservation>;
  prefixFingerprint?: string;
  /** Injectable clock for tests. Defaults to Date.now(). */
  now?: number;
}

export interface AutoPolicyCandidate {
  id: string;
  profile: AutoTargetProfile;
  provider: string;
  model: string;
  pricing?: AutoPricingInput;
  /** Provider-level discount fallback used when pricing omits its own. */
  providerDiscount?: number;
}

export type AutoWarmth = 'warm' | 'cold' | 'uncertain';

export interface AutoCostEstimate {
  candidateId: string;
  /** True only when every billed category has a known rate/fee. */
  known: boolean;
  expectedUsd: number | null;
  lowerUsd: number | null;
  upperUsd: number | null;
  warmth: AutoWarmth;
  uncachedInputTokens: number;
  cacheReadInputTokens: number;
  cacheWriteInputTokens: number;
  outputTokens: number | null;
  pricingSource: AutoPricingSourceKind;
}

export type AutoExclusion =
  | 'capability_below_required'
  | 'below_uncertainty_floor'
  | 'continuation_target_not_eligible';

export interface AutoCandidateRanking {
  id: string;
  provider: string;
  model: string;
  capabilityTier: AutoCapabilityTier;
  capabilityRank: number;
  suitable: boolean;
  exclusion: AutoExclusion | null;
  /** Null outside the confident scoring path. */
  preference: number | null;
  specialtyMatch: boolean;
  reasoningPreferred: boolean;
  /** Within preference_margin of the best preference. */
  comparable: boolean;
  /** Cost known and warmth not uncertain; required for economic override. */
  economicallyComparable: boolean;
}

export type AutoDecisionReason =
  | 'no_candidates'
  | 'continuation_locked'
  | 'continuation_target_unavailable'
  | 'quality_upgrade'
  | 'incumbent_unavailable'
  | 'economic_switch'
  | 'cache_hold'
  | 'specialist_switch'
  | 'preference_switch'
  | 'uncertain_incumbent_hold'
  | 'uncertain_baseline'
  | 'no_suitable_target_first_option'
  | 'cold_start';

export interface AutoDecision {
  reason: AutoDecisionReason;
  chosenId: string | null;
  incumbentId: string | null;
  continuationLocked: boolean;
  continuationTargetUnavailable: boolean;
  /** True for the explicit first-eligible-option exception. */
  fallback: boolean;
  uncertainty: boolean;
  upgrade: boolean;
  downgrade: boolean;
  scoreDeadbandCleared: boolean;
}

export interface AutoRankingResult {
  orderedIds: string[];
  decision: AutoDecision;
  demand: number | null;
  requiredTier: number | null;
  rankings: AutoCandidateRanking[];
  costEvidence: Record<string, AutoCostEstimate>;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isFiniteInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

/** Parse/validate a judgment. Returns null for malformed output (never substitutes). */
export function validateAutoJudgment(judgment: AutoJudgment | undefined): AutoJudgment | null {
  if (!judgment) return null;
  const taskKind = judgment.task_kind;
  const knownKind =
    taskKind === 'unknown' || (AUTO_TASK_KINDS as readonly string[]).includes(taskKind);
  if (!knownKind) return null;
  if (!isFiniteInRange(judgment.complexity, 0, 3)) return null;
  if (!isFiniteInRange(judgment.capability_required, 0, 3)) return null;
  if (!isFiniteInRange(judgment.deep_reasoning, 0, 1)) return null;
  if (judgment.confidence !== undefined && !isFiniteInRange(judgment.confidence, 0, 1)) {
    return null;
  }
  return judgment;
}

/** Profile capability with a safe ordinal. Missing qualification is economy. */
export function autoProfileCapability(profile: AutoTargetProfile): AutoCapabilityTier {
  return profile.capability ?? 'economy';
}

export function autoTierRank(tier: AutoCapabilityTier | number): number {
  if (typeof tier === 'number') return clamp(Math.round(tier), 0, AUTO_CAPABILITY_TIERS.length - 1);
  const index = AUTO_CAPABILITY_TIERS.indexOf(tier);
  return index < 0 ? 0 : index;
}

/** Tier selected by the configured boundaries. Equality advances to the higher tier. */
export function autoTierForDemand(
  demand: number,
  boundaries: AutoTierBoundaries
): AutoCapabilityTier {
  if (demand >= boundaries.premium) return 'premium';
  if (demand >= boundaries.high) return 'high';
  if (demand >= boundaries.standard) return 'standard';
  return 'economy';
}

function lowerBoundaryOfTier(rank: number, boundaries: AutoTierBoundaries): number {
  switch (rank) {
    case 3:
      return boundaries.premium;
    case 2:
      return boundaries.high;
    case 1:
      return boundaries.standard;
    default:
      return 0;
  }
}

/** Pure demand composition, shared by production and preview. */
export function composeAutoDemand(judgment: AutoJudgment, scoring: AutoRoutingScoring): number {
  const reasoning =
    judgment.deep_reasoning >= scoring.reasoning_threshold ? scoring.reasoning_boost : 0;
  return clamp(
    scoring.complexity_weight * judgment.complexity +
      scoring.capability_weight * judgment.capability_required +
      reasoning,
    0,
    3
  );
}

export function computeAutoRequiredTier(
  judgment: AutoJudgment,
  scoring: AutoRoutingScoring
): { demand: number; scoredTier: AutoCapabilityTier; requiredTier: AutoCapabilityTier } {
  const demand = composeAutoDemand(judgment, scoring);
  const scoredTier = autoTierForDemand(demand, scoring.tier_boundaries);
  const taskKind = judgment.task_kind;
  const floor =
    taskKind === 'unknown' ? undefined : (scoring.task_minimum_tiers?.[taskKind] ?? undefined);
  const requiredTier =
    floor !== undefined && autoTierRank(floor) > autoTierRank(scoredTier) ? floor : scoredTier;
  return { demand, scoredTier, requiredTier };
}

function preferenceFor(
  candidate: AutoPolicyCandidate,
  requiredTierRank: number,
  specialtyMatch: boolean,
  reasoningPreferred: boolean,
  preferences: AutoRoutingPreferences
): number {
  const capabilityRank = autoTierRank(autoProfileCapability(candidate.profile));
  const base = 1 - (capabilityRank - requiredTierRank) / 3;
  const specialty = specialtyMatch ? preferences.specialty_bonus : 0;
  const reasoning = reasoningPreferred ? preferences.reasoning_bonus : 0;
  // Normalize bonuses against their own maximum so a same-tier candidate with
  // the best qualification signal lands at 1 while a generalist keeps headroom
  // below it. Clamping a raw `base + bonuses` saturates every same-tier
  // candidate at 1 and erases specialty/reasoning differentiation entirely.
  return clamp(
    (base + specialty + reasoning) /
      (1 + preferences.specialty_bonus + preferences.reasoning_bonus),
    0,
    1
  );
}

function deriveWarmth(candidateId: string, context: AutoPolicyContext): AutoWarmth {
  const observation = context.observations?.[candidateId];
  if (!observation) return 'cold';
  const now = context.now ?? Date.now();
  if (observation.expiresAt !== undefined && now > observation.expiresAt) return 'cold';
  if (context.prefixFingerprint == null || observation.prefixFingerprint == null) {
    return 'uncertain';
  }
  return observation.prefixFingerprint === context.prefixFingerprint ? 'warm' : 'cold';
}

/** Estimate a single candidate's current-request cost. Pure. */
export function estimateAutoCandidateCost(
  candidate: AutoPolicyCandidate,
  context: AutoPolicyContext
): AutoCostEstimate {
  const inputTokens = Math.max(0, context.inputTokens);
  const outputTokens =
    context.expectedOutputTokens !== undefined &&
    Number.isFinite(context.expectedOutputTokens) &&
    context.expectedOutputTokens >= 0
      ? context.expectedOutputTokens
      : null;

  const warmth = deriveWarmth(candidate.id, context);
  const observation = context.observations?.[candidate.id];
  let cacheReadInputTokens = 0;
  let cacheWriteInputTokens = 0;
  if (warmth === 'warm' && observation) {
    // A prior request's cache writes are now reusable prefix, so they are reads
    // on this request rather than fresh writes. Never double-count the two.
    cacheReadInputTokens = clamp(
      observation.cachedInputTokens + observation.cacheWriteTokens,
      0,
      inputTokens
    );
  }
  const uncachedInputTokens = Math.max(
    0,
    inputTokens - cacheReadInputTokens - cacheWriteInputTokens
  );

  const resolved = resolveAutoPricing(
    candidate.pricing,
    uncachedInputTokens,
    candidate.providerDiscount
  );
  const base: AutoCostEstimate = {
    candidateId: candidate.id,
    known: false,
    expectedUsd: null,
    lowerUsd: null,
    upperUsd: null,
    warmth,
    uncachedInputTokens,
    cacheReadInputTokens,
    cacheWriteInputTokens,
    outputTokens,
    pricingSource: resolved.source,
  };

  const rates = resolved.rates;
  if (
    !rates ||
    !Number.isFinite(rates.inputPerMillion) ||
    !Number.isFinite(rates.outputPerMillion)
  ) {
    return base;
  }

  // Output bounds come from the explicit range when supplied, otherwise the
  // single point estimate bounds both ends. Without either, cost is unknown.
  const rangeLower =
    context.outputTokenRange && Number.isFinite(context.outputTokenRange.lower)
      ? Math.max(0, context.outputTokenRange.lower)
      : undefined;
  const rangeUpper =
    context.outputTokenRange && Number.isFinite(context.outputTokenRange.upper)
      ? Math.max(0, context.outputTokenRange.upper)
      : undefined;
  const outputLowerTokens = rangeLower ?? outputTokens;
  const outputUpperTokens = rangeUpper ?? outputTokens;
  if (outputLowerTokens === null || outputUpperTokens === null) return base;

  const inputRate = rates.inputPerMillion;
  const outputRate = rates.outputPerMillion;
  const knownCacheRead =
    cacheReadInputTokens === 0 ||
    (rates.cacheReadPerMillion !== undefined && Number.isFinite(rates.cacheReadPerMillion));
  const knownCacheWrite =
    cacheWriteInputTokens === 0 ||
    (rates.cacheWritePerMillion !== undefined && Number.isFinite(rates.cacheWritePerMillion));
  const knownFee = resolved.requestFeeUsd !== null && Number.isFinite(resolved.requestFeeUsd);
  const fee = knownFee ? (resolved.requestFeeUsd as number) : 0;

  const cacheReadPoint = rates.cacheReadPerMillion ?? inputRate;
  const cacheWritePoint = rates.cacheWritePerMillion ?? inputRate;
  const cacheReadLower = knownCacheRead ? (rates.cacheReadPerMillion ?? 0) : 0;
  const cacheWriteLower = knownCacheWrite ? (rates.cacheWritePerMillion ?? 0) : 0;

  const tokenCost = (outputCount: number) =>
    (uncachedInputTokens * inputRate + outputCount * outputRate) / 1_000_000;
  const lowerUsd =
    tokenCost(outputLowerTokens) +
    (cacheReadInputTokens * cacheReadLower + cacheWriteInputTokens * cacheWriteLower) / 1_000_000 +
    fee;
  const upperUsd =
    tokenCost(outputUpperTokens) +
    (cacheReadInputTokens * cacheReadPoint + cacheWriteInputTokens * cacheWritePoint) / 1_000_000 +
    fee;
  // A point estimate is only known when the caller supplied expected output
  // tokens. A range alone yields bounds but no economic override.
  const expectedUsd =
    outputTokens === null
      ? null
      : tokenCost(outputTokens) +
        (cacheReadInputTokens * cacheReadPoint + cacheWriteInputTokens * cacheWritePoint) /
          1_000_000 +
        fee;

  return {
    ...base,
    known: knownCacheRead && knownCacheWrite && knownFee && outputTokens !== null,
    expectedUsd,
    lowerUsd,
    upperUsd,
  };
}

function baselineOrder(
  ids: string[],
  policy: 'in_order' | 'cost',
  declarationIndex: Map<string, number>,
  costEvidence: Record<string, AutoCostEstimate>
): string[] {
  if (policy !== 'cost') return [...ids];
  return [...ids].sort((a, b) => {
    const ca = costEvidence[a]!;
    const cb = costEvidence[b]!;
    const ea = ca.known && ca.expectedUsd !== null ? ca.expectedUsd : Infinity;
    const eb = cb.known && cb.expectedUsd !== null ? cb.expectedUsd : Infinity;
    if (ea !== eb) return ea - eb;
    return (declarationIndex.get(a) ?? 0) - (declarationIndex.get(b) ?? 0);
  });
}

function orderRemainingSuitable(
  suitableIds: string[],
  chosenId: string,
  preferenceById: Map<string, number>,
  declarationIndex: Map<string, number>,
  costEvidence: Record<string, AutoCostEstimate>
): string[] {
  const rest = suitableIds.filter((id) => id !== chosenId);
  rest.sort((a, b) => {
    const pa = preferenceById.get(a) ?? 0;
    const pb = preferenceById.get(b) ?? 0;
    if (pa !== pb) return pb - pa;
    const ea = costEvidence[a]!.known ? (costEvidence[a]!.expectedUsd ?? Infinity) : Infinity;
    const eb = costEvidence[b]!.known ? (costEvidence[b]!.expectedUsd ?? Infinity) : Infinity;
    if (ea !== eb) return ea - eb;
    return (declarationIndex.get(a) ?? 0) - (declarationIndex.get(b) ?? 0);
  });
  return [chosenId, ...rest];
}

function chooseColdTarget(
  bandIds: string[],
  preferenceById: Map<string, number>,
  declarationIndex: Map<string, number>,
  costEvidence: Record<string, AutoCostEstimate>
): string {
  const allKnown = bandIds.every((id) => {
    const cost = costEvidence[id]!;
    return (
      cost.known && cost.expectedUsd !== null && cost.lowerUsd !== null && cost.upperUsd !== null
    );
  });
  if (allKnown && bandIds.length > 0) {
    const byExpected = [...bandIds].sort((a, b) => {
      const ea = costEvidence[a]!.expectedUsd as number;
      const eb = costEvidence[b]!.expectedUsd as number;
      if (ea !== eb) return ea - eb;
      return (declarationIndex.get(a) ?? 0) - (declarationIndex.get(b) ?? 0);
    });
    const cheapest = byExpected[0]!;
    const cheapestUpper = costEvidence[cheapest]!.upperUsd as number;
    const strictlyCheapest = bandIds
      .filter((id) => id !== cheapest)
      .every((id) => (costEvidence[id]!.lowerUsd as number) > cheapestUpper);
    if (strictlyCheapest) return cheapest;
  }
  // Missing/overlapping prices: descending preference then declaration order.
  const byPreference = [...bandIds].sort((a, b) => {
    const pa = preferenceById.get(a) ?? 0;
    const pb = preferenceById.get(b) ?? 0;
    if (pa !== pb) return pb - pa;
    return (declarationIndex.get(a) ?? 0) - (declarationIndex.get(b) ?? 0);
  });
  return byPreference[0]!;
}

function economicSwitchCandidate(params: {
  incumbentId: string;
  bandIds: string[];
  config: ResolvedAutoPolicyConfig;
  declarationIndex: Map<string, number>;
  costEvidence: Record<string, AutoCostEstimate>;
}): string | null {
  const { incumbentId, bandIds, config, declarationIndex, costEvidence } = params;
  const incumbent = costEvidence[incumbentId]!;
  if (!incumbent || !incumbent.known || incumbent.expectedUsd === null) return null;
  if (incumbent.warmth === 'uncertain') return null;
  if (incumbent.lowerUsd === null || incumbent.expectedUsd <= 0) return null;

  let best: string | null = null;
  let bestExpected = Infinity;
  for (const id of bandIds) {
    if (id === incumbentId) continue;
    const candidate = costEvidence[id]!;
    if (!candidate.known || candidate.expectedUsd === null) continue;
    if (candidate.warmth === 'uncertain') continue;
    if (candidate.lowerUsd === null || candidate.upperUsd === null) continue;
    if (!(candidate.upperUsd < incumbent.lowerUsd)) continue;

    const savings = incumbent.expectedUsd - candidate.expectedUsd;
    if (!(savings > config.switching.minimum_savings_usd)) continue;
    if (!(savings / incumbent.expectedUsd > config.switching.minimum_savings_fraction)) continue;

    if (
      candidate.expectedUsd < bestExpected ||
      (candidate.expectedUsd === bestExpected &&
        best !== null &&
        (declarationIndex.get(id) ?? 0) < (declarationIndex.get(best) ?? 0))
    ) {
      best = id;
      bestExpected = candidate.expectedUsd;
    }
  }
  return best;
}

function buildRankings(params: {
  candidates: AutoPolicyCandidate[];
  requiredTierRank: number | null;
  uncertaintyFloor: number | null;
  confident: boolean;
  taskKind: AutoTaskKind | null;
  deepReasoning: boolean;
  preferences: AutoRoutingPreferences;
  preferenceMargin: number | null;
  costEvidence: Record<string, AutoCostEstimate>;
}): AutoCandidateRanking[] {
  const {
    candidates,
    requiredTierRank,
    uncertaintyFloor,
    confident,
    taskKind,
    deepReasoning,
    preferences,
    preferenceMargin,
    costEvidence,
  } = params;

  const effectiveFloor = confident ? requiredTierRank : uncertaintyFloor;
  const specialtyMatches = new Map<string, boolean>();
  for (const candidate of candidates) {
    specialtyMatches.set(
      candidate.id,
      taskKind !== null && candidate.profile.specialties.includes(taskKind)
    );
  }

  const suitableById = new Map<string, boolean>();
  for (const candidate of candidates) {
    const capabilityRank = autoTierRank(autoProfileCapability(candidate.profile));
    suitableById.set(candidate.id, effectiveFloor === null || capabilityRank >= effectiveFloor);
  }

  const preferencesById = new Map<string, number>();
  if (confident && requiredTierRank !== null) {
    for (const candidate of candidates) {
      preferencesById.set(
        candidate.id,
        preferenceFor(
          candidate,
          requiredTierRank,
          specialtyMatches.get(candidate.id) ?? false,
          deepReasoning && (candidate.profile.reasoning ?? 'normal') === 'preferred',
          preferences
        )
      );
    }
  }

  // The comparable band is relative to the best *suitable* preference. An
  // unsuitable target (whose clamped base is 1) must never widen the band, and
  // an empty suitable set must yield no comparable targets.
  let maxSuitablePreference = -Infinity;
  for (const candidate of candidates) {
    if (!suitableById.get(candidate.id)) continue;
    const value = preferencesById.get(candidate.id);
    if (value !== undefined) maxSuitablePreference = Math.max(maxSuitablePreference, value);
  }
  const hasSuitablePreference = Number.isFinite(maxSuitablePreference);

  return candidates.map((candidate) => {
    const capability = autoProfileCapability(candidate.profile);
    const capabilityRank = autoTierRank(capability);
    const suitable = suitableById.get(candidate.id) ?? false;
    const exclusion: AutoExclusion | null = suitable
      ? null
      : confident
        ? 'capability_below_required'
        : 'below_uncertainty_floor';
    const specialtyMatch = specialtyMatches.get(candidate.id) ?? false;
    const preference = confident ? (preferencesById.get(candidate.id) ?? 0) : null;
    const comparable =
      confident &&
      suitable &&
      hasSuitablePreference &&
      preferenceMargin !== null &&
      preference !== null &&
      preference >= maxSuitablePreference - preferenceMargin;
    const cost = costEvidence[candidate.id]!;
    return {
      id: candidate.id,
      provider: candidate.provider,
      model: candidate.model,
      capabilityTier: capability,
      capabilityRank,
      suitable,
      exclusion,
      preference,
      specialtyMatch,
      reasoningPreferred: (candidate.profile.reasoning ?? 'normal') === 'preferred',
      comparable,
      economicallyComparable: cost.known && cost.warmth !== 'uncertain',
    };
  });
}

/**
 * Rank eligible auto candidates in one deterministic pass.
 *
 * `candidates` must already be in declared order and filtered for
 * access/quota/health/API support. This function never adds providers, bypasses
 * eligibility, or calls a classifier. In the confident path `orderedIds`
 * contains only suitable candidates; fallback/continuation status is recorded on
 * `decision`.
 */
export function rankAutoCandidates(
  candidates: AutoPolicyCandidate[],
  config: Partial<AutoRoutingConfig> | undefined,
  context: AutoPolicyContext
): AutoRankingResult {
  const resolved = resolveAutoPolicyConfig(config);
  const now = context.now ?? Date.now();
  const effectiveContext: AutoPolicyContext = { ...context, now };

  const costEvidence: Record<string, AutoCostEstimate> = {};
  for (const candidate of candidates) {
    costEvidence[candidate.id] = estimateAutoCandidateCost(candidate, effectiveContext);
  }

  const declarationIndex = new Map<string, number>();
  candidates.forEach((candidate, index) => declarationIndex.set(candidate.id, index));

  const allIds = candidates.map((candidate) => candidate.id);
  const incumbentId = context.incumbentId ?? null;
  const incumbentCandidate = incumbentId
    ? candidates.find((candidate) => candidate.id === incumbentId)
    : undefined;
  const continuationLocked = context.continuationLocked === true;

  const judgment = validateAutoJudgment(context.judgment);
  const hasJudgment = judgment !== null;
  const lowConfidence =
    hasJudgment &&
    judgment.confidence !== undefined &&
    judgment.confidence < resolved.scoring.confidence_threshold;
  const unknownTask = hasJudgment && judgment.task_kind === 'unknown';
  const uncertainty = !hasJudgment || lowConfidence || unknownTask;

  const taskKind: AutoTaskKind | null =
    hasJudgment && judgment.task_kind !== 'unknown' ? judgment.task_kind : null;
  const deepReasoning = hasJudgment
    ? judgment.deep_reasoning >= resolved.scoring.reasoning_threshold
    : false;

  // Demand and required tier (null when no usable judgment).
  let demand: number | null = null;
  let requiredTierRank: number | null = null;
  let scoreDeadbandCleared = true;
  let upgrade = false;
  let downgrade = false;

  if (hasJudgment) {
    const computed = computeAutoRequiredTier(judgment, resolved.scoring);
    demand = computed.demand;
    requiredTierRank = autoTierRank(computed.requiredTier);

    // Downgrade hysteresis only protects an incumbent that is still eligible
    // for the freshly computed requirement. A blocked or now-unsuitable
    // incumbent defers to the current tier instead of holding the old one.
    const incumbentSatisfiesCurrent =
      incumbentCandidate !== undefined &&
      autoTierRank(autoProfileCapability(incumbentCandidate.profile)) >= requiredTierRank;
    if (
      incumbentId &&
      incumbentSatisfiesCurrent &&
      context.previousRequiredTier !== undefined &&
      context.previousDemand !== undefined
    ) {
      const previousRequired = autoTierRank(context.previousRequiredTier);
      if (requiredTierRank < previousRequired) {
        const boundary = lowerBoundaryOfTier(previousRequired, resolved.scoring.tier_boundaries);
        if (!(demand < boundary - resolved.switching.score_deadband)) {
          requiredTierRank = previousRequired;
          scoreDeadbandCleared = false;
        } else {
          downgrade = true;
        }
      } else if (requiredTierRank > previousRequired) {
        upgrade = true;
      }
    }
  } else if (context.previousRequiredTier !== undefined) {
    requiredTierRank = autoTierRank(context.previousRequiredTier);
    demand = context.previousDemand ?? null;
  }

  const uncertaintyFloor = autoTierRank(resolved.uncertainty_minimum_tier);

  const makeDecision = (overrides: Partial<AutoDecision> & { reason: AutoDecisionReason }) => {
    const decision: AutoDecision = {
      chosenId: null,
      incumbentId,
      continuationLocked,
      continuationTargetUnavailable: false,
      fallback: false,
      uncertainty,
      upgrade,
      downgrade,
      scoreDeadbandCleared,
      ...overrides,
    };
    return decision;
  };

  if (candidates.length === 0) {
    return {
      orderedIds: [],
      decision: makeDecision({ reason: 'no_candidates' }),
      demand,
      requiredTier: requiredTierRank,
      rankings: [],
      costEvidence,
    };
  }

  // Hard continuation lock is authoritative.
  if (continuationLocked) {
    const rankings = buildRankings({
      candidates,
      requiredTierRank,
      uncertaintyFloor,
      confident: false,
      taskKind,
      deepReasoning,
      preferences: resolved.preferences,
      preferenceMargin: null,
      costEvidence,
    });
    if (incumbentCandidate) {
      // Only the locked target is safe to order; offering another target first
      // would advertise a portability guarantee that does not exist.
      return {
        orderedIds: [incumbentCandidate.id],
        decision: makeDecision({
          reason: 'continuation_locked',
          chosenId: incumbentCandidate.id,
        }),
        demand,
        requiredTier: requiredTierRank,
        rankings,
        costEvidence,
      };
    }
    if (incumbentId) {
      // A known incumbent that eligibility removed cannot be safely replaced
      // mid-continuation.
      return {
        orderedIds: [],
        decision: makeDecision({
          reason: 'continuation_target_unavailable',
          continuationTargetUnavailable: true,
        }),
        demand,
        requiredTier: requiredTierRank,
        rankings,
        costEvidence,
      };
    }
    // Cold continuation state (no known incumbent): conservatively order the
    // first eligible target only and disclose the unknown outcome through
    // `fallback` instead of asserting a locked-target continuation.
    const coldContinuationTarget = allIds[0] ?? null;
    return {
      orderedIds: coldContinuationTarget ? [coldContinuationTarget] : [],
      decision: makeDecision({
        reason: 'continuation_locked',
        chosenId: coldContinuationTarget,
        fallback: true,
      }),
      demand,
      requiredTier: requiredTierRank,
      rankings,
      costEvidence,
    };
  }

  // Uncertainty path
  if (uncertainty) {
    const rankings = buildRankings({
      candidates,
      requiredTierRank,
      uncertaintyFloor,
      confident: false,
      taskKind,
      deepReasoning,
      preferences: resolved.preferences,
      preferenceMargin: null,
      costEvidence,
    });
    const qualified = candidates
      .filter(
        (candidate) => autoTierRank(autoProfileCapability(candidate.profile)) >= uncertaintyFloor
      )
      .map((candidate) => candidate.id);

    if (qualified.length === 0) {
      return {
        orderedIds: [...allIds],
        decision: makeDecision({
          reason: 'no_suitable_target_first_option',
          chosenId: allIds[0],
          fallback: true,
        }),
        demand,
        requiredTier: requiredTierRank ?? uncertaintyFloor,
        rankings,
        costEvidence,
      };
    }

    if (incumbentId && qualified.includes(incumbentId)) {
      const ordered = [
        incumbentId,
        ...baselineOrder(
          qualified.filter((id) => id !== incumbentId),
          resolved.baseline_policy,
          declarationIndex,
          costEvidence
        ),
      ];
      return {
        orderedIds: ordered,
        decision: makeDecision({
          reason: 'uncertain_incumbent_hold',
          chosenId: incumbentId,
        }),
        demand,
        requiredTier: requiredTierRank ?? uncertaintyFloor,
        rankings,
        costEvidence,
      };
    }

    const ordered = baselineOrder(
      qualified,
      resolved.baseline_policy,
      declarationIndex,
      costEvidence
    );
    return {
      orderedIds: ordered,
      decision: makeDecision({
        reason: 'uncertain_baseline',
        chosenId: ordered[0],
      }),
      demand,
      requiredTier: requiredTierRank ?? uncertaintyFloor,
      rankings,
      costEvidence,
    };
  }

  // Confident path
  const confidentRequiredRank = requiredTierRank as number;
  const rankings = buildRankings({
    candidates,
    requiredTierRank: confidentRequiredRank,
    uncertaintyFloor,
    confident: true,
    taskKind,
    deepReasoning,
    preferences: resolved.preferences,
    preferenceMargin: resolved.switching.preference_margin,
    costEvidence,
  });
  const preferenceById = new Map<string, number>(
    rankings.map((ranking) => [ranking.id, ranking.preference ?? 0])
  );

  const suitableIds = rankings.filter((ranking) => ranking.suitable).map((r) => r.id);

  if (suitableIds.length === 0) {
    return {
      orderedIds: [...allIds],
      decision: makeDecision({
        reason: 'no_suitable_target_first_option',
        chosenId: allIds[0],
        fallback: true,
      }),
      demand,
      requiredTier: confidentRequiredRank,
      rankings,
      costEvidence,
    };
  }

  const bandIds = rankings
    .filter((ranking) => ranking.suitable && ranking.comparable)
    .map((r) => r.id);

  const incumbentSuitable = incumbentId !== null && suitableIds.includes(incumbentId);
  let chosenId: string;
  let reason: AutoDecisionReason;

  if (incumbentSuitable && incumbentId) {
    const incumbentPreference = preferenceById.get(incumbentId) ?? 0;
    const economicSwitch = economicSwitchCandidate({
      incumbentId,
      bandIds,
      config: resolved,
      declarationIndex,
      costEvidence,
    });

    if (economicSwitch) {
      chosenId = economicSwitch;
      reason = 'economic_switch';
    } else {
      // The comparable band can contain a cheap target whose preference gain
      // over the incumbent does not clear the margin. Filter to genuine
      // improvements before choosing so the band's cheapest target cannot win
      // without an actual preference gain; otherwise hold the incumbent.
      const qualifiedBandIds = bandIds.filter(
        (id) =>
          id !== incumbentId &&
          (preferenceById.get(id) ?? 0) > incumbentPreference + resolved.switching.preference_margin
      );
      if (qualifiedBandIds.length > 0) {
        const best = chooseColdTarget(
          qualifiedBandIds,
          preferenceById,
          declarationIndex,
          costEvidence
        );
        const bestRanking = rankings.find((ranking) => ranking.id === best);
        chosenId = best;
        reason = bestRanking?.specialtyMatch ? 'specialist_switch' : 'preference_switch';
      } else {
        chosenId = incumbentId;
        reason = 'cache_hold';
      }
    }
  } else {
    chosenId = chooseColdTarget(bandIds, preferenceById, declarationIndex, costEvidence);
    if (!incumbentId) {
      reason = 'cold_start';
    } else if (incumbentCandidate) {
      reason = 'quality_upgrade';
    } else {
      // The incumbent was removed by access/quota/health filtering; this is not
      // a capability upgrade.
      reason = 'incumbent_unavailable';
    }
  }

  const orderedIds = orderRemainingSuitable(
    suitableIds,
    chosenId,
    preferenceById,
    declarationIndex,
    costEvidence
  );

  return {
    orderedIds,
    decision: makeDecision({ reason, chosenId }),
    demand,
    requiredTier: confidentRequiredRank,
    rankings,
    costEvidence,
  };
}
