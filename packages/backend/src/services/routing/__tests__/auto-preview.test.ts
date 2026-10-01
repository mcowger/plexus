import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_AUTO_ROUTING_CONFIG } from '@plexus/shared';
import type { AutoRoutingConfig } from '@plexus/shared';
import type { ModelConfig, PlexusConfig } from '../../../config';
import type { AutoClassifierResult } from '../auto-classifier';
import {
  AutoPreviewError,
  AutoPreviewRequestSchema,
  buildPreviewClassifierRequest,
  previewAutoRouting,
} from '../auto-preview';
import { AutoStateStore } from '../auto-state';

const JUDGMENT = {
  task_kind: 'implement' as const,
  complexity: 1,
  capability_required: 1,
  deep_reasoning: 0.1,
  confidence: 0.9,
};

const POLICY: AutoRoutingConfig = {
  ...DEFAULT_AUTO_ROUTING_CONFIG,
  mode: 'active',
  classifier_alias: 'judge',
};

function makeDraft(overrides: Partial<ModelConfig> = {}): ModelConfig {
  return {
    type: 'text',
    auto_routing: POLICY,
    target_groups: [
      {
        name: 'Main',
        selector: 'auto',
        targets: [
          {
            provider: 'provider-a',
            model: 'fast',
            auto_profile: { capability: 'standard', specialties: ['chat'], reasoning: 'normal' },
          },
          {
            provider: 'provider-b',
            model: 'solid',
            auto_profile: {
              capability: 'high',
              specialties: ['implement'],
              reasoning: 'preferred',
            },
          },
        ],
      },
    ],
    ...overrides,
  } as ModelConfig;
}

function makeConfig(draft: ModelConfig = makeDraft()): PlexusConfig {
  return {
    providers: {
      'provider-a': {
        enabled: true,
        models: { fast: { pricing: { source: 'simple', input: 1, output: 1 } } },
      },
      'provider-b': {
        enabled: true,
        models: {
          solid: { pricing: { source: 'simple', input: 10, output: 10 } },
          'child-fast': { pricing: { source: 'simple', input: 1, output: 1 } },
          'child-smart': { pricing: { source: 'simple', input: 10, output: 10 } },
        },
      },
      'provider-c': {
        enabled: true,
        models: { 'no-price': {} },
      },
    },
    models: {
      magic: draft,
      judge: { type: 'decisions', target_groups: [] },
      'child-alias': {
        type: 'text',
        target_groups: [
          {
            name: 'child',
            selector: 'in_order',
            targets: [
              { provider: 'provider-b', model: 'solid', auto_profile: { capability: 'high' } },
            ],
          },
        ],
      },
      // Mirrors the runtime child alias fixture: declared order is authoritative
      // for an ordinary `in_order` group.
      'child-order': {
        type: 'text',
        target_groups: [
          {
            name: 'child',
            selector: 'in_order',
            targets: [
              { provider: 'provider-b', model: 'child-fast' },
              { provider: 'provider-b', model: 'child-smart' },
            ],
          },
        ],
      },
      // Declared expensive-first; the child `cost` selector must reverse it.
      'child-cost': {
        type: 'text',
        target_groups: [
          {
            name: 'child',
            selector: 'cost',
            targets: [
              { provider: 'provider-b', model: 'solid' },
              { provider: 'provider-a', model: 'fast' },
            ],
          },
        ],
      },
    },
    keys: {},
  } as unknown as PlexusConfig;
}

function validClassifierResult(handle = 'handle-1'): AutoClassifierResult {
  return {
    judgment: { ...JUDGMENT },
    source: 'fresh',
    latencyMs: 12,
    cost: 0.001,
    handle,
  };
}

function makeClassifierDeps() {
  const classify = vi.fn(async () => validClassifierResult());
  const lookupJudgment = vi.fn((handle: string) =>
    handle === 'handle-1' ? { ...JUDGMENT } : undefined
  );
  return { classify, lookupJudgment };
}

describe('auto-preview', () => {
  beforeEach(() => {
    AutoStateStore.resetInstanceForTesting();
  });

  afterEach(() => {
    AutoStateStore.resetInstanceForTesting();
  });

  it('validates bounded prompt and scenario input', () => {
    expect(AutoPreviewRequestSchema.safeParse({ alias: {}, prompt: 'hi' }).success).toBe(true);
    expect(AutoPreviewRequestSchema.safeParse({ alias: {}, prompt: '' }).success).toBe(false);
    expect(
      AutoPreviewRequestSchema.safeParse({ alias: {}, prompt: 'x'.repeat(32_001) }).success
    ).toBe(false);
    expect(
      AutoPreviewRequestSchema.safeParse({
        alias: {},
        prompt: 'hi',
        scenario: { input_tokens: -1 },
      }).success
    ).toBe(false);
    expect(
      AutoPreviewRequestSchema.safeParse({
        alias: {},
        prompt: 'hi',
        scenario: { input_tokens: Number.POSITIVE_INFINITY },
      }).success
    ).toBe(false);
    expect(
      AutoPreviewRequestSchema.safeParse({
        alias: {},
        prompt: 'hi',
        scenario: { cache_state: 'lukewarm' },
      }).success
    ).toBe(false);
  });

  it('classifies once, ranks targets, and returns a reusable handle', async () => {
    const config = makeConfig();
    const deps = makeClassifierDeps();

    const response = await previewAutoRouting(
      { draft: config.models!.magic!, prompt: 'implement a parser', adminContext: 'admin' },
      { config, classifier: deps }
    );

    expect(deps.classify).toHaveBeenCalledTimes(1);
    expect(response.judgment_handle).toBe('handle-1');
    expect(response.analysis.source).toBe('fresh');
    expect(response.analysis.judgment).toEqual(JUDGMENT);
    expect(response.analysis.latencyMs).toBe(12);
    expect(response.analysis.cost).toBe(0.001);
    expect(response.groups).toHaveLength(1);
    expect(response.groups[0]!.name).toBe('Main');
    expect(response.groups[0]!.targets.map((target) => target.id)).toEqual([
      'provider-a/fast',
      'provider-b/solid',
    ]);
    expect(response.groups[0]!.targets[0]!.rank).toBe(1);
    expect(response.groups[0]!.targets[1]!.rank).toBe(2);
    expect(response.groups[0]!.targets[0]!.eligible).toBe(true);
    // Preview has no max_tokens ceiling, so it uses the bounded 512-token
    // output estimate and reports a known cost instead of an unknown null.
    expect(response.groups[0]!.targets[0]!.estimatedCostUsd).toBeGreaterThan(0);
    expect(response.assumptions.join('\n')).toContain('Output tokens are estimated at 512');
  });

  it('shows the eligible first-option fallback and excludes missing providers from selection', async () => {
    const draft = makeDraft();
    draft.target_groups![0]!.targets.unshift({
      provider: 'missing',
      model: 'orphan',
      auto_profile: { capability: 'premium', specialties: [] },
    });
    const config = makeConfig(draft);
    const deps = makeClassifierDeps();
    deps.classify.mockResolvedValue({
      source: 'fresh',
      judgment: { ...JUDGMENT, complexity: 3, capability_required: 3 },
      latencyMs: 1,
    });
    const response = await previewAutoRouting(
      { draft, prompt: 'design an architecture', adminContext: 'admin' },
      { config, classifier: deps }
    );
    const group = response.groups[0]!;
    expect(group.decision).toBe('no_suitable_target_first_option');
    expect(group.targets.find((target) => target.decision === 'fallback')).toMatchObject({
      id: 'provider-a/fast',
      eligible: true,
      suitable: false,
      requiredTier: 'premium',
      reason: 'capability_below_required',
    });
    expect(group.targets.find((target) => target.id === 'missing/orphan')).toMatchObject({
      eligible: false,
    });
    expect(
      group.targets.find((target) => target.id === 'missing/orphan')?.decision
    ).toBeUndefined();
  });

  it('reuses a valid handle without paying for a second classification', async () => {
    const config = makeConfig();
    const deps = makeClassifierDeps();

    const first = await previewAutoRouting(
      { draft: config.models!.magic!, prompt: 'implement a parser', adminContext: 'admin' },
      { config, classifier: deps }
    );
    const second = await previewAutoRouting(
      {
        draft: config.models!.magic!,
        prompt: 'implement a parser',
        adminContext: 'admin',
        judgmentHandle: first.judgment_handle,
      },
      { config, classifier: deps }
    );

    expect(deps.classify).toHaveBeenCalledTimes(1);
    expect(deps.lookupJudgment).toHaveBeenCalledTimes(1);
    expect(second.analysis.source).toBe('cache');
    expect(second.analysis.judgment).toEqual(JUDGMENT);
    expect(second.judgment_handle).toBe('handle-1');
  });

  it('rejects an invalid handle instead of reclassifying', async () => {
    const config = makeConfig();
    const deps = makeClassifierDeps();

    await expect(
      previewAutoRouting(
        {
          draft: config.models!.magic!,
          prompt: 'implement a parser',
          adminContext: 'admin',
          judgmentHandle: 'not-a-real-handle',
        },
        { config, classifier: deps }
      )
    ).rejects.toMatchObject({ code: 'invalid_judgment_handle' });

    expect(deps.classify).not.toHaveBeenCalled();
  });

  it('binds the classifier request to the server-derived admin context', () => {
    const request = buildPreviewClassifierRequest('magic', 'hello', 'admin');
    expect(request.metadata?.plexus_metadata?.plexus_key_id).toBe('admin');
    expect(request.metadata?.plexus_metadata?.plexus_auto_purpose).toBe('preview');
    expect(request.messages[0]).toMatchObject({ role: 'user', content: 'hello' });
  });

  it('does not mutate config, draft, or routing state', async () => {
    const config = makeConfig();
    const draftBefore = JSON.stringify(config.models!.magic);
    const configBefore = JSON.stringify(config);
    const store = AutoStateStore.getInstance();
    const storeSizeBefore = store.size();
    const deps = makeClassifierDeps();

    await previewAutoRouting(
      {
        draft: config.models!.magic!,
        prompt: 'hello',
        adminContext: 'admin',
        scenario: { cache_state: 'warm', input_tokens: 1000 },
      },
      { config, classifier: deps }
    );

    expect(JSON.stringify(config.models!.magic)).toBe(draftBefore);
    expect(JSON.stringify(config)).toBe(configBefore);
    expect(store.size()).toBe(storeSizeBefore);
  });

  it('labels warm, cold, and unknown cache simulations explicitly', async () => {
    const config = makeConfig();
    const deps = makeClassifierDeps();

    for (const cache_state of ['warm', 'cold', 'unknown'] as const) {
      const response = await previewAutoRouting(
        {
          draft: config.models!.magic!,
          prompt: 'hello',
          adminContext: 'admin',
          scenario: { cache_state, input_tokens: 500 },
        },
        { config, classifier: deps }
      );
      expect(response.assumptions.join('\n')).toContain(`cache_state=${cache_state}`);
      expect(response.groups[0]!.targets[0]!.cacheState).toBe(
        cache_state === 'unknown' ? 'unknown' : cache_state
      );
    }
  });

  it('expands alias-reference targets to logical targets with leaves', async () => {
    const draft = makeDraft({
      target_groups: [
        {
          name: 'Main',
          selector: 'auto',
          targets: [{ alias: 'child-alias', auto_profile: { capability: 'high' } }],
        },
      ],
    } as Partial<ModelConfig>);
    const config = makeConfig(draft);
    const deps = makeClassifierDeps();

    const response = await previewAutoRouting(
      { draft, prompt: 'hello', adminContext: 'admin' },
      { config, classifier: deps }
    );

    const target = response.groups[0]!.targets[0]!;
    expect(target.id).toBe('alias:child-alias');
    expect(target.alias).toBe('child-alias');
    expect(target.leaves?.[0]).toMatchObject({
      provider: 'provider-b',
      model: 'solid',
      eligible: true,
    });
  });

  it('rejects a malformed classifier judgment instead of substituting one', async () => {
    const config = makeConfig();
    const classify = vi.fn(async () => ({
      judgment: { ...JUDGMENT, complexity: 9 },
      source: 'fresh' as const,
      latencyMs: 1,
      handle: 'bad',
    }));
    const lookupJudgment = vi.fn();

    await expect(
      previewAutoRouting(
        { draft: config.models!.magic!, prompt: 'hello', adminContext: 'admin' },
        { config, classifier: { classify, lookupJudgment } }
      )
    ).rejects.toMatchObject({ code: 'invalid_judgment' });
  });

  it('rejects nested auto alias references during preview', async () => {
    const draft = makeDraft({
      target_groups: [
        {
          name: 'Main',
          selector: 'auto',
          targets: [{ alias: 'nested', auto_profile: { capability: 'high' } }],
        },
      ],
    } as Partial<ModelConfig>);
    const config = makeConfig(draft);
    config.models!.nested = makeDraft() as ModelConfig;
    const deps = makeClassifierDeps();

    await expect(
      previewAutoRouting(
        { draft, prompt: 'hello', adminContext: 'admin' },
        { config, classifier: deps }
      )
    ).rejects.toBeInstanceOf(AutoPreviewError);
    expect(deps.classify).not.toHaveBeenCalled();
  });

  it('preserves configured disabled-target eligibility', async () => {
    const draft = makeDraft({
      target_groups: [
        {
          name: 'Main',
          selector: 'auto',
          targets: [
            {
              provider: 'provider-a',
              model: 'fast',
              enabled: false,
              auto_profile: { capability: 'standard' },
            },
            { provider: 'provider-b', model: 'solid', auto_profile: { capability: 'high' } },
          ],
        },
      ],
    } as Partial<ModelConfig>);
    const config = makeConfig(draft);
    const deps = makeClassifierDeps();

    const response = await previewAutoRouting(
      { draft, prompt: 'hello', adminContext: 'admin' },
      { config, classifier: deps }
    );

    const disabled = response.groups[0]!.targets.find((t) => t.id === 'provider-a/fast')!;
    expect(disabled.eligible).toBe(false);
    expect(disabled.leaves?.[0]!.reason).toBe('disabled');
  });

  it('uses the baseline path without classification when auto mode is off', async () => {
    const draft = makeDraft({ auto_routing: { ...POLICY, mode: 'off' } } as Partial<ModelConfig>);
    const config = makeConfig(draft);
    const deps = makeClassifierDeps();

    const response = await previewAutoRouting(
      { draft, prompt: 'hello', adminContext: 'admin' },
      { config, classifier: deps }
    );

    expect(deps.classify).not.toHaveBeenCalled();
    expect(response.analysis.source).toBe('unavailable');
    expect(response.analysis.reason).toBe('auto_off');
    expect(response.judgment_handle).toBeUndefined();
    expect(response.groups[0]!.targets.length).toBeGreaterThan(0);
  });

  it('preserves ordinary child in_order leaf order, matching the runtime fixture', async () => {
    const draft = makeDraft({
      target_groups: [
        {
          name: 'Main',
          selector: 'auto',
          targets: [{ alias: 'child-order', auto_profile: { capability: 'high' } }],
        },
      ],
    } as Partial<ModelConfig>);
    const config = makeConfig(draft);
    const deps = makeClassifierDeps();

    const response = await previewAutoRouting(
      { draft, prompt: 'hello', adminContext: 'admin' },
      { config, classifier: deps }
    );

    const leaves = response.groups[0]!.targets[0]!.leaves!;
    expect(leaves.map((leaf) => `${leaf.provider}/${leaf.model}`)).toEqual([
      'provider-b/child-fast',
      'provider-b/child-smart',
    ]);
  });

  it('orders alias-reference leaves with the child ordinary selector', async () => {
    const draft = makeDraft({
      target_groups: [
        {
          name: 'Main',
          selector: 'auto',
          targets: [{ alias: 'child-cost', auto_profile: { capability: 'high' } }],
        },
      ],
    } as Partial<ModelConfig>);
    const config = makeConfig(draft);
    const deps = makeClassifierDeps();

    const response = await previewAutoRouting(
      { draft, prompt: 'hello', adminContext: 'admin' },
      { config, classifier: deps }
    );

    const target = response.groups[0]!.targets[0]!;
    // Declared solid-first, but the child `cost` selector picks the cheap leaf.
    expect(target.leaves!.map((leaf) => `${leaf.provider}/${leaf.model}`)).toEqual([
      'provider-a/fast',
      'provider-b/solid',
    ]);
    // The first eligible leaf under the child policy drives the logical cost.
    expect(target.estimatedCostUsd).toBeGreaterThan(0);
  });

  it('keeps configured group priority in the preview', async () => {
    const draft = makeDraft({
      target_groups: [
        {
          name: 'Main',
          selector: 'auto',
          targets: [
            { provider: 'provider-a', model: 'fast', auto_profile: { capability: 'high' } },
          ],
        },
        {
          name: 'Fallback',
          selector: 'in_order',
          targets: [{ provider: 'provider-b', model: 'solid' }],
        },
      ],
    } as Partial<ModelConfig>);
    const config = makeConfig(draft);
    const deps = makeClassifierDeps();

    const response = await previewAutoRouting(
      { draft, prompt: 'hello', adminContext: 'admin' },
      { config, classifier: deps }
    );

    expect(response.groups.map((group) => group.name)).toEqual(['Main', 'Fallback']);
    expect(response.groups[1]!.decision).toBe('unqualified_group_fallback');
    expect(response.groups[1]!.targets[0]!.estimatedCostUsd).toBeGreaterThan(0);
  });

  it('reports unknown prices as null cost in every group, never free', async () => {
    const draft = makeDraft({
      auto_routing: { ...POLICY, mode: 'off' },
      target_groups: [
        {
          name: 'Main',
          selector: 'auto',
          targets: [
            { provider: 'provider-a', model: 'fast', auto_profile: { capability: 'high' } },
            { provider: 'provider-c', model: 'no-price', auto_profile: { capability: 'high' } },
          ],
        },
        {
          name: 'Fallback',
          selector: 'in_order',
          targets: [{ provider: 'provider-c', model: 'no-price' }],
        },
      ],
    } as Partial<ModelConfig>);
    const config = makeConfig(draft);
    const deps = makeClassifierDeps();

    const response = await previewAutoRouting(
      { draft, prompt: 'hello', adminContext: 'admin' },
      { config, classifier: deps }
    );

    const priced = response.groups[0]!.targets.find((target) => target.id === 'provider-a/fast')!;
    const unpriced = response.groups[0]!.targets.find(
      (target) => target.id === 'provider-c/no-price'
    )!;
    expect(priced.estimatedCostUsd).toBeGreaterThan(0);
    expect(unpriced.estimatedCostUsd).toBeNull();
    expect(response.groups[1]!.targets[0]!.estimatedCostUsd).toBeNull();
  });

  it('applies the provider discount to candidate cost estimates', async () => {
    const draft = makeDraft({
      target_groups: [
        {
          name: 'Main',
          selector: 'auto',
          targets: [
            { provider: 'provider-a', model: 'fast', auto_profile: { capability: 'high' } },
          ],
        },
      ],
    } as Partial<ModelConfig>);
    const config = makeConfig(draft);
    (config.providers!['provider-a'] as { discount?: number }).discount = 0.5;
    const deps = makeClassifierDeps();

    const discounted = await previewAutoRouting(
      { draft, prompt: 'hello', adminContext: 'admin', scenario: { input_tokens: 1000 } },
      { config, classifier: deps }
    );

    // (1000 input + 512 output) / 1M at $1/M, then a 1 - 0.5 provider discount.
    expect(discounted.groups[0]!.targets[0]!.estimatedCostUsd).toBeCloseTo(0.000756, 6);
  });
});
