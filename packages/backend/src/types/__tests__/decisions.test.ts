import { describe, expect, it, test } from 'bun:test';

import {
  DecisionsIngressSchema,
  MAX_DECISIONS_CHOICE_OPTIONS,
  MAX_DECISIONS_SCORE_LEVELS,
  MIN_DECISIONS_SCORE_LEVELS,
  parseDecisionsUpstreamResponse,
} from '../decisions';

const NOUL = { type: 'noul', instructions: 'Is it urgent?' } as const;
const CHOICE = {
  type: 'choice',
  instructions: 'Which team?',
  criteria: { billing: 'Payments', technical: 'Bugs' },
} as const;
const SCORE = {
  type: 'score',
  instructions: 'How angry?',
  criteria: ['Calm', 'Angry'],
} as const;

function ingress(overrides: Record<string, any> = {}) {
  return {
    model: 'decisions-alias',
    state: 'My checkout is broken',
    questions: { is_bug: { ...NOUL }, team: { ...CHOICE }, urgency: { ...SCORE } },
    ...overrides,
  };
}

describe('Decisions ingress validation', () => {
  test('accepts all question forms with string state', () => {
    const parsed = DecisionsIngressSchema.safeParse(ingress());
    expect(parsed.success).toBe(true);
  });

  test('accepts object and array state', () => {
    expect(DecisionsIngressSchema.safeParse(ingress({ state: { ticket: 'broken' } })).success).toBe(
      true
    );
    expect(DecisionsIngressSchema.safeParse(ingress({ state: [1, 2, 3] })).success).toBe(true);
  });

  test('accepts structured instructions and criteria', () => {
    const parsed = DecisionsIngressSchema.safeParse(
      ingress({
        questions: {
          dup: {
            type: 'noul',
            instructions: {
              candidate: { name: 'John' },
              question: 'Is this the same person as `candidate`?',
            },
          },
          team: {
            type: 'choice',
            instructions: ['Which team?', { ticket: 'broken checkout' }],
            criteria: { billing: { desc: 'Payments', weight: 2 }, sales: null },
          },
        },
      })
    );
    expect(parsed.success).toBe(true);
  });

  test('accepts noul questions without criteria and rejects partial criteria', () => {
    expect(DecisionsIngressSchema.safeParse(ingress()).success).toBe(true);
    const partial = DecisionsIngressSchema.safeParse(
      ingress({ questions: { q: { type: 'noul', instructions: 'x', criteria: { true: 'yes' } } } })
    );
    expect(partial.success).toBe(false);
  });

  test('accepts OpenRouter-only routing and observability fields', () => {
    const parsed = DecisionsIngressSchema.safeParse(
      ingress({
        provider: { only: ['TypeSafe'] },
        session_id: 'session-1234',
        trace: { trace_id: 't' },
        user: 'end-user',
      })
    );
    expect(parsed.success).toBe(true);
  });

  test('explicitly rejects streaming instead of stripping it', () => {
    const parsed = DecisionsIngressSchema.safeParse(ingress({ stream: true }));
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((issue) => issue.path.join('.') === 'stream')).toBe(true);
    }
  });

  test('rejects empty model, missing state, and empty questions', () => {
    expect(DecisionsIngressSchema.safeParse(ingress({ model: '' })).success).toBe(false);
    expect(DecisionsIngressSchema.safeParse(ingress({ model: '  ' })).success).toBe(false);
    const { state: _dropped, ...noState } = ingress();
    expect(DecisionsIngressSchema.safeParse(noState).success).toBe(false);
    expect(DecisionsIngressSchema.safeParse(ingress({ questions: {} })).success).toBe(false);
  });

  test('enforces choice option and score level limits', () => {
    const manyOptions = Object.fromEntries(
      Array.from({ length: MAX_DECISIONS_CHOICE_OPTIONS + 1 }, (_, i) => [`opt${i}`, 'desc'])
    );
    expect(
      DecisionsIngressSchema.safeParse(
        ingress({ questions: { q: { type: 'choice', instructions: 'x', criteria: manyOptions } } })
      ).success
    ).toBe(false);

    expect(
      DecisionsIngressSchema.safeParse(
        ingress({ questions: { q: { type: 'score', instructions: 'x', criteria: ['only'] } } })
      ).success
    ).toBe(false);
    expect(
      DecisionsIngressSchema.safeParse(
        ingress({
          questions: {
            q: {
              type: 'score',
              instructions: 'x',
              criteria: Array.from({ length: MAX_DECISIONS_SCORE_LEVELS + 1 }, (_, i) => `L${i}`),
            },
          },
        })
      ).success
    ).toBe(false);
    expect(
      DecisionsIngressSchema.safeParse(
        ingress({
          questions: {
            q: {
              type: 'score',
              instructions: 'x',
              criteria: Array.from({ length: MIN_DECISIONS_SCORE_LEVELS }, (_, i) => `L${i}`),
            },
          },
        })
      ).success
    ).toBe(true);
  });
});

describe('Decisions upstream response boundary', () => {
  test('preserves OpenRouter optional fields', () => {
    const body = {
      model: 'typesafe/jev-1.13-20260917',
      answers: {
        is_bug: { type: 'noul', noul: 0.96 },
        team: {
          type: 'choice',
          choice: 'billing',
          probabilities: { billing: 0.88, technical: 0.12 },
          confidence: 0.75,
        },
        urgency: {
          type: 'score',
          score: 1.99,
          legend: { 0: 'wait', 1: 'week', 2: 'now' },
          probabilities: { 0: 0, 1: 0.01, 2: 0.99 },
          confidence: 0.99,
        },
      },
      id: 'gen-dec-1',
      provider: 'TypeSafe',
      usage: { input_tokens: 476, output_tokens: 70, cost: 0.000019992 },
    };
    expect(parseDecisionsUpstreamResponse(body)).toEqual<unknown>(body);
  });

  test('accepts minimal TypeSafe answers without optional fields', () => {
    const parsed = parseDecisionsUpstreamResponse({
      model: 'jev-1.13.0',
      answers: { is_urgent: { type: 'noul', noul: 0.95 } },
      usage: { input_tokens: 296, output_tokens: 20 },
    });
    expect(parsed.id).toBeUndefined();
    expect(parsed.provider).toBeUndefined();
    expect(parsed.usage.cost).toBeUndefined();
  });

  test('rejects unusable upstream payloads with a 502 routing context', () => {
    for (const body of [
      null,
      {},
      { model: 'm', usage: { input_tokens: 1, output_tokens: 1 } },
      { model: 'm', answers: {}, usage: { input_tokens: 1, output_tokens: 1 } },
      {
        model: 'm',
        answers: { q: { type: 'noul' } },
        usage: { input_tokens: 1, output_tokens: 1 },
      },
      {
        model: 'm',
        answers: { q: { type: 'choice', choice: 'a' }, extra: { type: 'bogus' } },
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    ]) {
      try {
        parseDecisionsUpstreamResponse(body);
        expect.unreachable(`should have thrown for ${JSON.stringify(body)}`);
      } catch (error: any) {
        expect(error.routingContext?.statusCode).toBe(502);
      }
    }
  });
});
