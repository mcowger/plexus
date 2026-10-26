import { describe, expect, it } from 'bun:test';

import { setFirstPricingCutoff } from '../metadataPricing';

describe('setFirstPricingCutoff', () => {
  it('adds a cutoff without requiring prices', () => {
    expect(setFirstPricingCutoff(undefined, 200_000)).toEqual([{ input_tokens_above: 200_000 }]);
    expect(setFirstPricingCutoff(undefined, 0)).toEqual([{ input_tokens_above: 0 }]);
  });

  it('preserves the first tier rates and all later tiers', () => {
    const tiers = [
      { input_tokens_above: 200_000, prompt: '0.000006', completion: '0.00003' },
      { input_tokens_above: 500_000, input_cache_read: '0.000001' },
    ];
    expect(setFirstPricingCutoff(tiers, 250_000)).toEqual([
      { input_tokens_above: 250_000, prompt: '0.000006', completion: '0.00003' },
      tiers[1],
    ]);
    expect(tiers[0].input_tokens_above).toBe(200_000);
  });

  it('removes only the first tier when cleared', () => {
    const second = { input_tokens_above: 500_000, prompt: '0.00001' };
    expect(setFirstPricingCutoff([{ input_tokens_above: 200_000 }, second], undefined)).toEqual([
      second,
    ]);
    expect(setFirstPricingCutoff([{ input_tokens_above: 200_000 }], undefined)).toBeUndefined();
    expect(setFirstPricingCutoff(undefined, undefined)).toBeUndefined();
  });
});
