import type { ClassifierInput, ClassificationResult, ClassifierConfig } from './types';
import { mergeConfig } from './config';
import { runPhase1, extractLastUserMessage, estimateTokens } from './phase1';
import { scoreDimensions } from './dimensions';
import { computeWeightedScore, runPhase3Overrides, mapToBoundary, runPhase5 } from './scoring';

export { Tier, TIER_RANK } from './types';
export type {
  ClassifierInput,
  ClassificationResult,
  ClassifierConfig,
  DimensionScore,
} from './types';
export { DEFAULT_CLASSIFIER_CONFIG, mergeConfig } from './config';

/**
 * Classify an incoming chat request into a complexity tier.
 *
 * Synchronous, no external calls, < 1ms execution.
 *
 * @param input - The classifier input (messages, tools, etc.)
 * @param config - Optional partial config to override defaults
 * @returns ClassificationResult with tier, score, confidence, signals, etc.
 */
export function classify(
  input: ClassifierInput,
  config?: Partial<ClassifierConfig>
): ClassificationResult {
  const resolvedConfig = config ? mergeConfig(config) : mergeConfig({});

  // Phase 1: Short-circuit checks
  const phase1Result = runPhase1(input, resolvedConfig);
  if (phase1Result !== null) {
    return phase1Result;
  }

  // Prepare text inputs for Phase 2
  const fullText = input.messages
    .map((m) => (typeof m.content === 'string' ? m.content : ''))
    .join('\n')
    .toLowerCase();

  const userText = input.messages
    .filter((m) => m.role === 'user')
    .map((m) => (typeof m.content === 'string' ? m.content : ''))
    .join('\n')
    .toLowerCase();

  const estimatedTokens = estimateTokens(input.messages);
  const messageCount = input.messages.length;
  const hasTools = (input.tools ?? []).length > 0;
  const hasExplicitToolChoice =
    input.tool_choice !== undefined && input.tool_choice !== 'auto' && input.tool_choice !== 'none';

  const responseFormat = input.response_format;

  // Phase 2: Score all 16 dimensions
  const { dimensions, agenticScore, hasStructuredOutput, reasoningMatches } = scoreDimensions(
    {
      fullText,
      userText,
      estimatedTokens,
      messageCount,
      hasTools,
      hasExplicitToolChoice,
      responseFormat,
    },
    resolvedConfig
  );

  const { weightedScore, signals } = computeWeightedScore(
    dimensions,
    resolvedConfig.dimensionWeights
  );

  // Phase 3: Override checks
  const phase3 = runPhase3Overrides(
    weightedScore,
    signals,
    reasoningMatches,
    hasStructuredOutput,
    fullText,
    resolvedConfig
  );

  // Phase 4: Tier boundary mapping
  const phase4 = mapToBoundary(
    phase3.weightedScore,
    phase3.overrideTier,
    phase3.enforceStructuredMin,
    phase3.reasoning,
    resolvedConfig
  );

  // Phase 5: Confidence calibration and ambiguity handling
  const phase5 = runPhase5(
    phase4.distanceFromBoundary,
    phase3.overrideConfidence,
    phase4.finalTier,
    phase4.reasoning,
    resolvedConfig
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
