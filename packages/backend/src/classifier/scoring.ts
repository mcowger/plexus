import {
  Tier,
  TIER_RANK,
  type ClassifierConfig,
  type DimensionScore,
  type ClassificationResult,
} from './types';
import { hasArchitectureSignal, scoreDimensions } from './dimensions';

/**
 * Phase 2: Compute weighted score from all dimension scores.
 */
export function computeWeightedScore(
  dimensions: DimensionScore[],
  weights: Record<string, number>
): { weightedScore: number; signals: string[] } {
  let weightedScore = 0;
  const signals: string[] = [];

  for (const dim of dimensions) {
    const weight = weights[dim.name] ?? 0;
    weightedScore += dim.score * weight;
    if (dim.signal !== null) {
      signals.push(dim.signal);
    }
  }

  return { weightedScore, signals };
}

export interface Phase3Result {
  overrideTier: Tier | null;
  overrideConfidence: number | null;
  weightedScore: number;
  enforceStructuredMin: boolean;
  reasoning: string;
  signals: string[];
}

/**
 * Phase 3: Apply deterministic overrides.
 */
export function runPhase3Overrides(
  weightedScore: number,
  signals: string[],
  reasoningMatches: number,
  hasStructuredOutput: boolean,
  fullText: string,
  config: ClassifierConfig
): Phase3Result {
  let overrideTier: Tier | null = null;
  let overrideConfidence: number | null = null;
  let currentWeightedScore = weightedScore;
  let reasoning = `rules: score=${weightedScore.toFixed(3)}`;
  const currentSignals = [...signals];

  // Override 1: Direct REASONING on multiple reasoning markers
  if (reasoningMatches >= config.reasoningOverrideMinMatches) {
    overrideTier = Tier.REASONING;
    overrideConfidence = config.reasoningOverrideMinConfidence;
    reasoning += ` | override: 2+ reasoning markers → REASONING`;
    // Ensure weightedScore is at least reasoningOverrideMinScore for confidence calibration
    currentWeightedScore = Math.max(currentWeightedScore, config.reasoningOverrideMinScore);
  }

  // Override 2: Architecture / Design signal (only if not already overridden)
  if (overrideTier === null && hasArchitectureSignal(fullText)) {
    overrideTier = Tier.COMPLEX;
    overrideConfidence = config.architectureOverrideConfidence;
    currentWeightedScore = Math.max(currentWeightedScore, config.architectureOverrideMinScore);
    reasoning += ` | override: architecture-design → COMPLEX`;
    currentSignals.push('architecture-design');
  }

  // Override 3: Structured output minimum tier (recorded as flag, applied in Phase 4)
  const enforceStructuredMin = hasStructuredOutput;

  return {
    overrideTier,
    overrideConfidence,
    weightedScore: currentWeightedScore,
    enforceStructuredMin,
    reasoning,
    signals: currentSignals,
  };
}

export interface Phase4Result {
  finalTier: Tier;
  distanceFromBoundary: number;
  reasoning: string;
  mappedTier: Tier;
}

/**
 * Phase 4: Map weighted score to a tier using configurable boundaries.
 * Apply overrides and structured output minimum.
 */
export function mapToBoundary(
  weightedScore: number,
  overrideTier: Tier | null,
  enforceStructuredMin: boolean,
  reasoning: string,
  config: ClassifierConfig
): Phase4Result {
  const { simpleMedium, mediumComplex, complexReasoning } = config.tierBoundaries;

  // Determine mapped tier and distance from boundary
  let mappedTier: Tier;
  let distanceFromBoundary: number;

  if (weightedScore < simpleMedium) {
    mappedTier = Tier.SIMPLE;
    distanceFromBoundary = simpleMedium - weightedScore;
  } else if (weightedScore < mediumComplex) {
    mappedTier = Tier.MEDIUM;
    distanceFromBoundary = Math.min(weightedScore - simpleMedium, mediumComplex - weightedScore);
  } else if (weightedScore < complexReasoning) {
    mappedTier = Tier.COMPLEX;
    distanceFromBoundary = Math.min(
      weightedScore - mediumComplex,
      complexReasoning - weightedScore
    );
  } else {
    mappedTier = Tier.REASONING;
    distanceFromBoundary = weightedScore - complexReasoning;
  }

  let finalTier: Tier;
  let finalReasoning = reasoning;

  // Apply override tier or boundary-mapped tier
  if (overrideTier !== null) {
    finalTier = overrideTier;
    finalReasoning += ` | boundary would map to ${mappedTier}, override forces ${overrideTier}`;
  } else {
    finalTier = mappedTier;
    finalReasoning += ` | tier=${mappedTier}`;
  }

  // Enforce structured output minimum tier (MEDIUM)
  const structuredOutputMinTier = config.structuredOutputMinTier;
  if (enforceStructuredMin && TIER_RANK[finalTier] < TIER_RANK[structuredOutputMinTier]) {
    finalReasoning += ` | upgraded from ${finalTier} to ${structuredOutputMinTier} (structured output)`;
    finalTier = structuredOutputMinTier;
  }

  return { finalTier, distanceFromBoundary, reasoning: finalReasoning, mappedTier };
}

/**
 * Sigmoid confidence calibration.
 * confidence = 1 / (1 + exp(-steepness * distance))
 */
export function calibrateConfidence(distance: number, steepness: number): number {
  return 1.0 / (1.0 + Math.exp(-steepness * distance));
}

/**
 * Phase 5: Compute confidence and apply ambiguity fallback.
 */
export function runPhase5(
  distanceFromBoundary: number,
  overrideConfidence: number | null,
  finalTier: Tier,
  reasoning: string,
  config: ClassifierConfig
): { tier: Tier; confidence: number; reasoning: string } {
  let confidence = calibrateConfidence(distanceFromBoundary, config.confidenceSteepness);

  // Apply override minimum confidence
  if (overrideConfidence !== null) {
    confidence = Math.max(confidence, overrideConfidence);
  }

  let currentTier = finalTier;
  let currentReasoning = reasoning;

  // Ambiguity handling: if confidence is below threshold, default to MEDIUM
  if (confidence < config.ambiguityThreshold) {
    currentReasoning += ` | low confidence (${confidence.toFixed(2)}) → default to ${config.ambiguousDefaultTier}`;
    currentTier = config.ambiguousDefaultTier;
    // Do NOT override confidence — report actual low value
  }

  return { tier: currentTier, confidence, reasoning: currentReasoning };
}

/**
 * Apply agentic boost: if agenticScore > threshold, promote one tier.
 * Capped at REASONING.
 */
export function applyAgenticBoost(tier: Tier, agenticScore: number, threshold: number): Tier {
  if (agenticScore <= threshold) {
    return tier;
  }

  // Promote one tier (capped at REASONING)
  const tierOrder: Tier[] = [
    Tier.HEARTBEAT,
    Tier.SIMPLE,
    Tier.MEDIUM,
    Tier.COMPLEX,
    Tier.REASONING,
  ];
  const currentRank = TIER_RANK[tier];
  const nextRank = Math.min(currentRank + 1, TIER_RANK[Tier.REASONING]);

  return tierOrder[nextRank] ?? Tier.REASONING;
}

/**
 * Assemble the complete classification pipeline result (Phases 2-5).
 */
export function runScoringPipeline(
  input: {
    fullText: string;
    userText: string;
    estimatedTokens: number;
    messageCount: number;
    hasTools: boolean;
    hasExplicitToolChoice: boolean;
    responseFormat: { type: string } | undefined;
  },
  config: ClassifierConfig
): ClassificationResult {
  // Phase 2: Score all 16 dimensions
  const { dimensions, agenticScore, hasStructuredOutput, reasoningMatches } = scoreDimensions(
    input,
    config
  );

  const { weightedScore, signals } = computeWeightedScore(dimensions, config.dimensionWeights);

  // Phase 3: Override checks
  const phase3 = runPhase3Overrides(
    weightedScore,
    signals,
    reasoningMatches,
    hasStructuredOutput,
    input.fullText,
    config
  );

  // Phase 4: Tier boundary mapping
  const phase4 = mapToBoundary(
    phase3.weightedScore,
    phase3.overrideTier,
    phase3.enforceStructuredMin,
    phase3.reasoning,
    config
  );

  // Phase 5: Confidence calibration and ambiguity handling
  const phase5 = runPhase5(
    phase4.distanceFromBoundary,
    phase3.overrideConfidence,
    phase4.finalTier,
    phase4.reasoning,
    config
  );

  return {
    tier: phase5.tier,
    score: phase3.weightedScore,
    confidence: phase5.confidence,
    method: 'rules',
    reasoning: phase5.reasoning,
    signals: phase3.signals,
    agenticScore,
    hasStructuredOutput,
  };
}
