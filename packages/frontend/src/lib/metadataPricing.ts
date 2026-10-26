import type { MetadataPricingTier } from '../types/aliases';

/** Update the first pricing cutoff without discarding other tiers or their rates. */
export function setFirstPricingCutoff(
  tiers: MetadataPricingTier[] | undefined,
  cutoff: number | undefined
): MetadataPricingTier[] | undefined {
  if (cutoff === undefined) {
    const remaining = tiers?.slice(1);
    return remaining?.length ? remaining : undefined;
  }
  return [{ ...tiers?.[0], input_tokens_above: cutoff }, ...(tiers?.slice(1) ?? [])];
}
