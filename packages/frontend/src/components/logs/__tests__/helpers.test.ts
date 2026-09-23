import { describe, expect, it } from 'vitest';
import { getAttemptIndicatorLabel } from '../helpers';

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
