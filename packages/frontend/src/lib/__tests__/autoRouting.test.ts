import { describe, expect, it } from 'vitest';
import { aliasToConfigPayload } from '../api';
import {
  createDefaultAutoRoutingConfig,
  getIncompleteAutoProfileTargets,
  validateAutoRoutingDraft,
} from '../autoRouting';
import type { Alias } from '../../types/aliases';

const makeAlias = (overrides: Partial<Alias> = {}): Alias => ({
  id: 'magic',
  target_groups: [
    {
      name: 'Main',
      selector: 'auto',
      targets: [
        {
          provider: 'a',
          model: 'fast',
          auto_profile: { capability: 'standard', specialties: ['chat'], reasoning: 'normal' },
        },
      ],
    },
  ],
  ...overrides,
});

describe('createDefaultAutoRoutingConfig', () => {
  it('rejects auto groups on non-text aliases', () => {
    const validation = validateAutoRoutingDraft(makeAlias({ type: 'image' }));
    expect(validation.valid).toBe(false);
    expect(validation.fieldErrors.type).toBe('Auto routing only supports text aliases.');
  });
  it('returns a fresh clone so mutations do not leak into later defaults', () => {
    const first = createDefaultAutoRoutingConfig();
    first.scoring.complexity_weight = 0.1;
    const second = createDefaultAutoRoutingConfig();
    expect(second.scoring.complexity_weight).toBe(0.55);
  });
});

describe('validateAutoRoutingDraft', () => {
  it('accepts a complete active draft with a usable classifier', () => {
    const alias = makeAlias({
      auto_routing: {
        ...createDefaultAutoRoutingConfig(),
        mode: 'active',
        classifier_alias: 'judge',
      },
    });
    const result = validateAutoRoutingDraft(alias, { decisionsAliases: ['judge'] });
    expect(result.valid).toBe(true);
    expect(result.activationBlockers).toEqual([]);
  });

  it('rejects weights that do not sum to one', () => {
    const config = createDefaultAutoRoutingConfig();
    config.scoring.complexity_weight = 0.7;
    config.scoring.capability_weight = 0.7;
    const result = validateAutoRoutingDraft(makeAlias({ auto_routing: config }));
    expect(result.valid).toBe(false);
    expect(result.fieldErrors['scoring.complexity_weight']).toContain('sum to 1');
  });

  it('rejects tier boundaries that are not strictly increasing', () => {
    const config = createDefaultAutoRoutingConfig();
    config.scoring.tier_boundaries = { standard: 2, high: 1.5, premium: 2.5 };
    const result = validateAutoRoutingDraft(makeAlias({ auto_routing: config }));
    expect(result.valid).toBe(false);
    expect(result.fieldErrors['scoring.tier_boundaries.standard']).toContain('strictly increasing');
  });

  it('reports activation blockers for missing classifier and incomplete profiles', () => {
    const alias = makeAlias({
      auto_routing: { ...createDefaultAutoRoutingConfig(), mode: 'active' },
      target_groups: [
        { name: 'Main', selector: 'auto', targets: [{ provider: 'a', model: 'fast' }] },
      ],
    });
    const result = validateAutoRoutingDraft(alias, { decisionsAliases: [] });
    expect(result.valid).toBe(true);
    expect(result.activationBlockers).toContain('Active mode requires a classifier alias.');
    expect(result.activationBlockers).toContain(
      "Target 'a/fast' needs a capability profile for active mode."
    );
    expect(getIncompleteAutoProfileTargets(alias)).toEqual(['a/fast']);
  });
});

describe('aliasToConfigPayload', () => {
  it('preserves the alias policy and per-target profile on save', () => {
    const config = createDefaultAutoRoutingConfig();
    config.mode = 'active';
    config.classifier_alias = 'judge';
    const alias = makeAlias({ auto_routing: config });

    const payload = aliasToConfigPayload(alias);
    expect(payload.auto_routing).toEqual(config);

    const groups = payload.target_groups as Array<{
      targets: Array<{ auto_profile?: unknown }>;
    }>;
    expect(groups[0].targets[0].auto_profile).toEqual({
      capability: 'standard',
      specialties: ['chat'],
      reasoning: 'normal',
    });
  });

  it('preserves an alias-reference profile', () => {
    const alias = makeAlias({
      target_groups: [
        {
          name: 'Main',
          selector: 'auto',
          targets: [
            { alias: 'premium-models', auto_profile: { capability: 'premium', specialties: [] } },
          ],
        },
      ],
    });
    const payload = aliasToConfigPayload(alias);
    const groups = payload.target_groups as Array<{
      targets: Array<{ auto_profile?: unknown }>;
    }>;
    expect(groups[0].targets[0].auto_profile).toEqual({ capability: 'premium', specialties: [] });
  });

  it('does not strip existing auto settings when unrelated fields are saved', () => {
    const config = { ...createDefaultAutoRoutingConfig(), mode: 'active' as const };
    const alias = makeAlias({ auto_routing: config, aliases: ['magic-2'] });
    // Simulate an edit to an unrelated field (target enabled toggle) and an
    // additional alias, leaving the hidden auto settings untouched.
    alias.target_groups[0].targets[0].enabled = false;

    const payload = aliasToConfigPayload(alias) as Record<string, unknown>;
    expect(payload.auto_routing).toEqual(config);
    expect(payload.additional_aliases).toEqual(['magic-2']);

    const groups = payload.target_groups as Array<{
      selector: string;
      targets: Array<{ enabled?: boolean; auto_profile?: unknown }>;
    }>;
    expect(groups[0].selector).toBe('auto');
    expect(groups[0].targets[0].enabled).toBe(false);
    expect(groups[0].targets[0].auto_profile).toEqual({
      capability: 'standard',
      specialties: ['chat'],
      reasoning: 'normal',
    });
  });
});
