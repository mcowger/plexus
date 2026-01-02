import { describe, expect, it } from 'bun:test';
import { RandomSelector } from '../random';
import { ModelTarget } from '../../../config';

describe('RandomSelector', () => {
  const selector = new RandomSelector();

  it('should return null for empty targets', () => {
    expect(selector.select([])).toBeNull();
  });

  it('should return the single target if only one exists', () => {
    const targets: ModelTarget[] = [{ provider: 'p1', model: 'm1' }];
    expect(selector.select(targets)).toEqual(targets[0] || null);
  });

  it('should return a valid target from a list', () => {
    const targets: ModelTarget[] = [
      { provider: 'p1', model: 'm1' },
      { provider: 'p2', model: 'm2' },
      { provider: 'p3', model: 'm3' },
    ];
    const selected = selector.select(targets);
    expect(selected).not.toBeNull();
    expect(targets).toContain(selected!);
  });
});
