import { Tier, type ClassifierConfig } from './types';
import {
  CODE_KEYWORDS,
  REASONING_KEYWORDS,
  SIMPLE_KEYWORDS,
  TECHNICAL_KEYWORDS,
  CREATIVE_KEYWORDS,
  AGENTIC_KEYWORDS,
  IMPERATIVE_KEYWORDS,
  CONSTRAINT_KEYWORDS,
  OUTPUT_FORMAT_KEYWORDS,
  REFERENCE_KEYWORDS,
  NEGATION_KEYWORDS,
} from './keywords';

export const DEFAULT_CLASSIFIER_CONFIG: ClassifierConfig = {
  // --- Phase 1: Short-circuit thresholds ---
  maxTokensForceComplex: 100_000,

  // --- Phase 2: Dimension weights (must sum to 1.00) ---
  dimensionWeights: {
    tokenCount: 0.08,
    codePresence: 0.14,
    reasoningMarkers: 0.18,
    multiStepPatterns: 0.12,
    simpleIndicators: 0.1,
    technicalTerms: 0.08,
    agenticTask: 0.06,
    toolPresence: 0.05,
    questionComplexity: 0.04,
    creativeMarkers: 0.03,
    constraintCount: 0.03,
    outputFormat: 0.03,
    conversationDepth: 0.02,
    imperativeVerbs: 0.02,
    referenceComplexity: 0.01,
    negationComplexity: 0.01,
  },

  // --- Phase 3: Override parameters ---
  reasoningOverrideMinMatches: 2,
  reasoningOverrideMinConfidence: 0.85,
  reasoningOverrideMinScore: 0.42,
  architectureOverrideConfidence: 0.82,
  architectureOverrideMinScore: 0.22,
  structuredOutputMinTier: Tier.MEDIUM,

  // --- Phase 4: Tier boundary thresholds ---
  tierBoundaries: {
    simpleMedium: 0.0,
    mediumComplex: 0.2,
    complexReasoning: 0.4,
  },

  // --- Phase 5: Confidence calibration ---
  confidenceSteepness: 12,
  ambiguityThreshold: 0.55,
  ambiguousDefaultTier: Tier.MEDIUM,

  // --- Keyword lists ---
  keywords: {
    code: CODE_KEYWORDS,
    reasoning: REASONING_KEYWORDS,
    simple: SIMPLE_KEYWORDS,
    technical: TECHNICAL_KEYWORDS,
    creative: CREATIVE_KEYWORDS,
    agentic: AGENTIC_KEYWORDS,
    imperative: IMPERATIVE_KEYWORDS,
    constraint: CONSTRAINT_KEYWORDS,
    outputFormat: OUTPUT_FORMAT_KEYWORDS,
    reference: REFERENCE_KEYWORDS,
    negation: NEGATION_KEYWORDS,
  },
};

/**
 * Deep-merge a partial ClassifierConfig with the defaults.
 * dimensionWeights must be fully specified if provided (all 16 keys).
 */
export function mergeConfig(partial: Partial<ClassifierConfig>): ClassifierConfig {
  return {
    ...DEFAULT_CLASSIFIER_CONFIG,
    ...partial,
    tierBoundaries: {
      ...DEFAULT_CLASSIFIER_CONFIG.tierBoundaries,
      ...partial.tierBoundaries,
    },
    keywords: {
      ...DEFAULT_CLASSIFIER_CONFIG.keywords,
      ...partial.keywords,
    },
    // dimensionWeights must be fully specified if provided
    dimensionWeights: partial.dimensionWeights ?? DEFAULT_CLASSIFIER_CONFIG.dimensionWeights,
  };
}
