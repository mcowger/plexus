import type { ClassifierConfig, DimensionScore } from './types';

// Precompile multi-step patterns at module load time
const MULTI_STEP_PATTERNS: RegExp[] = [
  /\bfirst\b.{0,100}\bthen\b/is, // "first X, then Y" (with content between)
  /step\s+\d/i,
  /\d+\)\s/,
  /\d+\.\s+[A-Z]/,
  /phase\s+\d/i,
  /\bfirst\b.*\bsecond\b.*\bthird\b/is,
  /\bthen\b.*\bafter that\b/is,
  /\bfinally\b/i,
];

// Precompile architecture detection patterns
const ARCHITECTURE_NOUNS =
  /\b(architecture|microservice|infrastructure|system design|distributed system|scalab|pipeline|data model|schema design|api design)\b/i;
const DESIGN_VERBS = /\b(design|architect|plan|scale|model|structure|organize|orchestrat)\b/i;

/**
 * Count distinct keyword matches (case-insensitive substring search).
 * Each keyword counts once regardless of how many times it appears.
 */
function countKeywordMatches(text: string, keywords: string[]): number {
  let count = 0;
  for (const kw of keywords) {
    if (text.includes(kw.toLowerCase())) {
      count++;
    }
  }
  return count;
}

/**
 * Dimension 1: tokenCount
 * Longer requests are generally more complex.
 */
export function scoreTokenCount(
  estimatedTokens: number,
  _config: ClassifierConfig
): DimensionScore {
  let score: number;
  let signal: string | null;

  if (estimatedTokens < 50) {
    score = -0.5;
    signal = 'tokens:very-short';
  } else if (estimatedTokens < 200) {
    score = 0.0;
    signal = null;
  } else if (estimatedTokens < 500) {
    score = 0.3;
    signal = 'tokens:moderate';
  } else if (estimatedTokens < 2000) {
    score = 0.5;
    signal = 'tokens:long';
  } else {
    score = 1.0;
    signal = 'tokens:very-long';
  }

  return { name: 'tokenCount', score, signal };
}

/**
 * Dimension 2: codePresence
 * Detect code blocks and programming keywords.
 */
export function scoreCodePresence(fullText: string, config: ClassifierConfig): DimensionScore {
  // Count code blocks (pairs of triple-backticks)
  const backtickMatches = (fullText.match(/```/g) ?? []).length;
  const codeBlockMatches = Math.max(0, Math.floor(backtickMatches / 2));

  // Count code keyword matches
  const codeKeywordMatches = countKeywordMatches(fullText, config.keywords.code);

  const codeSignals = codeBlockMatches + codeKeywordMatches;

  let score: number;
  let signal: string | null;

  if (codeSignals === 0) {
    score = 0.0;
    signal = null;
  } else if (codeSignals <= 2) {
    score = 0.5;
    signal = `code-keywords:${codeSignals}`;
  } else {
    score = 1.0;
    signal = `code-keywords:${codeSignals}`;
  }
  return { name: 'codePresence', score, signal };
}

/**
 * Dimension 3: reasoningMarkers
 * Detect chain-of-thought, proof, or derivation markers.
 * Uses userText ONLY (not fullText).
 * Returns count as side effect for Phase 3.
 */
export function scoreReasoningMarkers(
  userText: string,
  config: ClassifierConfig
): DimensionScore & { reasoningMatches: number } {
  const reasoningMatches = countKeywordMatches(userText, config.keywords.reasoning);

  let score: number;
  let signal: string | null;

  if (reasoningMatches === 0) {
    score = 0.0;
    signal = null;
  } else if (reasoningMatches === 1) {
    score = 0.5;
    signal = 'reasoning-markers:1';
  } else {
    score = 1.0;
    signal = `reasoning-markers:${reasoningMatches}`;
  }

  return { name: 'reasoningMarkers', score, signal, reasoningMatches };
}

/**
 * Dimension 4: multiStepPatterns
 * Detect requests describing a sequence of steps.
 */
export function scoreMultiStepPatterns(
  fullText: string,
  _config: ClassifierConfig
): DimensionScore {
  // Count distinct patterns that match
  let matchCount = 0;
  for (const pattern of MULTI_STEP_PATTERNS) {
    if (pattern.test(fullText)) {
      matchCount++;
    }
  }

  let score: number;
  let signal: string | null;

  if (matchCount === 0) {
    score = 0.0;
    signal = null;
  } else if (matchCount === 1) {
    score = 0.4;
    signal = 'multi-step:1';
  } else if (matchCount === 2) {
    score = 0.7;
    signal = 'multi-step:2';
  } else {
    score = 1.0;
    signal = `multi-step:${matchCount}`;
  }

  return { name: 'multiStepPatterns', score, signal };
}

/**
 * Dimension 5: simpleIndicators
 * Detect trivially simple request keywords. Returns NEGATIVE scores.
 */
export function scoreSimpleIndicators(fullText: string, config: ClassifierConfig): DimensionScore {
  const simpleMatches = countKeywordMatches(fullText, config.keywords.simple);

  let score: number;
  let signal: string | null;

  if (simpleMatches === 0) {
    score = 0.0;
    signal = null;
  } else if (simpleMatches <= 2) {
    score = -0.5;
    signal = `simple-indicators:${simpleMatches}`;
  } else {
    score = -1.0;
    signal = `simple-indicators:${simpleMatches}`;
  }

  return { name: 'simpleIndicators', score, signal };
}

/**
 * Dimension 6: technicalTerms
 * Detect domain-specific technical vocabulary.
 */
export function scoreTechnicalTerms(fullText: string, config: ClassifierConfig): DimensionScore {
  const techMatches = countKeywordMatches(fullText, config.keywords.technical);

  let score: number;
  let signal: string | null;

  if (techMatches === 0) {
    score = 0.0;
    signal = null;
  } else if (techMatches <= 2) {
    score = 0.3;
    signal = `technical-terms:${techMatches}`;
  } else if (techMatches <= 5) {
    score = 0.6;
    signal = `technical-terms:${techMatches}`;
  } else {
    score = 0.8;
    signal = `technical-terms:${techMatches}`;
  }

  return { name: 'technicalTerms', score, signal };
}

/**
 * Dimension 7: agenticTask
 * Detect agentic workflow keywords.
 * Returns agenticScore as side effect.
 */
export function scoreAgenticTask(
  fullText: string,
  config: ClassifierConfig
): DimensionScore & { agenticScore: number } {
  const agenticMatches = countKeywordMatches(fullText, config.keywords.agentic);

  let dimensionScore: number;
  let agenticScore: number;
  let signal: string | null;

  if (agenticMatches === 0) {
    dimensionScore = 0.0;
    agenticScore = 0.0;
    signal = null;
  } else if (agenticMatches <= 2) {
    dimensionScore = 0.3;
    agenticScore = 0.2;
    signal = `agentic-task:${agenticMatches}`;
  } else if (agenticMatches === 3) {
    dimensionScore = 0.6;
    agenticScore = 0.6;
    signal = `agentic-task:${agenticMatches}`;
  } else {
    dimensionScore = 1.0;
    agenticScore = 1.0;
    signal = `agentic-task:${agenticMatches}`;
  }

  return { name: 'agenticTask', score: dimensionScore, signal, agenticScore };
}

/**
 * Dimension 8: toolPresence
 * Detect whether tools are declared in the request.
 * Side effect: if hasTools and agenticScore is 0, set agenticScore to 0.3.
 */
export function scoreToolPresence(
  hasTools: boolean,
  hasExplicitToolChoice: boolean,
  currentAgenticScore: number
): DimensionScore & { updatedAgenticScore: number } {
  let score: number;
  let signal: string | null;
  let updatedAgenticScore = currentAgenticScore;

  if (!hasTools) {
    score = 0.0;
    signal = null;
  } else if (hasExplicitToolChoice) {
    score = 1.0;
    signal = 'tools-with-explicit-choice';
    // Ensure agentic baseline
    if (updatedAgenticScore === 0.0) {
      updatedAgenticScore = 0.3;
    }
  } else {
    score = 0.6;
    signal = 'tools-present';
    // Ensure agentic baseline
    if (updatedAgenticScore === 0.0) {
      updatedAgenticScore = 0.3;
    }
  }

  return { name: 'toolPresence', score, signal, updatedAgenticScore };
}

/**
 * Dimension 9: questionComplexity
 * Count distinct questions. Single question is a simplicity signal.
 */
export function scoreQuestionComplexity(
  fullText: string,
  _config: ClassifierConfig
): DimensionScore {
  const questionCount = (fullText.match(/\?/g) ?? []).length;

  let score: number;
  let signal: string | null;

  if (questionCount === 0) {
    score = 0.0;
    signal = null;
  } else if (questionCount === 1) {
    score = -0.3;
    signal = 'questions:single';
  } else if (questionCount <= 3) {
    score = 0.3;
    signal = `questions:${questionCount}`;
  } else {
    score = 0.7;
    signal = `questions:${questionCount}`;
  }

  return { name: 'questionComplexity', score, signal };
}

/**
 * Dimension 10: creativeMarkers
 * Detect requests for creative content.
 */
export function scoreCreativeMarkers(fullText: string, config: ClassifierConfig): DimensionScore {
  const creativeMatches = countKeywordMatches(fullText, config.keywords.creative);

  let score: number;
  let signal: string | null;

  if (creativeMatches === 0) {
    score = 0.0;
    signal = null;
  } else if (creativeMatches <= 2) {
    score = 0.3;
    signal = `creative-markers:${creativeMatches}`;
  } else {
    score = 0.7;
    signal = `creative-markers:${creativeMatches}`;
  }

  return { name: 'creativeMarkers', score, signal };
}

/**
 * Dimension 11: constraintCount
 * Detect constraint indicators.
 */
export function scoreConstraintCount(fullText: string, config: ClassifierConfig): DimensionScore {
  const constraintMatches = countKeywordMatches(fullText, config.keywords.constraint);

  let score: number;
  let signal: string | null;

  if (constraintMatches === 0) {
    score = 0.0;
    signal = null;
  } else if (constraintMatches <= 2) {
    score = 0.3;
    signal = `constraints:${constraintMatches}`;
  } else {
    score = 0.8;
    signal = `constraints:${constraintMatches}`;
  }

  return { name: 'constraintCount', score, signal };
}

/**
 * Dimension 12: outputFormat
 * Detect structured output requests.
 * Returns hasStructuredOutput as side effect.
 */
export function scoreOutputFormat(
  fullText: string,
  responseFormat: { type: string } | undefined,
  config: ClassifierConfig
): DimensionScore & { hasStructuredOutput: boolean } {
  const formatFromApi =
    responseFormat !== undefined &&
    typeof responseFormat === 'object' &&
    responseFormat.type !== 'text';

  const formatMatches = countKeywordMatches(fullText, config.keywords.outputFormat);

  let score: number;
  let hasStructuredOutput: boolean;
  let signal: string | null;

  if (formatFromApi) {
    score = 0.8;
    hasStructuredOutput = true;
    signal = 'output-format:api-response-format';
  } else if (formatMatches >= 2) {
    score = 0.6;
    hasStructuredOutput = true;
    signal = `output-format:${formatMatches}`;
  } else if (formatMatches === 1) {
    score = 0.3;
    hasStructuredOutput = true;
    signal = `output-format:${formatMatches}`;
  } else {
    score = 0.0;
    hasStructuredOutput = false;
    signal = null;
  }

  return { name: 'outputFormat', score, signal, hasStructuredOutput };
}

/**
 * Dimension 13: conversationDepth
 * Longer conversations indicate more complex multi-turn interactions.
 */
export function scoreConversationDepth(
  messageCount: number,
  _config: ClassifierConfig
): DimensionScore {
  let score: number;
  let signal: string | null;

  if (messageCount <= 2) {
    score = 0.0;
    signal = null;
  } else if (messageCount <= 6) {
    score = 0.2;
    signal = `conversation-depth:${messageCount}`;
  } else if (messageCount <= 12) {
    score = 0.5;
    signal = `conversation-depth:${messageCount}`;
  } else {
    score = 0.7;
    signal = `conversation-depth:${messageCount}`;
  }

  return { name: 'conversationDepth', score, signal };
}

/**
 * Dimension 14: imperativeVerbs
 * Detect strong action verbs.
 */
export function scoreImperativeVerbs(fullText: string, config: ClassifierConfig): DimensionScore {
  const verbMatches = countKeywordMatches(fullText, config.keywords.imperative);

  let score: number;
  let signal: string | null;

  if (verbMatches === 0) {
    score = 0.0;
    signal = null;
  } else if (verbMatches <= 3) {
    score = 0.3;
    signal = `imperative-verbs:${verbMatches}`;
  } else {
    score = 0.5;
    signal = `imperative-verbs:${verbMatches}`;
  }

  return { name: 'imperativeVerbs', score, signal };
}

/**
 * Dimension 15: referenceComplexity
 * Detect references to external artifacts.
 */
export function scoreReferenceComplexity(
  fullText: string,
  config: ClassifierConfig
): DimensionScore {
  const refMatches = countKeywordMatches(fullText, config.keywords.reference);

  let score: number;
  let signal: string | null;

  if (refMatches === 0) {
    score = 0.0;
    signal = null;
  } else {
    score = Math.min(refMatches * 0.2, 0.5);
    signal = `references:${refMatches}`;
  }

  return { name: 'referenceComplexity', score, signal };
}

/**
 * Dimension 16: negationComplexity
 * Detect negation patterns. Very weak signal.
 */
export function scoreNegationComplexity(
  fullText: string,
  config: ClassifierConfig
): DimensionScore {
  const negMatches = countKeywordMatches(fullText, config.keywords.negation);

  let score: number;
  let signal: string | null;

  if (negMatches === 0) {
    score = 0.0;
    signal = null;
  } else {
    score = Math.min(negMatches * 0.1, 0.3);
    signal = `negation:${negMatches}`;
  }

  return { name: 'negationComplexity', score, signal };
}

/**
 * Check if the text contains both an architecture noun and a design verb.
 */
export function hasArchitectureSignal(text: string): boolean {
  return ARCHITECTURE_NOUNS.test(text) && DESIGN_VERBS.test(text);
}

export interface ScoreDimensionsResult {
  dimensions: DimensionScore[];
  agenticScore: number;
  hasStructuredOutput: boolean;
  reasoningMatches: number;
}

/**
 * Score all 16 dimensions and collect side-effect values.
 */
export function scoreDimensions(
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
): ScoreDimensionsResult {
  const dimensions: DimensionScore[] = [];

  // Dim 1: tokenCount
  dimensions.push(scoreTokenCount(input.estimatedTokens, config));

  // Dim 2: codePresence
  dimensions.push(scoreCodePresence(input.fullText, config));

  // Dim 3: reasoningMarkers (userText only)
  const reasoningResult = scoreReasoningMarkers(input.userText, config);
  const { reasoningMatches } = reasoningResult;
  dimensions.push({
    name: reasoningResult.name,
    score: reasoningResult.score,
    signal: reasoningResult.signal,
  });

  // Dim 4: multiStepPatterns
  dimensions.push(scoreMultiStepPatterns(input.fullText, config));

  // Dim 5: simpleIndicators
  dimensions.push(scoreSimpleIndicators(input.fullText, config));

  // Dim 6: technicalTerms
  dimensions.push(scoreTechnicalTerms(input.fullText, config));

  // Dim 7: agenticTask
  const agenticResult = scoreAgenticTask(input.fullText, config);
  let agenticScore = agenticResult.agenticScore;
  dimensions.push({
    name: agenticResult.name,
    score: agenticResult.score,
    signal: agenticResult.signal,
  });

  // Dim 8: toolPresence (side effect: may update agenticScore)
  const toolResult = scoreToolPresence(input.hasTools, input.hasExplicitToolChoice, agenticScore);
  agenticScore = toolResult.updatedAgenticScore;
  dimensions.push({ name: toolResult.name, score: toolResult.score, signal: toolResult.signal });

  // Dim 9: questionComplexity
  dimensions.push(scoreQuestionComplexity(input.fullText, config));

  // Dim 10: creativeMarkers
  dimensions.push(scoreCreativeMarkers(input.fullText, config));

  // Dim 11: constraintCount
  dimensions.push(scoreConstraintCount(input.fullText, config));

  // Dim 12: outputFormat (side effect: hasStructuredOutput)
  const outputResult = scoreOutputFormat(input.fullText, input.responseFormat, config);
  const { hasStructuredOutput } = outputResult;
  dimensions.push({
    name: outputResult.name,
    score: outputResult.score,
    signal: outputResult.signal,
  });

  // Dim 13: conversationDepth
  dimensions.push(scoreConversationDepth(input.messageCount, config));

  // Dim 14: imperativeVerbs
  dimensions.push(scoreImperativeVerbs(input.fullText, config));

  // Dim 15: referenceComplexity
  dimensions.push(scoreReferenceComplexity(input.fullText, config));

  // Dim 16: negationComplexity
  dimensions.push(scoreNegationComplexity(input.fullText, config));

  return { dimensions, agenticScore, hasStructuredOutput, reasoningMatches };
}
