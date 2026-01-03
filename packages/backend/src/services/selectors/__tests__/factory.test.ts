import { describe, expect, it } from 'bun:test';
import { SelectorFactory } from '../factory';
import { RandomSelector } from '../random';
import { CostSelector } from '../cost';

describe('SelectorFactory', () => {
  it('should return RandomSelector for "random"', () => {
    const selector = SelectorFactory.getSelector('random');
    expect(selector).toBeInstanceOf(RandomSelector);
  });

  it('should return RandomSelector for undefined', () => {
    const selector = SelectorFactory.getSelector(undefined);
    expect(selector).toBeInstanceOf(RandomSelector);
  });

  it('should return RandomSelector for null', () => {
    // @ts-ignore - explicitly testing null if somehow passed from loose types
    const selector = SelectorFactory.getSelector(null);
    expect(selector).toBeInstanceOf(RandomSelector);
  });

  it('should return CostSelector for "cost"', () => {
    const selector = SelectorFactory.getSelector('cost');
    expect(selector).toBeInstanceOf(CostSelector);
  });

  it('should throw for unknown selector', () => {
    expect(() => SelectorFactory.getSelector('unknown')).toThrow("Unknown selector type: unknown");
  });

  it('should throw for unimplemented selectors', () => {
     expect(() => SelectorFactory.getSelector('latency')).toThrow("Selector 'latency' not implemented yet");
     expect(() => SelectorFactory.getSelector('usage')).toThrow("Selector 'usage' not implemented yet");
  });
});
