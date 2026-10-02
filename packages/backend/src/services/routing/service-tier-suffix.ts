/**
 * Service-tier model-name suffix.
 *
 * `<alias>@<tier>` selects an OpenAI service tier from the model name, for clients that cannot set
 * `service_tier` on the request themselves: `gpt-6-luna@flex`, `gpt-6-luna@priority`.
 *
 * This module is purely syntactic. Whether the bare name is a real alias is a routing decision and
 * lives in `Router.splitServiceTier`, which is the entry point the dispatcher uses.
 */

export const SERVICE_TIER_SUFFIX_DELIMITER = '@';

/**
 * Service-tier suffix vocabulary. `default` and `standard` name the same tier; so do `priority`
 * and `fast`. `ultrafast` is the fastest tier above `priority`.
 */
export const SERVICE_TIER_SUFFIXES = [
  'auto',
  'default',
  'standard',
  'flex',
  'priority',
  'fast',
  'ultrafast',
] as const;

export type ServiceTierSuffix = (typeof SERVICE_TIER_SUFFIXES)[number];

export interface ServiceTierSplit {
  /** The model name with any recognised tier suffix removed. */
  model: string;
  serviceTier?: ServiceTierSuffix;
}

function isServiceTierSuffix(value: string): value is ServiceTierSuffix {
  return (SERVICE_TIER_SUFFIXES as readonly string[]).includes(value);
}

/**
 * Splits on the LAST delimiter, and only when a non-empty model precedes it and the text after it
 * is a known tier. Anything else is returned unchanged, so a name that merely contains `@` is
 * never altered.
 */
export function splitServiceTierSuffix(modelName: string): ServiceTierSplit {
  const index = modelName.lastIndexOf(SERVICE_TIER_SUFFIX_DELIMITER);
  if (index <= 0) return { model: modelName };

  const tier = modelName.slice(index + 1).toLowerCase();
  if (!isServiceTierSuffix(tier)) return { model: modelName };

  return { model: modelName.slice(0, index), serviceTier: tier };
}

/** Every suffix spelling that names the same tier, keyed by any one of them. */
const SERVICE_TIER_SUFFIX_ALIASES: Record<string, readonly string[]> = {
  priority: ['priority', 'fast'],
  fast: ['priority', 'fast'],
  default: ['default', 'standard'],
  standard: ['default', 'standard'],
};

/**
 * Every `<model>@<tier>` spelling that names the same upstream tier as `tier` (the normalised,
 * lower-case tier from `splitServiceTierSuffix`). `fast` is an alias of `priority` and
 * `standard` is an alias of `default`, so either spelling names both. Key model lists match
 * against these, so one entry covers the tier however the client spelled it.
 */
export function serviceTierNames(model: string, tier: string): string[] {
  const names = SERVICE_TIER_SUFFIX_ALIASES[tier] ?? [tier];
  return names.map((name) => `${model}${SERVICE_TIER_SUFFIX_DELIMITER}${name}`);
}
