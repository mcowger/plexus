import { describe, test, expect } from 'bun:test';
import {
  scoreTokenCount,
  scoreCodePresence,
  scoreReasoningMarkers,
  scoreMultiStepPatterns,
  scoreSimpleIndicators,
  scoreTechnicalTerms,
  scoreAgenticTask,
  scoreToolPresence,
  scoreQuestionComplexity,
  scoreCreativeMarkers,
  scoreConstraintCount,
  scoreOutputFormat,
  scoreConversationDepth,
  scoreImperativeVerbs,
  scoreReferenceComplexity,
  scoreNegationComplexity,
  hasArchitectureSignal,
} from '../../src/classifier/dimensions';
import { DEFAULT_CLASSIFIER_CONFIG } from '../../src/classifier/config';

const cfg = DEFAULT_CLASSIFIER_CONFIG;

describe('scoreTokenCount', () => {
  test('very short (<50): score -0.5', () => {
    const r = scoreTokenCount(10, cfg);
    expect(r.score).toBe(-0.5);
    expect(r.signal).toBe('tokens:very-short');
  });

  test('neutral (50-200): score 0', () => {
    const r = scoreTokenCount(100, cfg);
    expect(r.score).toBe(0);
    expect(r.signal).toBeNull();
  });

  test('moderate (200-500): score 0.3', () => {
    const r = scoreTokenCount(300, cfg);
    expect(r.score).toBe(0.3);
    expect(r.signal).toBe('tokens:moderate');
  });

  test('long (500-2000): score 0.5', () => {
    const r = scoreTokenCount(1000, cfg);
    expect(r.score).toBe(0.5);
    expect(r.signal).toBe('tokens:long');
  });

  test('very long (>2000): score 1.0', () => {
    const r = scoreTokenCount(5000, cfg);
    expect(r.score).toBe(1.0);
    expect(r.signal).toBe('tokens:very-long');
  });
});

describe('scoreCodePresence', () => {
  test('no code signals: score 0', () => {
    const r = scoreCodePresence('hello world', cfg);
    expect(r.score).toBe(0);
    expect(r.signal).toBeNull();
  });

  test('1-2 code signals: score 0.5', () => {
    const r = scoreCodePresence('write a function to sort', cfg);
    expect(r.score).toBe(0.5);
    expect(r.signal).toContain('code-keywords');
  });

  test('3+ code signals: score 1.0', () => {
    const r = scoreCodePresence('async function class import const', cfg);
    expect(r.score).toBe(1.0);
    expect(r.signal).toContain('code-keywords');
  });

  test('code block (backticks): counts as signal', () => {
    const r = scoreCodePresence('here is some code:\n```python\nprint("hi")\n```', cfg);
    // backticks + code block content
    expect(r.score).toBeGreaterThan(0);
  });
});

describe('scoreReasoningMarkers', () => {
  test('0 matches: score 0', () => {
    const r = scoreReasoningMarkers('what is 2+2', cfg);
    expect(r.score).toBe(0);
    expect(r.signal).toBeNull();
    expect(r.reasoningMatches).toBe(0);
  });

  test('1 match: score 0.5', () => {
    const r = scoreReasoningMarkers('please prove this claim', cfg);
    expect(r.score).toBe(0.5);
    expect(r.signal).toBe('reasoning-markers:1');
    expect(r.reasoningMatches).toBe(1);
  });

  test('2+ matches: score 1.0', () => {
    const r = scoreReasoningMarkers('prove this theorem step by step', cfg);
    expect(r.score).toBe(1.0);
    expect(r.reasoningMatches).toBeGreaterThanOrEqual(2);
  });
});

describe('scoreMultiStepPatterns', () => {
  test('0 patterns: score 0', () => {
    const r = scoreMultiStepPatterns('just do this one thing', cfg);
    expect(r.score).toBe(0);
    expect(r.signal).toBeNull();
  });

  test('1 pattern: score 0.4', () => {
    const r = scoreMultiStepPatterns('first do X, then do Y', cfg);
    expect(r.score).toBe(0.4);
    expect(r.signal).toBe('multi-step:1');
  });

  test('2 patterns: score 0.7', () => {
    // "first...then" + "finally"
    const r = scoreMultiStepPatterns('first do X, then do Y, and finally do Z', cfg);
    expect(r.score).toBe(0.7);
  });

  test('3+ patterns: score 1.0', () => {
    // step 1, step 2, "first...then", "finally"
    const r = scoreMultiStepPatterns(
      'step 1: do X. step 2: do Y. first do A, then do B. And finally C.',
      cfg
    );
    expect(r.score).toBe(1.0);
  });
});

describe('scoreSimpleIndicators', () => {
  test('0 matches: score 0', () => {
    const r = scoreSimpleIndicators('design a complex system', cfg);
    expect(r.score).toBe(0);
    expect(r.signal).toBeNull();
  });

  test('1-2 matches: score -0.5 (negative)', () => {
    const r = scoreSimpleIndicators('what is the capital of france?', cfg);
    expect(r.score).toBeLessThan(0);
  });

  test('3+ matches: score -1.0', () => {
    const r = scoreSimpleIndicators('what is the define translate hello', cfg);
    expect(r.score).toBe(-1.0);
  });
});

describe('scoreTechnicalTerms', () => {
  test('0 matches: score 0', () => {
    const r = scoreTechnicalTerms('write a story about cats', cfg);
    expect(r.score).toBe(0);
  });

  test('1-2 matches: score 0.3', () => {
    const r = scoreTechnicalTerms('optimize this database query', cfg);
    expect(r.score).toBe(0.3);
  });

  test('3-5 matches: score 0.6', () => {
    // "optimize", "database", "algorithm" = 3 matches
    const r = scoreTechnicalTerms('optimize the database algorithm for caching', cfg);
    expect(r.score).toBe(0.6);
  });

  test('6+ matches: score 0.8', () => {
    // "optimize", "database", "algorithm", "distributed", "microservice", "architecture" = 6 matches
    const r = scoreTechnicalTerms(
      'optimize the database algorithm for distributed microservice architecture',
      cfg
    );
    expect(r.score).toBe(0.8);
  });
});

describe('scoreAgenticTask', () => {
  test('0 matches: score 0, agenticScore 0', () => {
    const r = scoreAgenticTask('what is 2+2', cfg);
    expect(r.score).toBe(0);
    expect(r.agenticScore).toBe(0);
    expect(r.signal).toBeNull();
  });

  test('1-2 matches: score 0.3, agenticScore 0.2', () => {
    const r = scoreAgenticTask('please fix this bug', cfg);
    expect(r.score).toBe(0.3);
    expect(r.agenticScore).toBe(0.2);
  });

  test('4+ matches: score 1.0, agenticScore 1.0', () => {
    const r = scoreAgenticTask('execute deploy install npm compile fix debug verify confirm', cfg);
    expect(r.score).toBe(1.0);
    expect(r.agenticScore).toBe(1.0);
  });
});

describe('scoreToolPresence', () => {
  test('no tools: score 0', () => {
    const r = scoreToolPresence(false, false, 0);
    expect(r.score).toBe(0);
    expect(r.signal).toBeNull();
    expect(r.updatedAgenticScore).toBe(0);
  });

  test('tools present, no explicit choice: score 0.6', () => {
    const r = scoreToolPresence(true, false, 0);
    expect(r.score).toBe(0.6);
    expect(r.signal).toBe('tools-present');
    // Sets baseline agentic score if it was 0
    expect(r.updatedAgenticScore).toBe(0.3);
  });

  test('tools with explicit choice: score 1.0', () => {
    const r = scoreToolPresence(true, true, 0);
    expect(r.score).toBe(1.0);
    expect(r.signal).toBe('tools-with-explicit-choice');
  });

  test('does not override existing agenticScore > 0', () => {
    const r = scoreToolPresence(true, false, 0.8);
    expect(r.updatedAgenticScore).toBe(0.8);
  });
});

describe('scoreQuestionComplexity', () => {
  test('0 questions: score 0', () => {
    const r = scoreQuestionComplexity('write a function', cfg);
    expect(r.score).toBe(0);
    expect(r.signal).toBeNull();
  });

  test('1 question: score -0.3 (simplicity signal)', () => {
    const r = scoreQuestionComplexity('what is 2+2?', cfg);
    expect(r.score).toBe(-0.3);
    expect(r.signal).toBe('questions:single');
  });

  test('2-3 questions: score 0.3', () => {
    const r = scoreQuestionComplexity('what is A? what is B?', cfg);
    expect(r.score).toBe(0.3);
  });

  test('4+ questions: score 0.7', () => {
    const r = scoreQuestionComplexity('A? B? C? D? E?', cfg);
    expect(r.score).toBe(0.7);
  });
});

describe('scoreOutputFormat', () => {
  test('no format: score 0, hasStructuredOutput false', () => {
    const r = scoreOutputFormat('tell me a story', undefined, cfg);
    expect(r.score).toBe(0);
    expect(r.hasStructuredOutput).toBe(false);
    expect(r.signal).toBeNull();
  });

  test('response_format json_object: score 0.8, hasStructuredOutput true', () => {
    const r = scoreOutputFormat('return data', { type: 'json_object' }, cfg);
    expect(r.score).toBe(0.8);
    expect(r.hasStructuredOutput).toBe(true);
    expect(r.signal).toBe('output-format:api-response-format');
  });

  test('1 format keyword: score 0.3', () => {
    const r = scoreOutputFormat('return the result as json', undefined, cfg);
    expect(r.score).toBe(0.3);
    expect(r.hasStructuredOutput).toBe(true);
  });

  test('2+ format keywords: score 0.6', () => {
    const r = scoreOutputFormat('return the result as json in a structured table', undefined, cfg);
    expect(r.score).toBe(0.6);
  });
});

describe('scoreConversationDepth', () => {
  test('1-2 messages: score 0', () => {
    expect(scoreConversationDepth(1, cfg).score).toBe(0);
    expect(scoreConversationDepth(2, cfg).score).toBe(0);
  });

  test('3-6 messages: score 0.2', () => {
    expect(scoreConversationDepth(4, cfg).score).toBe(0.2);
  });

  test('7-12 messages: score 0.5', () => {
    expect(scoreConversationDepth(10, cfg).score).toBe(0.5);
  });

  test('13+ messages: score 0.7', () => {
    expect(scoreConversationDepth(20, cfg).score).toBe(0.7);
  });
});

describe('scoreNegationComplexity', () => {
  test('0 negations: score 0', () => {
    const r = scoreNegationComplexity('do this thing', cfg);
    expect(r.score).toBe(0);
    expect(r.signal).toBeNull();
  });

  test('1 negation: score 0.1', () => {
    const r = scoreNegationComplexity("don't use loops", cfg);
    expect(r.score).toBeCloseTo(0.1);
  });

  test('capped at 0.3', () => {
    const r = scoreNegationComplexity(
      "don't use loops, avoid recursion, never use globals, without exceptions",
      cfg
    );
    expect(r.score).toBe(0.3);
  });
});

describe('scoreReferenceComplexity', () => {
  test('0 references: score 0', () => {
    const r = scoreReferenceComplexity('just do this', cfg);
    expect(r.score).toBe(0);
    expect(r.signal).toBeNull();
  });

  test('1 reference: score 0.2', () => {
    // "above" = 1 match
    const r = scoreReferenceComplexity('refer to the section above', cfg);
    expect(r.score).toBeCloseTo(0.2, 5);
  });

  test('capped at 0.5', () => {
    const r = scoreReferenceComplexity(
      'see above, below, earlier, the docs, the api, the code, attached',
      cfg
    );
    expect(r.score).toBe(0.5);
  });
});

describe('hasArchitectureSignal', () => {
  test('returns true when both noun and verb present', () => {
    expect(hasArchitectureSignal('design a microservices architecture')).toBe(true);
  });

  test('returns false with only noun', () => {
    expect(hasArchitectureSignal('what is a microservice')).toBe(false);
  });

  test('returns false with only verb', () => {
    expect(hasArchitectureSignal('design a simple app')).toBe(false);
  });
});
