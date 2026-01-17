import { describe, expect, it } from 'bun:test';
import { InOrderSelector } from '../in-order';
import { ModelTarget } from '../../../config';

describe('InOrderSelector', () => {
  const selector = new InOrderSelector();

  it('should return null for empty targets', () => {
    expect(selector.select([])).toBeNull();
  });

  it('should return the single target if only one exists', () => {
    const targets: ModelTarget[] = [{ provider: 'p1', model: 'm1' }];
    expect(selector.select(targets)).toEqual(targets[0] || null);
  });

  it('should return the first target from a list', () => {
    const targets: ModelTarget[] = [
      { provider: 'p1', model: 'm1' },
      { provider: 'p2', model: 'm2' },
      { provider: 'p3', model: 'm3' },
    ];
    const selected = selector.select(targets);
    expect(selected).toEqual(targets[0] ?? null);
  });

  it('should always return the first target in defined order', () => {
    const targets: ModelTarget[] = [
      { provider: 'kilo', model: 'minimax/minimax-m2.1' },
      { provider: 'naga', model: 'minimax-m2.1' },
      { provider: 'synthetic', model: 'hf:MiniMaxAI/MiniMax-M2.1' },
    ];
    // Call multiple times to ensure consistent ordering
    for (let i = 0; i < 5; i++) {
      expect(selector.select(targets)).toEqual(targets[0] ?? null);
    }
  });
});
