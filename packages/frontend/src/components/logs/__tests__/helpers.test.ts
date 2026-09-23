import { describe, expect, it } from 'vitest';
import { getAttemptIndicatorLabel, hasUpstreamRewrite } from '../helpers';

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
