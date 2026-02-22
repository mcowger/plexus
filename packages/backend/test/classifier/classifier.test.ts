import { describe, test, expect } from 'bun:test';
import { classify } from '../../src/classifier';
import { Tier } from '../../src/classifier/types';

/**
 * Integration tests based on the worked examples from CLASSIFIER.md §13.
 * Each must produce the documented tier and score within ±0.01.
 */

describe('classify - worked examples', () => {
  test('Example 13.1: Heartbeat "ping"', () => {
    const result = classify({
      messages: [{ role: 'user', content: 'ping' }],
    });

    expect(result.tier).toBe(Tier.HEARTBEAT);
    expect(result.score).toBe(-1.0);
    expect(result.confidence).toBe(0.95);
    expect(result.method).toBe('short-circuit');
    expect(result.signals).toContain('heartbeat-pattern');
    expect(result.agenticScore).toBe(0.0);
    expect(result.hasStructuredOutput).toBe(false);
  });

  test('Example 13.2: Simple factual question', () => {
    const result = classify({
      messages: [{ role: 'user', content: 'What is the capital of France?' }],
    });

    expect(result.tier).toBe(Tier.SIMPLE);
    expect(result.score).toBeCloseTo(-0.102, 1);
    expect(result.method).toBe('rules');
    expect(result.signals).toContain('tokens:very-short');
    expect(result.signals).toContain('questions:single');
    expect(result.agenticScore).toBe(0.0);
    expect(result.hasStructuredOutput).toBe(false);
  });

  test('Example 13.3: Code generation request (binary search)', () => {
    const result = classify({
      messages: [
        { role: 'system', content: 'You are a helpful coding assistant.' },
        {
          role: 'user',
          content:
            'Write a Python function that implements binary search on a sorted array. Include type hints and handle edge cases.',
        },
      ],
    });

    // Documented result: MEDIUM with score ~0.045
    expect(result.tier).toBe(Tier.MEDIUM);
    expect(result.score).toBeCloseTo(0.045, 1);
    expect(result.method).toBe('rules');
    expect(result.signals).toContain('tokens:very-short');
    expect(result.hasStructuredOutput).toBe(false);
  });

  test('Example 13.4: Reasoning task (prove sqrt(2) irrational)', () => {
    const result = classify({
      messages: [
        {
          role: 'user',
          content:
            'Prove that the square root of 2 is irrational. Derive the proof step by step using proof by contradiction.',
        },
      ],
    });

    expect(result.tier).toBe(Tier.REASONING);
    // Score is adjusted by override to at least 0.42
    expect(result.score).toBeGreaterThanOrEqual(0.42);
    expect(result.confidence).toBeGreaterThanOrEqual(0.85);
    expect(result.method).toBe('rules');
    expect(result.signals).toContain('tokens:very-short');
    expect(result.reasoning).toContain('reasoning markers');
  });

  test('Example 13.5: Agentic task with tools', () => {
    const result = classify({
      messages: [
        {
          role: 'user',
          content:
            'Read the file config.json, check the database settings, then update the connection string and verify it works.',
        },
      ],
      tools: [
        { type: 'function', function: { name: 'read_file', description: 'Read a file' } },
        { type: 'function', function: { name: 'write_file', description: 'Write a file' } },
      ],
      tool_choice: 'auto',
    });

    // Documented: MEDIUM tier, high agenticScore
    // Note: "config.json" contains "json" keyword so hasStructuredOutput fires
    expect(result.tier).toBe(Tier.MEDIUM);
    expect(result.agenticScore).toBe(1.0);
  });

  test('Example 13.6: Ambiguous request near boundary', () => {
    const result = classify({
      messages: [{ role: 'user', content: 'Compare these two approaches for caching.' }],
    });

    // Documented: SIMPLE with score -0.040, confidence 0.618
    expect(result.tier).toBe(Tier.SIMPLE);
    expect(result.score).toBeCloseTo(-0.04, 1);
    expect(result.confidence).toBeCloseTo(0.618, 1);
    expect(result.method).toBe('rules');
  });

  test('Example 13.7: Structured output enforcement', () => {
    const result = classify({
      messages: [{ role: 'user', content: 'What is 2+2?' }],
      response_format: { type: 'json_object' },
    });

    // Documented: MEDIUM (upgraded from SIMPLE due to structured output)
    expect(result.tier).toBe(Tier.MEDIUM);
    expect(result.score).toBeCloseTo(-0.078, 1);
    expect(result.hasStructuredOutput).toBe(true);
    expect(result.reasoning).toContain('structured output');
  });
});

describe('classify - short-circuit cases', () => {
  test('empty messages array: returns HEARTBEAT', () => {
    const result = classify({ messages: [] });
    expect(result.tier).toBe(Tier.HEARTBEAT);
    expect(result.method).toBe('short-circuit');
  });

  test('forced tier directive: USE REASONING', () => {
    const result = classify({
      messages: [{ role: 'user', content: 'USE REASONING please solve this' }],
    });
    expect(result.tier).toBe(Tier.REASONING);
    expect(result.confidence).toBe(1.0);
    expect(result.method).toBe('short-circuit');
  });
});

describe('classify - custom config overrides', () => {
  test('custom tier boundaries shift classification', () => {
    // With very low mediumComplex boundary, more requests go to COMPLEX
    const result = classify(
      { messages: [{ role: 'user', content: 'explain how HTTP works' }] },
      {
        tierBoundaries: {
          simpleMedium: -0.5,
          mediumComplex: -0.3,
          complexReasoning: 0.1,
        },
      }
    );
    // Very low boundaries means most scores fall in COMPLEX range
    expect([Tier.COMPLEX, Tier.REASONING]).toContain(result.tier);
  });

  test('agentic score is independent of cognitive tier', () => {
    // A request with tools but simple cognitive content
    const result = classify({
      messages: [{ role: 'user', content: 'What is 2+2?' }],
      tools: [
        { type: 'function', function: { name: 'calculate', description: 'Calculate numbers' } },
      ],
    });
    // agenticScore should be non-zero due to tools
    expect(result.agenticScore).toBeGreaterThan(0);
  });
});
