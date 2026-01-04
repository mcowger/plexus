import { describe, expect, it } from 'bun:test';
import { CostSelector } from '../cost';
import { EnrichedModelTarget } from '../base';

describe('CostSelector', () => {
  const selector = new CostSelector();

  it('should return null for empty targets', () => {
    expect(selector.select([])).toBeNull();
  });

  it('should return the single target if only one exists', () => {
    const targets: EnrichedModelTarget[] = [{ 
      provider: 'p1', 
      model: 'm1',
      route: {
        modelConfig: {
          pricing: {
            source: 'simple',
            input: 1.0,
            output: 2.0
          }
        }
      }
    }];
    expect(selector.select(targets)).toEqual(targets[0] || null);
  });

  it('should select the cheapest target with simple pricing', () => {
    const targets: EnrichedModelTarget[] = [
      { 
        provider: 'p1', 
        model: 'm1',
        route: {
          modelConfig: {
            pricing: {
              source: 'simple',
              input: 5.0,
              output: 10.0
            }
          }
        }
      },
      { 
        provider: 'p2', 
        model: 'm2',
        route: {
          modelConfig: {
            pricing: {
              source: 'simple',
              input: 1.0,
              output: 2.0
            }
          }
        }
      },
      { 
        provider: 'p3', 
        model: 'm3',
        route: {
          modelConfig: {
            pricing: {
              source: 'simple',
              input: 3.0,
              output: 6.0
            }
          }
        }
      }
    ];
    const selected = selector.select(targets);
    expect(selected).toBe(targets[1] ?? null); // p2/m2 is cheapest
  });

  it('should handle targets with no pricing information', () => {
    const targets: EnrichedModelTarget[] = [
      { 
        provider: 'p1', 
        model: 'm1',
        route: {
          modelConfig: {
            pricing: {
              source: 'simple',
              input: 5.0,
              output: 10.0
            }
          }
        }
      },
      { 
        provider: 'p2', 
        model: 'm2'
      }
    ];
    const selected = selector.select(targets);
    expect(selected).toBe(targets[1] ?? null); // p2/m2 has no pricing (cost 0)
  });

  it('should handle default pricing', () => {
    const targets: EnrichedModelTarget[] = [
      { 
        provider: 'p1', 
        model: 'm1',
        route: {
          modelConfig: {
            pricing: {
              source: 'default',
              input: 2.0,
              output: 4.0
            }
          }
        }
      },
      { 
        provider: 'p2', 
        model: 'm2',
        route: {
          modelConfig: {
            pricing: {
              source: 'simple',
              input: 1.0,
              output: 2.0
            }
          }
        }
      }
    ];
    const selected = selector.select(targets);
    expect(selected).toBe(targets[1] ?? null); // p2/m2 is cheaper
  });
});
