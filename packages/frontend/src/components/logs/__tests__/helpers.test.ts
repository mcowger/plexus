import { describe, expect, it } from 'vitest';
import { getAttemptIndicatorLabel, hasUpstreamRewrite, isDecisionsApiType } from '../helpers';

describe('isDecisionsApiType', () => {
  it('recognizes the decisions ingress type', () => {
    expect(isDecisionsApiType('decisions')).toBe(true);
  });

  it('recognizes decisions target protocols', () => {
    expect(isDecisionsApiType('systemone')).toBe(true);
    expect(isDecisionsApiType('openrouter-decisions')).toBe(true);
    expect(isDecisionsApiType('typesafe-decisions')).toBe(true);
  });

  it('ignores subtypes and casing', () => {
    expect(isDecisionsApiType('Decisions:V2')).toBe(true);
  });

  it('returns false for other and missing api types', () => {
    expect(isDecisionsApiType('embeddings')).toBe(false);
    expect(isDecisionsApiType('messages')).toBe(false);
    expect(isDecisionsApiType(undefined)).toBe(false);
    expect(isDecisionsApiType(null)).toBe(false);
  });
});

describe('getAttemptIndicatorLabel', () => {
  it('omits the indicator for one attempt even when the model is rewritten upstream', () => {
    expect(getAttemptIndicatorLabel(1)).toBeNull();
  });

  it('labels actual retries by their attempt count', () => {
    expect(getAttemptIndicatorLabel(3)).toBe('3x');
  });

  it('omits the indicator when the attempt count is missing', () => {
    expect(getAttemptIndicatorLabel()).toBeNull();
  });
});

describe('hasUpstreamRewrite', () => {
  it('compares the upstream model to the final route model', () => {
    expect(
      hasUpstreamRewrite({
        finalAttemptModel: 'route-model',
        selectedModelName: 'selected-model',
        upstreamModel: 'upstream-model',
      })
    ).toBe(true);
  });

  it('falls back to the selected model when no final route model is available', () => {
    expect(
      hasUpstreamRewrite({
        selectedModelName: 'route-model',
        upstreamModel: 'upstream-model',
      })
    ).toBe(true);
  });

  it('returns false when the upstream model is missing or unchanged', () => {
    expect(hasUpstreamRewrite({ finalAttemptModel: 'route-model' })).toBe(false);
    expect(
      hasUpstreamRewrite({
        finalAttemptModel: 'route-model',
        upstreamModel: 'route-model',
      })
    ).toBe(false);
  });
});
