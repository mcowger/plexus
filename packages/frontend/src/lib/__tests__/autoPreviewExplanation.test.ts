import { describe, expect, it } from 'vitest';
import type {
  AutoJudgment,
  AutoRoutingPreviewResponse,
  AutoRoutingPreviewTarget,
} from '../../types/aliases';
import { cloneAutoRoutingConfig, createDefaultAutoRoutingConfig } from '../autoRouting';
import {
  NO_SUITABLE_TARGET_DECISION,
  ORDINARY_GROUP_DECISION,
  computeScoreBreakdown,
  describeExclusionReason,
  describeLeafReason,
  explainAutoPreview,
  firstEligibleLeaf,
} from '../autoPreviewExplanation';

function makeTarget(overrides: Partial<AutoRoutingPreviewTarget> = {}): AutoRoutingPreviewTarget {
  const provider = overrides.provider ?? 'provider-a';
  const model = overrides.model ?? 'model-1';
  return {
    id: `${provider}/${model}`,
    provider,
    model,
    profile: { capability: 'high', specialties: [] },
    eligible: true,
    suitable: true,
    requiredTier: 'high',
    demand: 1.75,
    leaves: [
      {
        id: `${provider}/${model}`,
        provider,
        model,
        eligible: true,
        reason: null,
        provenance: [],
      },
    ],
    ...overrides,
  };
}

function makeResult(
  groups: AutoRoutingPreviewResponse['groups'],
  judgment?: AutoJudgment
): AutoRoutingPreviewResponse {
  return {
    analysis: { source: 'fresh', latencyMs: 12, cost: 0, judgment },
    groups,
    assumptions: [],
  };
}

const config = createDefaultAutoRoutingConfig();

describe('explainAutoPreview: chosen vs first-option fallback', () => {
  it('shows the alias without exposing its current underlying dispatch target', () => {
    const result = makeResult([
      {
        name: 'Main',
        decision: 'cold_start',
        targets: [makeTarget({ alias: 'coding-models', decision: 'chosen' })],
      },
    ]);
    const explanation = explainAutoPreview({ result, resultConfig: config });
    expect(explanation.wouldSelect?.label).toBe('alias:coding-models');
    expect(explanation.wouldSelect?.summary).toBe(
      'Would select alias:coding-models in group Main.'
    );
    expect(explanation.wouldSelect?.leaf).toBeNull();
    expect(explanation.groups[0]?.winnerLeaf).toBeNull();
  });

  it('explains a no-suitable first-option fallback and selects the only eligible target', () => {
    const result = makeResult([
      {
        name: 'Main',
        decision: NO_SUITABLE_TARGET_DECISION,
        targets: [
          makeTarget({
            decision: 'fallback',
            suitable: false,
            reason: 'capability_below_required',
            profile: { capability: 'high', specialties: [] },
            requiredTier: 'premium',
          }),
        ],
      },
    ]);

    const explanation = explainAutoPreview({
      result,
      resultConfig: config,
      currentConfig: config,
    });

    expect(explanation.wouldSelect?.mode).toBe('first_option_fallback');
    expect(explanation.wouldSelect?.label).toBe('provider-a/model-1');
    expect(explanation.wouldSelect?.summary).toContain('no suitable target');
    expect(explanation.groups[0]!.firstOptionFallbackText).toBe(
      'No eligible target meets premium; using the first eligible configured target.'
    );
    expect(explanation.groups[0]!.targets[0]!.reasonText).toBe(
      'Configured capability high is below required premium.'
    );
    expect(explanation.groups[0]!.targets[0]!.reasonCode).toBe('capability_below_required');
    expect(explanation.groups[0]!.targets[0]!.badgeLabel).toBe('Would select (fallback)');
  });

  it('labels a normal chosen target and shows no fallback note', () => {
    const result = makeResult([
      {
        name: 'Main',
        decision: 'quality_upgrade',
        targets: [makeTarget({ decision: 'chosen' })],
      },
    ]);

    const explanation = explainAutoPreview({
      result,
      resultConfig: config,
      currentConfig: config,
    });

    expect(explanation.wouldSelect?.mode).toBe('chosen');
    expect(explanation.wouldSelect?.summary).toBe('Would select provider-a/model-1 in group Main.');
    expect(explanation.groups[0]!.firstOptionFallbackText).toBeNull();
    expect(explanation.groups[0]!.targets[0]!.badgeLabel).toBe('Would select');
    expect(explanation.groups[0]!.targets[0]!.reasonText).toBeNull();
  });
});

describe('explainAutoPreview: multiple groups', () => {
  it('marks only the first group primary and labels later winners as group choices', () => {
    const result = makeResult([
      {
        name: 'Primary',
        decision: 'cold_start',
        targets: [makeTarget({ decision: 'chosen' })],
      },
      {
        name: 'Backup',
        decision: 'cold_start',
        targets: [makeTarget({ provider: 'provider-b', model: 'model-2', decision: 'chosen' })],
      },
    ]);

    const explanation = explainAutoPreview({
      result,
      resultConfig: config,
      currentConfig: config,
    });

    expect(explanation.groups[0]!.isPrimary).toBe(true);
    expect(explanation.groups[1]!.isPrimary).toBe(false);
    expect(explanation.groups[0]!.targets[0]!.badgeLabel).toBe('Would select');
    expect(explanation.groups[1]!.targets[0]!.badgeLabel).toBe('First choice in this group');
    expect(explanation.wouldSelect?.groupName).toBe('Primary');
  });

  it('selects the first eligible target of an ordinary fallback group', () => {
    const result = makeResult([
      {
        name: 'Ordinary',
        decision: ORDINARY_GROUP_DECISION,
        targets: [
          makeTarget({
            provider: 'ghost',
            model: 'missing',
            eligible: false,
            suitable: false,
            leaves: [
              {
                id: 'ghost/missing',
                provider: 'ghost',
                model: 'missing',
                eligible: false,
                reason: 'unknown_provider',
                provenance: [],
              },
            ],
          }),
          makeTarget({ provider: 'provider-b', model: 'model-2' }),
        ],
      },
    ]);

    const explanation = explainAutoPreview({
      result,
      resultConfig: config,
      currentConfig: config,
    });

    expect(explanation.wouldSelect?.mode).toBe('ordinary');
    expect(explanation.wouldSelect?.label).toBe('provider-b/model-2');
    expect(explanation.groups[0]!.decisionText).toContain('Ordinary');
    expect(explanation.groups[0]!.targets[0]!.badgeLabel).toBeNull();
    expect(explanation.groups[0]!.targets[1]!.badgeLabel).toBe('Would select');
  });
});

describe('preview reason text', () => {
  it('maps unknown, disabled, and provider-disabled leaves to plain text', () => {
    expect(describeLeafReason('unknown_provider')).toEqual({
      text: 'Provider is not configured.',
      code: 'unknown_provider',
    });
    expect(describeLeafReason('provider_disabled')?.text).toBe('Provider is disabled.');
    expect(describeLeafReason('disabled')?.text).toBe('Target is disabled.');
    expect(describeLeafReason(null)).toBeNull();
  });

  it('compares the configured capability against the required tier', () => {
    expect(
      describeExclusionReason('capability_below_required', {
        configuredCapability: 'standard',
        requiredTier: 'premium',
      })?.text
    ).toBe('Configured capability standard is below required premium.');
    expect(
      describeExclusionReason('capability_below_required', {
        configuredCapability: 'premium',
        requiredTier: 'high',
      })?.text
    ).toBe('Configured capability premium is below required high.');
    expect(describeExclusionReason(undefined)).toBeNull();
  });

  it('skips ineligible leaves when picking the concrete dispatch target', () => {
    const aliasTarget = makeTarget({
      id: 'alias:premium-models',
      alias: 'premium-models',
      provider: undefined,
      model: undefined,
      leaves: [
        {
          id: 'off/model',
          provider: 'off',
          model: 'model',
          eligible: false,
          reason: 'provider_disabled',
          provenance: ['premium-models'],
        },
        {
          id: 'on/model',
          provider: 'on',
          model: 'model',
          eligible: true,
          reason: null,
          provenance: ['premium-models'],
        },
      ],
    });

    expect(firstEligibleLeaf(aliasTarget)).toMatchObject({ provider: 'on', model: 'model' });
  });
});

describe('computeScoreBreakdown', () => {
  it('reproduces the server demand and tier from a judgment and policy snapshot', () => {
    const judgment: AutoJudgment = {
      task_kind: 'implement',
      complexity: 2,
      capability_required: 1.5,
      deep_reasoning: 0.9,
      confidence: 0.5,
    };

    const score = computeScoreBreakdown(judgment, config)!;

    expect(score.complexityTerm).toBeCloseTo(1.1);
    expect(score.capabilityTerm).toBeCloseTo(0.675);
    expect(score.reasoningActive).toBe(true);
    expect(score.reasoningBoost).toBe(0.5);
    expect(score.demand).toBeCloseTo(2.275);
    expect(score.premiumThreshold).toBe(2.5);
    expect(score.scoredTier).toBe('high');
    expect(score.requiredTier).toBe('high');
    expect(score.confidenceUncertain).toBe(true);
  });

  it('skips the reasoning boost below the threshold', () => {
    const score = computeScoreBreakdown(
      { task_kind: 'chat', complexity: 1, capability_required: 1, deep_reasoning: 0.2 },
      config
    )!;

    expect(score.reasoningActive).toBe(false);
    expect(score.reasoningBoost).toBe(0);
    expect(score.demand).toBeCloseTo(1);
    expect(score.scoredTier).toBe('standard');
    expect(score.confidence).toBeNull();
    expect(score.confidenceUncertain).toBe(false);
  });

  it('applies a per-task minimum tier floor above the scored tier', () => {
    const score = computeScoreBreakdown(
      { task_kind: 'plan', complexity: 0, capability_required: 0, deep_reasoning: 0 },
      config
    )!;

    expect(score.scoredTier).toBe('economy');
    expect(score.taskFloor).toBe('high');
    expect(score.requiredTier).toBe('high');
  });

  it('returns null without a judgment or a policy snapshot', () => {
    expect(computeScoreBreakdown(undefined, config)).toBeNull();
    expect(computeScoreBreakdown({ complexity: 1, capability_required: 1 }, null)).toBeNull();
  });

  it('scores against the snapshot, not the currently edited config', () => {
    const edited = cloneAutoRoutingConfig(config);
    edited.scoring.complexity_weight = 0.9;
    edited.scoring.capability_weight = 0.1;

    const result = makeResult(
      [
        {
          name: 'Main',
          decision: 'cold_start',
          targets: [makeTarget({ decision: 'chosen' })],
        },
      ],
      { task_kind: 'implement', complexity: 2, capability_required: 1, deep_reasoning: 0 }
    );

    const explanation = explainAutoPreview({
      result,
      resultConfig: config,
      currentConfig: edited,
    });

    expect(explanation.score?.complexityWeight).toBe(0.55);
    expect(explanation.staleConfig).toBe(true);

    const fresh = explainAutoPreview({ result, resultConfig: config, currentConfig: config });
    expect(fresh.staleConfig).toBe(false);
  });
});
