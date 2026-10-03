import { describe, expect, it } from 'vitest';
import {
  getAttemptIndicatorLabel,
  getServiceTierDisplay,
  hasUpstreamRewrite,
  isDecisionsApiType,
} from '../helpers';

describe('isDecisionsApiType', () => {
  it('recognizes the decisions ingress type', () => {
    expect(isDecisionsApiType('decisions')).toBe(true);
  });

  it('recognizes decisions target protocols', () => {
    expect(isDecisionsApiType('systemone')).toBe(true);
    expect(isDecisionsApiType('openrouter-decisions')).toBe(true);
    expect(isDecisionsApiType('typesafe-decisions')).toBe(true);
  });

  it('ignores subtypes and casing', () => {
    expect(isDecisionsApiType('Decisions:V2')).toBe(true);
  });

  it('returns false for other and missing api types', () => {
    expect(isDecisionsApiType('embeddings')).toBe(false);
    expect(isDecisionsApiType('messages')).toBe(false);
    expect(isDecisionsApiType(undefined)).toBe(false);
    expect(isDecisionsApiType(null)).toBe(false);
  });
});

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

describe('getServiceTierDisplay', () => {
  it('returns null when no tier metadata is present', () => {
    expect(getServiceTierDisplay({})).toBeNull();
    expect(getServiceTierDisplay({ serviceTier: null, requestedServiceTier: null })).toBeNull();
  });

  it('hides a provider-reported actual tier when the request did not ask for one', () => {
    expect(getServiceTierDisplay({ serviceTier: 'default' })).toBeNull();
    expect(getServiceTierDisplay({ serviceTier: 'priority', serviceTierRaw: 'fast' })).toBeNull();
  });

  it.each([
    'scale',
    'reserved',
    'performance',
    'deferred',
    'unknown',
    'constructor',
    '__proto__',
    'toString',
    'hasOwnProperty',
  ])('does not map the unlisted %s tier to an icon', (tier) => {
    expect(getServiceTierDisplay({ requestedServiceTier: tier })).toBeNull();
  });

  it('falls back to a mapped actual icon when the requested tier is unmapped', () => {
    const tier = getServiceTierDisplay({
      requestedServiceTier: 'scale',
      serviceTier: 'priority',
    });
    expect(tier?.tier).toBe('priority');
    expect(tier?.actualTier).toBeUndefined();
    expect(tier?.label).toBe('Requested service tier: Scale; actual service tier: Priority');
  });

  it('keeps the requested icon and reports an unmapped actual tier accessibly', () => {
    const tier = getServiceTierDisplay({
      requestedServiceTier: 'priority',
      serviceTier: 'scale',
    });
    expect(tier?.tier).toBe('priority');
    expect(tier?.actualTier).toBeUndefined();
    expect(tier?.label).toBe('Requested service tier: Priority; actual service tier: Scale');
    expect(tier?.tooltip).toContain('Actual tier: Scale');
  });

  it.each([
    ['flex', 'flex'],
    ['priority', 'priority'],
    ['ultrafast', 'ultrafast'],
    ['default', 'default'],
    ['auto', 'auto'],
  ] as const)('maps the requested %s tier to %s', (requested, expected) => {
    const tier = getServiceTierDisplay({ requestedServiceTier: requested });
    expect(tier?.tier).toBe(expected);
    expect(tier?.actualTier).toBeUndefined();
  });

  it('shows requested and actual icons when the supported tiers differ', () => {
    const tier = getServiceTierDisplay({
      serviceTier: 'priority',
      requestedServiceTier: 'flex',
      serviceTierRaw: 'fast',
      requestedServiceTierRaw: 'standard',
    });
    expect(tier?.tier).toBe('flex');
    expect(tier?.actualTier).toBe('priority');
    expect(tier?.label).toBe('Requested service tier: Flex; actual service tier: Priority');
    expect(tier?.tooltip).toContain('Actual tier: Priority');
    expect(tier?.tooltip).toContain('Native value: fast');
    expect(tier?.tooltip).toContain('Requested tier: Flex');
    expect(tier?.tooltip).toContain('Requested native value: standard');
  });

  it('labels a matching actual tier as the service tier', () => {
    const tier = getServiceTierDisplay({
      requestedServiceTier: 'priority',
      serviceTier: 'priority',
    });
    expect(tier?.tier).toBe('priority');
    expect(tier?.actualTier).toBeUndefined();
    expect(tier?.label).toBe('Service tier: Priority');
    expect(tier?.tooltip).toContain('Requested tier: Priority (matched)');
  });

  it('says requested-only in the label when the actual tier was not reported', () => {
    const tier = getServiceTierDisplay({
      requestedServiceTier: 'priority',
      requestedServiceTierRaw: 'fast',
    });
    expect(tier?.tier).toBe('priority');
    expect(tier?.actualTier).toBeUndefined();
    expect(tier?.label).toBe('Requested service tier: Priority');
    expect(tier?.tooltip).toContain('Requested tier: Priority');
    expect(tier?.tooltip).toContain('Requested native value: fast');
    expect(tier?.tooltip).toContain('Actual tier not reported');
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
