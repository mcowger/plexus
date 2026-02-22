import { describe, test, expect } from 'bun:test';
import {
  computeWeightedScore,
  runPhase3Overrides,
  mapToBoundary,
  calibrateConfidence,
  runPhase5,
  applyAgenticBoost,
} from '../../src/classifier/scoring';
import { Tier } from '../../src/classifier/types';
import { DEFAULT_CLASSIFIER_CONFIG } from '../../src/classifier/config';

const cfg = DEFAULT_CLASSIFIER_CONFIG;

describe('computeWeightedScore', () => {
  test('returns 0 for all-zero dimensions', () => {
    const dims = [
      { name: 'tokenCount', score: 0, signal: null },
      { name: 'codePresence', score: 0, signal: null },
    ];
    const { weightedScore, signals } = computeWeightedScore(dims, cfg.dimensionWeights);
    expect(weightedScore).toBe(0);
    expect(signals).toHaveLength(0);
  });

  test('correctly weights dimensions and collects signals', () => {
    const dims = [
      { name: 'tokenCount', score: 1.0, signal: 'tokens:very-long' },
      { name: 'codePresence', score: 1.0, signal: 'code-keywords:5' },
    ];
    const { weightedScore, signals } = computeWeightedScore(dims, cfg.dimensionWeights);
    // tokenCount weight=0.08, codePresence weight=0.14 → 0.08 + 0.14 = 0.22
    expect(weightedScore).toBeCloseTo(0.22, 5);
    expect(signals).toContain('tokens:very-long');
    expect(signals).toContain('code-keywords:5');
  });

  test('null signals are not included in output', () => {
    const dims = [
      { name: 'tokenCount', score: 0.5, signal: null },
      { name: 'codePresence', score: 0.5, signal: 'code-keywords:2' },
    ];
    const { signals } = computeWeightedScore(dims, cfg.dimensionWeights);
    expect(signals).toHaveLength(1);
    expect(signals[0]).toBe('code-keywords:2');
  });

  test('negative scores reduce the weighted total', () => {
    const dims = [{ name: 'simpleIndicators', score: -1.0, signal: 'simple-indicators:3' }];
    const { weightedScore } = computeWeightedScore(dims, cfg.dimensionWeights);
    // simpleIndicators weight = 0.10 → -0.10
    expect(weightedScore).toBeCloseTo(-0.1, 5);
  });
});

describe('runPhase3Overrides', () => {
  test('no overrides when all inputs are neutral', () => {
    const result = runPhase3Overrides(0.1, [], 0, false, 'simple text', cfg);
    expect(result.overrideTier).toBeNull();
    expect(result.overrideConfidence).toBeNull();
    expect(result.enforceStructuredMin).toBe(false);
    expect(result.weightedScore).toBeCloseTo(0.1, 5);
  });

  test('Override 1: 2+ reasoning markers → forces REASONING', () => {
    const result = runPhase3Overrides(0.1, [], 2, false, 'prove this theorem', cfg);
    expect(result.overrideTier).toBe(Tier.REASONING);
    expect(result.overrideConfidence).toBe(cfg.reasoningOverrideMinConfidence);
    // weightedScore bumped up to at least reasoningOverrideMinScore
    expect(result.weightedScore).toBeGreaterThanOrEqual(cfg.reasoningOverrideMinScore);
    expect(result.reasoning).toContain('reasoning markers');
  });

  test('Override 2: architecture+design signal → forces COMPLEX', () => {
    const result = runPhase3Overrides(
      0.0,
      [],
      0,
      false,
      'design a microservices architecture',
      cfg
    );
    expect(result.overrideTier).toBe(Tier.COMPLEX);
    expect(result.overrideConfidence).toBe(cfg.architectureOverrideConfidence);
    expect(result.signals).toContain('architecture-design');
  });

  test('Override 1 takes precedence over Override 2', () => {
    const result = runPhase3Overrides(
      0.0,
      [],
      2,
      false,
      'design a microservices architecture',
      cfg
    );
    // Override 1 fires first → REASONING, not COMPLEX
    expect(result.overrideTier).toBe(Tier.REASONING);
  });

  test('Override 3: hasStructuredOutput sets enforceStructuredMin flag', () => {
    const result = runPhase3Overrides(0.1, [], 0, true, 'some text', cfg);
    expect(result.enforceStructuredMin).toBe(true);
  });
});

describe('mapToBoundary', () => {
  const { simpleMedium, mediumComplex, complexReasoning } = cfg.tierBoundaries;

  test('score below simpleMedium → SIMPLE', () => {
    const score = simpleMedium - 0.1;
    const result = mapToBoundary(score, null, false, 'test', cfg);
    expect(result.finalTier).toBe(Tier.SIMPLE);
    expect(result.mappedTier).toBe(Tier.SIMPLE);
  });

  test('score between simpleMedium and mediumComplex → MEDIUM', () => {
    const score = (simpleMedium + mediumComplex) / 2;
    const result = mapToBoundary(score, null, false, 'test', cfg);
    expect(result.finalTier).toBe(Tier.MEDIUM);
    expect(result.mappedTier).toBe(Tier.MEDIUM);
  });

  test('score between mediumComplex and complexReasoning → COMPLEX', () => {
    const score = (mediumComplex + complexReasoning) / 2;
    const result = mapToBoundary(score, null, false, 'test', cfg);
    expect(result.finalTier).toBe(Tier.COMPLEX);
    expect(result.mappedTier).toBe(Tier.COMPLEX);
  });

  test('score above complexReasoning → REASONING', () => {
    const score = complexReasoning + 0.1;
    const result = mapToBoundary(score, null, false, 'test', cfg);
    expect(result.finalTier).toBe(Tier.REASONING);
    expect(result.mappedTier).toBe(Tier.REASONING);
  });

  test('override tier replaces boundary-mapped tier', () => {
    const score = simpleMedium - 0.1; // would be SIMPLE
    const result = mapToBoundary(score, Tier.COMPLEX, false, 'test', cfg);
    expect(result.finalTier).toBe(Tier.COMPLEX);
    expect(result.mappedTier).toBe(Tier.SIMPLE);
  });

  test('structured output enforces MEDIUM minimum for SIMPLE', () => {
    const score = simpleMedium - 0.1; // would be SIMPLE
    const result = mapToBoundary(score, null, true, 'test', cfg);
    expect(result.finalTier).toBe(Tier.MEDIUM);
    expect(result.reasoning).toContain('structured output');
  });

  test('structured output does not downgrade COMPLEX', () => {
    const score = (mediumComplex + complexReasoning) / 2; // COMPLEX
    const result = mapToBoundary(score, null, true, 'test', cfg);
    expect(result.finalTier).toBe(Tier.COMPLEX);
  });
});

describe('calibrateConfidence', () => {
  test('distance=0 → confidence=0.5 (sigmoid midpoint)', () => {
    expect(calibrateConfidence(0, cfg.confidenceSteepness)).toBeCloseTo(0.5, 3);
  });

  test('large positive distance → high confidence (approaches 1.0)', () => {
    expect(calibrateConfidence(10, cfg.confidenceSteepness)).toBeGreaterThan(0.99);
  });

  test('large negative distance → low confidence (approaches 0.0)', () => {
    expect(calibrateConfidence(-10, cfg.confidenceSteepness)).toBeLessThan(0.01);
  });

  test('steepness controls sigmoid slope', () => {
    const lowSteep = calibrateConfidence(0.1, 1.0);
    const highSteep = calibrateConfidence(0.1, 10.0);
    expect(highSteep).toBeGreaterThan(lowSteep);
  });
});

describe('runPhase5', () => {
  test('high distance → high confidence, no tier change', () => {
    const result = runPhase5(2.0, null, Tier.COMPLEX, 'test', cfg);
    expect(result.tier).toBe(Tier.COMPLEX);
    expect(result.confidence).toBeGreaterThan(0.9);
  });

  test('override confidence applied when it exceeds computed value', () => {
    // Near-boundary → low computed confidence
    const result = runPhase5(0.0, 0.9, Tier.REASONING, 'test', cfg);
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
  });

  test('low confidence triggers ambiguity fallback to MEDIUM', () => {
    // distance=0 → confidence=0.5, below ambiguityThreshold=0.6
    const result = runPhase5(0.0, null, Tier.COMPLEX, 'test', cfg);
    expect(result.tier).toBe(cfg.ambiguousDefaultTier);
    expect(result.reasoning).toContain('low confidence');
  });

  test('confidence is reported as-is even with ambiguity fallback', () => {
    // Ambiguity fallback does NOT override the confidence value
    const result = runPhase5(0.0, null, Tier.COMPLEX, 'test', cfg);
    expect(result.confidence).toBeLessThan(cfg.ambiguityThreshold);
  });
});

describe('applyAgenticBoost', () => {
  test('no boost below threshold', () => {
    expect(applyAgenticBoost(Tier.SIMPLE, 0.5, 0.8)).toBe(Tier.SIMPLE);
  });

  test('boost at exact threshold (not strictly above) → no boost', () => {
    expect(applyAgenticBoost(Tier.SIMPLE, 0.8, 0.8)).toBe(Tier.SIMPLE);
  });

  test('boost above threshold promotes one tier', () => {
    expect(applyAgenticBoost(Tier.SIMPLE, 0.9, 0.8)).toBe(Tier.MEDIUM);
    expect(applyAgenticBoost(Tier.MEDIUM, 0.9, 0.8)).toBe(Tier.COMPLEX);
    expect(applyAgenticBoost(Tier.COMPLEX, 0.9, 0.8)).toBe(Tier.REASONING);
  });

  test('boost is capped at REASONING', () => {
    expect(applyAgenticBoost(Tier.REASONING, 1.0, 0.0)).toBe(Tier.REASONING);
  });

  test('HEARTBEAT is promoted to SIMPLE', () => {
    expect(applyAgenticBoost(Tier.HEARTBEAT, 1.0, 0.0)).toBe(Tier.SIMPLE);
  });
});
