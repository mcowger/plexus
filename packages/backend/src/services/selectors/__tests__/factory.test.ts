import { describe, expect, it, vi, beforeEach } from 'vitest';
import { SelectorFactory } from '../factory';
import { RandomSelector } from '../random';
import { CostSelector } from '../cost';
import { PerformanceSelector } from '../performance';
import { E2EPerformanceSelector } from '../e2e-performance';
import { LatencySelector } from '../latency';
import { InOrderSelector } from '../in-order';
import { UsageSelector } from '../usage';
import { UsageStorageService } from '../../usage-storage';

describe('SelectorFactory', () => {
  const mockStorage = {} as unknown as UsageStorageService;

  beforeEach(() => {
    SelectorFactory.setUsageStorage(mockStorage);
  });

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

  it('should return InOrderSelector for "in_order"', () => {
    const selector = SelectorFactory.getSelector('in_order');
    expect(selector).toBeInstanceOf(InOrderSelector);
  });

  it('should return PerformanceSelector for "performance"', () => {
    const selector = SelectorFactory.getSelector('performance');
    expect(selector).toBeInstanceOf(PerformanceSelector);
  });

  it('should return LatencySelector for "latency"', () => {
    const selector = SelectorFactory.getSelector('latency');
    expect(selector).toBeInstanceOf(LatencySelector);
  });

  it('should return E2EPerformanceSelector for "e2e_performance"', () => {
    const selector = SelectorFactory.getSelector('e2e_performance');
    expect(selector).toBeInstanceOf(E2EPerformanceSelector);
  });

  it('should throw for unknown selector', () => {
    expect(() => SelectorFactory.getSelector('unknown')).toThrow('Unknown selector type: unknown');
  });

  it('should return UsageSelector for "usage"', () => {
    const selector = SelectorFactory.getSelector('usage');
    expect(selector).toBeInstanceOf(UsageSelector);
  });
});
