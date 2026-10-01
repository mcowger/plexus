import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Router, type RouteResult } from '../router';
import { setConfigForTesting } from '../../../config';
import { CooldownManager } from '../../runtime/cooldown-manager';
import { StickySessionManager } from '../sticky-session-manager';
import { AutoStateStore, buildAutoStateScope } from '../auto-state';
import {
  applyAutoRouting,
  autoObservedUsageFromResponse,
  deriveAutoPrefixFingerprint,
  detectAutoContinuationLock,
  detectProviderBoundSignature,
  recordAutoRoutingOutcome,
} from '../auto-router';
import { classifyAutoRequest } from '../auto-classifier';
import { registerSpy } from '../../../../test/test-utils';

vi.mock('../auto-classifier', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../auto-classifier')>();
  return {
    ...actual,
    classifyAutoRequest: vi.fn(),
  };
});

const cooldownManager = CooldownManager.getInstance();

const BASE_POLICY = {
  mode: 'active' as const,
  classifier_alias: 'judge',
  classifier_deadline_ms: 500,
  rubric_version: 1 as const,
  baseline_policy: 'in_order' as const,
  uncertainty_minimum_tier: 'high' as const,
};

function makeProviders() {
  return {
    'provider-a': {
      type: 'openai',
      api_base_url: 'https://a.example.com/v1',
      enabled: true,
      models: {
        fast: { pricing: { source: 'simple', input: 1, output: 1 } },
        medium: { pricing: { source: 'simple', input: 5, output: 5 } },
        premium: { pricing: { source: 'simple', input: 20, output: 20 } },
      },
    },
    'provider-b': {
      type: 'openai',
      api_base_url: 'https://b.example.com/v1',
      enabled: true,
      models: {
        solid: { pricing: { source: 'simple', input: 8, output: 8 } },
        'child-fast': { pricing: { source: 'simple', input: 1, output: 1 } },
        'child-smart': { pricing: { source: 'simple', input: 10, output: 10 } },
      },
    },
  };
}

function makeConfig(overrides: { policy?: any; groups: any[]; extraModels?: Record<string, any> }) {
  return {
    providers: makeProviders(),
    models: {
      magic: {
        type: 'text',
        sticky_session: true,
        auto_routing: overrides.policy ?? BASE_POLICY,
        target_groups: overrides.groups,
      },
      judge: { type: 'decisions', target_groups: [] },
      'child-alias': {
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
      ...(overrides.extraModels ?? {}),
    },
    keys: {},
  } as any;
}

function makeRequest(overrides: Record<string, any> = {}) {
  return {
    model: 'magic',
    incomingApiType: 'chat',
    messages: [
      { role: 'system', content: 'you are helpful' },
      { role: 'user', content: 'do the thing' },
    ],
    metadata: { plexus_metadata: { plexus_key_id: 'key-1' } },
    ...overrides,
  } as any;
}

function judgment(overrides: Record<string, any> = {}) {
  return {
    task_kind: 'implement',
    complexity: 3,
    capability_required: 3,
    deep_reasoning: 0,
    confidence: 0.95,
    ...overrides,
  } as any;
}

async function resolveEligible(config: any, request: any, model = 'magic'): Promise<RouteResult[]> {
  setConfigForTesting(config);
  return Router.resolveCandidates(model, request.incomingApiType, null);
}

describe('Router auto provenance', () => {
  beforeEach(() => {
    StickySessionManager.getInstance().clear();
    AutoStateStore.getInstance().resetForTesting();
    registerSpy(cooldownManager, 'filterHealthyTargets').mockImplementation(
      async (targets: any[]) => targets
    );
  });

  afterEach(() => {
    cooldownManager.clearCooldown();
  });

  it('keeps ordinary group ordering and records group/target provenance', async () => {
    const config = makeConfig({
      groups: [
        {
          name: 'main',
          selector: 'in_order',
          targets: [
            { provider: 'provider-a', model: 'fast' },
            { provider: 'provider-a', model: 'medium' },
          ],
        },
      ],
    });

    const candidates = await resolveEligible(config, makeRequest());

    expect(candidates.map((c) => c.model)).toEqual(['fast', 'medium']);
    expect(candidates[0]?.autoProvenance).toMatchObject({
      groupIndex: 0,
      groupName: 'main',
      groupSelector: 'in_order',
      targetKey: 'provider-a/fast',
      targetIndex: 0,
      leafIndex: 0,
    });
    expect(candidates[1]?.autoProvenance).toMatchObject({
      targetIndex: 1,
      targetKey: 'provider-a/medium',
    });
  });

  it('emits an auto group in declaration order and preserves alias-ref child leaf order', async () => {
    const config = makeConfig({
      groups: [
        {
          name: 'auto',
          selector: 'auto',
          targets: [
            {
              alias: 'child-alias',
              auto_profile: { capability: 'premium', specialties: [], reasoning: 'preferred' },
            },
            {
              provider: 'provider-a',
              model: 'fast',
              auto_profile: { capability: 'economy', specialties: [] },
            },
          ],
        },
      ],
    });

    const candidates = await resolveEligible(config, makeRequest());

    // Logical target 0 (alias-ref) expands in child order, then logical target 1.
    expect(candidates.map((c) => `${c.provider}/${c.model}`)).toEqual([
      'provider-b/child-fast',
      'provider-b/child-smart',
      'provider-a/fast',
    ]);
    expect(candidates[0]?.autoProvenance).toMatchObject({
      targetKey: 'alias:child-alias',
      targetIndex: 0,
      leafIndex: 0,
      profile: { capability: 'premium' },
    });
    expect(candidates[1]?.autoProvenance).toMatchObject({
      targetKey: 'alias:child-alias',
      targetIndex: 0,
      leafIndex: 1,
    });
    expect(candidates[2]?.autoProvenance).toMatchObject({
      targetKey: 'provider-a/fast',
      targetIndex: 1,
      leafIndex: 0,
    });
  });

  it('does not hoist a sticky pick inside an auto alias', async () => {
    const config = makeConfig({
      groups: [
        {
          name: 'auto',
          selector: 'auto',
          targets: [
            { provider: 'provider-a', model: 'fast', auto_profile: { capability: 'standard' } },
            { provider: 'provider-a', model: 'medium', auto_profile: { capability: 'high' } },
            { provider: 'provider-a', model: 'premium', auto_profile: { capability: 'premium' } },
          ],
        },
      ],
    });

    setConfigForTesting(config);
    StickySessionManager.getInstance().set('magic', 'chat', 'm:sticky', 'provider-a', 'premium');

    const candidates = await Router.resolveCandidates('magic', 'chat', 'm:sticky');
    expect(candidates[0]?.model).toBe('fast');
  });

  it('still hoists a sticky pick when the auto policy is off', async () => {
    const config = makeConfig({
      policy: { ...BASE_POLICY, mode: 'off' },
      groups: [
        {
          name: 'auto',
          selector: 'auto',
          targets: [
            { provider: 'provider-a', model: 'fast', auto_profile: { capability: 'economy' } },
            { provider: 'provider-a', model: 'premium', auto_profile: { capability: 'premium' } },
          ],
        },
      ],
    });

    setConfigForTesting(config);
    StickySessionManager.getInstance().set(
      'magic',
      'chat',
      'm:sticky-off',
      'provider-a',
      'premium'
    );

    const candidates = await Router.resolveCandidates('magic', 'chat', 'm:sticky-off');
    expect(candidates[0]?.model).toBe('premium');
  });

  it('dedupes shared leaves across groups when the auto policy is off', async () => {
    const config = makeConfig({
      policy: { ...BASE_POLICY, mode: 'off' },
      groups: [
        {
          name: 'auto',
          selector: 'auto',
          targets: [
            { provider: 'provider-b', model: 'solid', auto_profile: { capability: 'premium' } },
          ],
        },
        {
          name: 'fallback',
          selector: 'in_order',
          targets: [{ provider: 'provider-b', model: 'solid' }],
        },
      ],
    });

    setConfigForTesting(config);
    const candidates = await Router.resolveCandidates('magic', 'chat', null);
    expect(candidates.filter((c) => c.model === 'solid')).toHaveLength(1);
  });
});

describe('applyAutoRouting', () => {
  beforeEach(() => {
    StickySessionManager.getInstance().clear();
    AutoStateStore.getInstance().resetForTesting();
    registerSpy(cooldownManager, 'filterHealthyTargets').mockImplementation(
      async (targets: any[]) => targets
    );
    vi.mocked(classifyAutoRequest).mockResolvedValue({
      judgment: judgment(),
      source: 'fresh',
      latencyMs: 1,
    });
  });

  afterEach(() => {
    cooldownManager.clearCooldown();
  });

  it('reorders a logical target within its auto group using one classification', async () => {
    const config = makeConfig({
      groups: [
        {
          name: 'auto',
          selector: 'auto',
          targets: [
            { provider: 'provider-a', model: 'fast', auto_profile: { capability: 'economy' } },
            { provider: 'provider-a', model: 'premium', auto_profile: { capability: 'premium' } },
          ],
        },
      ],
    });
    const request = makeRequest();
    const candidates = await resolveEligible(config, request);

    const { candidates: ordered } = await applyAutoRouting({
      request,
      alias: config.models.magic,
      canonicalModel: 'magic',
      candidates,
    });

    expect(ordered[0]?.model).toBe('premium');
    expect(vi.mocked(classifyAutoRequest)).toHaveBeenCalledTimes(1);
  });

  it('falls back to the first eligible configured option when none is suitable', async () => {
    const config = makeConfig({
      groups: [
        {
          name: 'auto',
          selector: 'auto',
          targets: [
            { provider: 'provider-a', model: 'fast', auto_profile: { capability: 'economy' } },
            { provider: 'provider-a', model: 'medium', auto_profile: { capability: 'economy' } },
          ],
        },
      ],
    });
    const request = makeRequest();
    const candidates = await resolveEligible(config, request);

    const { candidates: ordered, decision } = await applyAutoRouting({
      request,
      alias: config.models.magic,
      canonicalModel: 'magic',
      candidates,
    });

    expect(ordered.map((c) => c.model)).toEqual(['fast', 'medium']);
    expect(decision.fallback).toBe(true);
    expect(decision.reasons).toContain('no_suitable_target_first_option');
  });

  it('produces known cost evidence from a bounded output estimate', async () => {
    const config = makeConfig({
      groups: [
        {
          name: 'auto',
          selector: 'auto',
          targets: [
            { provider: 'provider-a', model: 'premium', auto_profile: { capability: 'premium' } },
          ],
        },
      ],
    });
    const request = makeRequest({ max_tokens: 100 });
    const candidates = await resolveEligible(config, request);

    const { decision } = await applyAutoRouting({
      request,
      alias: config.models.magic,
      canonicalModel: 'magic',
      candidates,
    });

    const group = (decision.groups as any[])[0];
    const cost = group.costEvidence['provider-a/premium'];
    expect(cost.known).toBe(true);
    expect(cost.outputTokens).toBe(100);
    expect(cost.expectedUsd).toBeGreaterThan(0);
    expect(cost.upperUsd).toBeLessThanOrEqual(cost.expectedUsd * 1.5);
  });

  it('classifies once across multiple auto groups', async () => {
    const config = makeConfig({
      groups: [
        {
          name: 'g1',
          selector: 'auto',
          targets: [
            { provider: 'provider-a', model: 'fast', auto_profile: { capability: 'high' } },
          ],
        },
        {
          name: 'g2',
          selector: 'auto',
          targets: [
            { provider: 'provider-b', model: 'solid', auto_profile: { capability: 'high' } },
          ],
        },
      ],
    });
    const request = makeRequest();
    const candidates = await resolveEligible(config, request);

    await applyAutoRouting({
      request,
      alias: config.models.magic,
      canonicalModel: 'magic',
      candidates,
    });

    expect(vi.mocked(classifyAutoRequest)).toHaveBeenCalledTimes(1);
  });

  it('leaves an ordinary group untouched while reordering an auto group', async () => {
    const config = makeConfig({
      groups: [
        {
          name: 'auto',
          selector: 'auto',
          targets: [
            { provider: 'provider-a', model: 'fast', auto_profile: { capability: 'economy' } },
            { provider: 'provider-a', model: 'premium', auto_profile: { capability: 'premium' } },
          ],
        },
        {
          name: 'fallback',
          selector: 'in_order',
          targets: [{ provider: 'provider-b', model: 'solid' }],
        },
      ],
    });
    const request = makeRequest();
    const candidates = await resolveEligible(config, request);
    expect(candidates.map((c) => c.model)).toEqual(['fast', 'premium', 'solid']);

    const { candidates: ordered } = await applyAutoRouting({
      request,
      alias: config.models.magic,
      canonicalModel: 'magic',
      candidates,
    });

    // The unsuitable economy target is dropped, not retained at a stale
    // position; the ordinary fallback group is untouched.
    expect(ordered.map((c) => c.model)).toEqual(['premium', 'solid']);
    expect(ordered[1]?.autoProvenance?.groupSelector).toBe('in_order');
  });

  it('uses declared baseline order without classifying when mode is off', async () => {
    const config = makeConfig({
      policy: { ...BASE_POLICY, mode: 'off' },
      groups: [
        {
          name: 'auto',
          selector: 'auto',
          targets: [
            { provider: 'provider-a', model: 'fast', auto_profile: { capability: 'economy' } },
            { provider: 'provider-a', model: 'premium', auto_profile: { capability: 'premium' } },
          ],
        },
      ],
    });
    const request = makeRequest();
    const candidates = await resolveEligible(config, request);

    const { candidates: ordered, decision } = await applyAutoRouting({
      request,
      alias: config.models.magic,
      canonicalModel: 'magic',
      candidates,
    });

    expect(ordered.map((c) => c.model)).toEqual(['fast', 'premium']);
    expect(decision).toEqual({});
    expect(vi.mocked(classifyAutoRequest)).not.toHaveBeenCalled();
  });

  it('runs within a direct group and does not expand other groups', async () => {
    const config = makeConfig({
      groups: [
        {
          name: 'auto',
          selector: 'auto',
          targets: [
            { provider: 'provider-a', model: 'fast', auto_profile: { capability: 'economy' } },
            { provider: 'provider-a', model: 'premium', auto_profile: { capability: 'premium' } },
          ],
        },
        {
          name: 'other',
          selector: 'in_order',
          targets: [{ provider: 'provider-b', model: 'solid' }],
        },
      ],
    });
    setConfigForTesting(config);
    const request = makeRequest({ model: 'direct/magic/auto' });
    const candidates = await Router.resolveCandidates('direct/magic/auto', 'chat', null);
    expect(candidates.map((c) => c.model)).toEqual(['fast', 'premium']);

    const { candidates: ordered } = await applyAutoRouting({
      request,
      alias: config.models.magic,
      canonicalModel: 'magic',
      candidates,
    });

    expect(ordered.map((c) => c.model)).toEqual(['premium']);
  });
});

describe('auto continuation detection', () => {
  it('detects a trailing tool result as a hard lock', () => {
    expect(
      detectAutoContinuationLock({
        messages: [{ role: 'tool', content: 'result', tool_call_id: 't1' }],
      } as any)
    ).toBe(true);
  });

  it('does not treat a Responses previous_response_id alone as a lock', () => {
    expect(
      detectAutoContinuationLock({
        previousResponseId: 'resp_123',
        messages: [
          { role: 'system', content: 'sys' },
          { role: 'user', content: 'new substantive question' },
        ],
      } as any)
    ).toBe(false);
  });

  it('detects signed reasoning in the continuation window as provider-bound', () => {
    expect(
      detectProviderBoundSignature({
        messages: [
          { role: 'user', content: 'do it' },
          { role: 'assistant', content: null, thinking: { content: '...', signature: 'sig-1' } },
        ],
      } as any)
    ).toBe(true);
  });

  it('treats a bare tool result as portable, not provider-bound', () => {
    expect(
      detectProviderBoundSignature({
        messages: [
          { role: 'user', content: 'do it' },
          { role: 'tool', content: 'result', tool_call_id: 't1' },
        ],
      } as any)
    ).toBe(false);
  });

  it('ignores signed reasoning from a completed turn before a new user message', () => {
    expect(
      detectProviderBoundSignature({
        messages: [
          { role: 'user', content: 'do it' },
          { role: 'assistant', content: null, thinking: { content: '...', signature: 'sig-1' } },
          { role: 'user', content: 'new substantive question' },
        ],
      } as any)
    ).toBe(false);
  });
});

describe('auto prefix fingerprint', () => {
  it('changes when tools or system content change', () => {
    const config = makeConfig({ groups: [] });
    const alias = config.models.magic;
    const base = makeRequest();
    const withTools = makeRequest({
      tools: [{ type: 'function', function: { name: 'x', parameters: {} } }],
    });
    const changedSystem = makeRequest({
      systemInstruction: { role: 'system', content: 'different system' },
    });

    const baseFp = deriveAutoPrefixFingerprint(base, alias);
    expect(baseFp).toBeTruthy();
    expect(deriveAutoPrefixFingerprint(withTools, alias)).not.toBe(baseFp);
    expect(deriveAutoPrefixFingerprint(changedSystem, alias)).not.toBe(baseFp);
    expect(deriveAutoPrefixFingerprint(base, alias)).toBe(baseFp);
  });

  it('returns undefined when compaction makes the prefix opaque', () => {
    const config = makeConfig({ groups: [], policy: BASE_POLICY });
    const alias = { ...config.models.magic, compaction: { enabled: true } };
    expect(deriveAutoPrefixFingerprint(makeRequest(), alias)).toBeUndefined();
  });
});

describe('auto state identity and continuation lifecycle', () => {
  beforeEach(() => {
    StickySessionManager.getInstance().clear();
    AutoStateStore.getInstance().resetForTesting();
    registerSpy(cooldownManager, 'filterHealthyTargets').mockImplementation(
      async (targets: any[]) => targets
    );
    vi.mocked(classifyAutoRequest).mockResolvedValue({
      judgment: judgment(),
      source: 'fresh',
      latencyMs: 1,
    });
  });

  afterEach(() => {
    cooldownManager.clearCooldown();
  });

  it('locks a multi-group continuation to only the incumbent target', async () => {
    const config = makeConfig({
      groups: [
        {
          name: 'g1',
          selector: 'auto',
          targets: [
            { provider: 'provider-a', model: 'fast', auto_profile: { capability: 'standard' } },
          ],
        },
        {
          name: 'g2',
          selector: 'auto',
          targets: [
            { provider: 'provider-a', model: 'premium', auto_profile: { capability: 'premium' } },
          ],
        },
      ],
    });
    const toolTurn = makeRequest({
      prompt_cache_key: 'branch-multi',
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'do it' },
        { role: 'tool', content: 'result', tool_call_id: 't1' },
      ],
    });
    const candidates = await resolveEligible(config, toolTurn);
    AutoStateStore.getInstance().recordIncumbent(
      buildAutoStateScope({
        keyId: 'key-1',
        alias: 'magic',
        apiType: 'chat',
        branch: 'branch-multi',
      }),
      { candidateId: 'provider-a/premium', provider: 'provider-a', model: 'premium' }
    );

    const result = await applyAutoRouting({
      request: toolTurn,
      alias: config.models.magic,
      canonicalModel: 'magic',
      candidates,
    });

    // The first-priority group is dropped entirely; only the locked target
    // remains as failover-free continuation.
    expect(result.candidates.map((c) => c.model)).toEqual(['premium']);
  });

  it('does not lock a cold portable tool turn and keeps the eligible target', async () => {
    const config = makeConfig({
      groups: [
        {
          name: 'auto',
          selector: 'auto',
          targets: [
            { provider: 'provider-a', model: 'premium', auto_profile: { capability: 'premium' } },
          ],
        },
      ],
    });
    const toolTurn = makeRequest({
      prompt_cache_key: 'cold-branch',
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'do it' },
        { role: 'tool', content: 'result', tool_call_id: 't1' },
      ],
    });
    const candidates = await resolveEligible(config, toolTurn);

    const result = await applyAutoRouting({
      request: toolTurn,
      alias: config.models.magic,
      canonicalModel: 'magic',
      candidates,
    });

    // A cold tool result is portable: no owner is known, so the request is not
    // pinned and instead ranks normally.
    expect(result.decision.continuationLocked).toBe(false);
    expect(result.candidates.map((c) => c.model)).toEqual(['premium']);
    expect(vi.mocked(classifyAutoRequest)).toHaveBeenCalled();
  });

  it('keeps the full eligible fallback for a cold portable tool turn across multiple auto groups', async () => {
    const config = makeConfig({
      groups: [
        {
          name: 'g1',
          selector: 'auto',
          targets: [
            { provider: 'provider-a', model: 'premium', auto_profile: { capability: 'premium' } },
          ],
        },
        {
          name: 'g2',
          selector: 'auto',
          targets: [
            { provider: 'provider-b', model: 'solid', auto_profile: { capability: 'premium' } },
          ],
        },
      ],
    });
    const toolTurn = makeRequest({
      prompt_cache_key: 'cold-portable-groups',
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'do it' },
        { role: 'tool', content: 'result', tool_call_id: 't1' },
      ],
    });
    const candidates = await resolveEligible(config, toolTurn);

    const result = await applyAutoRouting({
      request: toolTurn,
      alias: config.models.magic,
      canonicalModel: 'magic',
      candidates,
    });

    // No known owner means no arbitrary lock: every eligible group survives in
    // declaration order as fallback instead of one leaf being pinned.
    expect(result.decision.continuationLocked).toBe(false);
    expect(result.candidates.map((c) => c.model)).toEqual(['premium', 'solid']);
  });

  it('refuses provider-bound signed reasoning with no known owner', async () => {
    const config = makeConfig({
      groups: [
        {
          name: 'auto',
          selector: 'auto',
          targets: [
            { provider: 'provider-a', model: 'premium', auto_profile: { capability: 'premium' } },
          ],
        },
      ],
    });
    const request = makeRequest({
      prompt_cache_key: 'signed-unknown',
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'do it' },
        {
          role: 'assistant',
          content: null,
          thinking: { content: '...', signature: 'sig-abc' },
          tool_calls: [{ id: 't1', type: 'function', function: { name: 'x', arguments: '{}' } }],
        },
        { role: 'tool', content: 'result', tool_call_id: 't1' },
      ],
    });
    const candidates = await resolveEligible(config, request);

    await expect(
      applyAutoRouting({
        request,
        alias: config.models.magic,
        canonicalModel: 'magic',
        candidates,
      })
    ).rejects.toMatchObject({
      routingContext: { statusCode: 409, code: 'continuation_target_unavailable' },
    });
  });

  it('locks provider-bound signed reasoning to a known incumbent', async () => {
    const config = makeConfig({
      groups: [
        {
          name: 'auto',
          selector: 'auto',
          targets: [
            { provider: 'provider-a', model: 'premium', auto_profile: { capability: 'premium' } },
            { provider: 'provider-b', model: 'solid', auto_profile: { capability: 'premium' } },
          ],
        },
      ],
    });
    const request = makeRequest({
      prompt_cache_key: 'signed-known',
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'do it' },
        {
          role: 'assistant',
          content: null,
          thinking: { content: '...', signature: 'sig-abc' },
          tool_calls: [{ id: 't1', type: 'function', function: { name: 'x', arguments: '{}' } }],
        },
        { role: 'tool', content: 'result', tool_call_id: 't1' },
      ],
    });
    const scope = buildAutoStateScope({
      keyId: 'key-1',
      alias: 'magic',
      apiType: 'chat',
      branch: 'signed-known',
    });
    AutoStateStore.getInstance().recordIncumbent(scope, {
      candidateId: 'provider-b/solid',
      provider: 'provider-b',
      model: 'solid',
    });
    const candidates = await resolveEligible(config, request);

    const result = await applyAutoRouting({
      request,
      alias: config.models.magic,
      canonicalModel: 'magic',
      candidates,
    });

    expect(result.decision.continuationLocked).toBe(true);
    expect(result.candidates.map((c) => c.model)).toEqual(['solid']);
    expect(vi.mocked(classifyAutoRequest)).not.toHaveBeenCalled();
  });

  it('disables state when no authenticated API-key identity is present', async () => {
    const config = makeConfig({
      groups: [
        {
          name: 'auto',
          selector: 'auto',
          targets: [
            { provider: 'provider-a', model: 'premium', auto_profile: { capability: 'premium' } },
          ],
        },
      ],
    });
    const request = makeRequest({ metadata: {} });
    const candidates = await resolveEligible(config, request);

    const { decision } = await applyAutoRouting({
      request,
      alias: config.models.magic,
      canonicalModel: 'magic',
      candidates,
    });

    expect(decision.keyId).toBeNull();
    expect(AutoStateStore.getInstance().size()).toBe(0);
  });

  it('clears a stored continuation lock at a new substantive user turn', async () => {
    const config = makeConfig({
      groups: [
        {
          name: 'auto',
          selector: 'auto',
          targets: [
            { provider: 'provider-a', model: 'premium', auto_profile: { capability: 'premium' } },
          ],
        },
      ],
    });
    // Establish an incumbent so the lock has a target to retain.
    const normalTurn = makeRequest({
      prompt_cache_key: 'branch-1',
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'start here' },
      ],
    });
    const candidates = await resolveEligible(config, normalTurn);
    const initial = await applyAutoRouting({
      request: normalTurn,
      alias: config.models.magic,
      canonicalModel: 'magic',
      candidates,
    });
    recordAutoRoutingOutcome(normalTurn, initial.candidates[0]!);

    const toolTurn = makeRequest({
      prompt_cache_key: 'branch-1',
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'do it' },
        { role: 'tool', content: 'result', tool_call_id: 't1' },
      ],
    });
    const first = await applyAutoRouting({
      request: toolTurn,
      alias: config.models.magic,
      canonicalModel: 'magic',
      candidates,
    });
    expect(first.decision.continuationLocked).toBe(true);

    const freshTurn = makeRequest({
      prompt_cache_key: 'branch-1',
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'now do a brand new substantive thing' },
      ],
    });
    const second = await applyAutoRouting({
      request: freshTurn,
      alias: config.models.magic,
      canonicalModel: 'magic',
      candidates,
    });
    expect(second.decision.continuationLocked).toBe(false);
  });

  it('maps an alias-ref leaf observation to its logical target on the next request', async () => {
    const config = makeConfig({
      groups: [
        {
          name: 'auto',
          selector: 'auto',
          targets: [
            {
              alias: 'child-alias',
              auto_profile: { capability: 'premium', specialties: [], reasoning: 'preferred' },
            },
          ],
        },
      ],
    });
    const request = makeRequest({ prompt_cache_key: 'branch-2' });
    const candidates = await resolveEligible(config, request);
    const { candidates: ordered } = await applyAutoRouting({
      request,
      alias: config.models.magic,
      canonicalModel: 'magic',
      candidates,
    });
    const dispatched = ordered[0]!;
    expect(dispatched.autoProvenance?.targetKey).toBe('alias:child-alias');

    recordAutoRoutingOutcome(request, dispatched, { cachedTokens: 500, cacheWriteTokens: 0 });

    const scope = buildAutoStateScope({
      keyId: 'key-1',
      alias: 'magic',
      apiType: 'chat',
      branch: 'branch-2',
    });
    const snapshot = AutoStateStore.getInstance().snapshot(scope);
    // Warmth is stored against the real dispatched leaf...
    expect(snapshot?.observations['provider-b/child-fast']).toMatchObject({
      cachedInputTokens: 500,
    });

    const second = await applyAutoRouting({
      request,
      alias: config.models.magic,
      canonicalModel: 'magic',
      candidates,
    });
    const group = (second.decision.groups as any[])[0];
    // ...and mapped back onto the logical target for ranking.
    expect(group.costEvidence['alias:child-alias'].warmth).toBe('warm');
  });
});

describe('recordAutoRoutingOutcome', () => {
  beforeEach(() => {
    AutoStateStore.getInstance().resetForTesting();
    vi.mocked(classifyAutoRequest).mockResolvedValue({
      judgment: judgment(),
      source: 'fresh',
      latencyMs: 1,
    });
  });

  it('records the actually-dispatched target as incumbent with cache usage', async () => {
    const config = makeConfig({
      groups: [
        {
          name: 'auto',
          selector: 'auto',
          targets: [
            { provider: 'provider-a', model: 'premium', auto_profile: { capability: 'premium' } },
          ],
        },
      ],
    });
    registerSpy(cooldownManager, 'filterHealthyTargets').mockImplementation(
      async (targets: any[]) => targets
    );
    const request = makeRequest();
    const candidates = await resolveEligible(config, request);
    const { candidates: ordered, decision } = await applyAutoRouting({
      request,
      alias: config.models.magic,
      canonicalModel: 'magic',
      candidates,
    });

    recordAutoRoutingOutcome(request, ordered[0]!, { cachedTokens: 120, cacheWriteTokens: 30 });

    const snapshot = AutoStateStore.getInstance().snapshot(decision.stateScope as string);
    expect(snapshot?.incumbent).toMatchObject({
      candidateId: 'provider-a/premium',
      provider: 'provider-a',
      model: 'premium',
    });
    expect(snapshot?.observations['provider-a/premium']).toMatchObject({
      cachedInputTokens: 120,
      cacheWriteTokens: 30,
    });
  });
});

describe('auto routing runtime regressions', () => {
  beforeEach(() => {
    StickySessionManager.getInstance().clear();
    AutoStateStore.getInstance().resetForTesting();
    registerSpy(cooldownManager, 'filterHealthyTargets').mockImplementation(
      async (targets: any[]) => targets
    );
    vi.mocked(classifyAutoRequest).mockResolvedValue({
      judgment: judgment(),
      source: 'fresh',
      latencyMs: 1,
    });
  });

  afterEach(() => {
    cooldownManager.clearCooldown();
  });

  it('keeps shared leaves through ranking, then dedupes the first ordered path', async () => {
    const config = makeConfig({
      extraModels: {
        'expensive-alias': {
          type: 'text',
          target_groups: [
            {
              name: 'child',
              selector: 'in_order',
              targets: [
                { provider: 'provider-b', model: 'child-smart' },
                { provider: 'provider-b', model: 'child-fast' },
              ],
            },
          ],
        },
      },
      groups: [
        {
          name: 'auto',
          selector: 'auto',
          targets: [
            {
              alias: 'expensive-alias',
              auto_profile: { capability: 'premium', specialties: [], reasoning: 'preferred' },
            },
            {
              provider: 'provider-b',
              model: 'child-fast',
              auto_profile: { capability: 'economy', specialties: [] },
            },
          ],
        },
      ],
    });
    vi.mocked(classifyAutoRequest).mockResolvedValue({
      judgment: judgment({ complexity: 0, capability_required: 0, deep_reasoning: 0 }),
      source: 'fresh',
      latencyMs: 1,
    });
    const request = makeRequest({ prompt_cache_key: 'shared-leaf' });
    const candidates = await resolveEligible(config, request);

    // The router must preserve the shared leaf's later path until ranking.
    expect(candidates.filter((c) => c.model === 'child-fast')).toHaveLength(2);

    const { candidates: ordered } = await applyAutoRouting({
      request,
      alias: config.models.magic,
      canonicalModel: 'magic',
      candidates,
    });

    expect(ordered.map((c) => c.model)).toEqual(['child-fast', 'child-smart']);
    expect(ordered.filter((c) => c.model === 'child-fast')).toHaveLength(1);
    expect(ordered[0]?.autoProvenance).toMatchObject({
      targetKey: 'provider-b/child-fast',
      profile: { capability: 'economy' },
    });
  });

  it('marks a provider-compacted candidate as uncertain warmth', async () => {
    const config = makeConfig({
      groups: [
        {
          name: 'auto',
          selector: 'auto',
          targets: [
            { provider: 'provider-a', model: 'premium', auto_profile: { capability: 'premium' } },
          ],
        },
      ],
    });
    config.providers['provider-a'].compaction = { enabled: true };
    const request = makeRequest({ prompt_cache_key: 'opaque-branch' });
    const candidates = await resolveEligible(config, request);

    const first = await applyAutoRouting({
      request,
      alias: config.models.magic,
      canonicalModel: 'magic',
      candidates,
    });
    recordAutoRoutingOutcome(request, first.candidates[0]!, {
      cachedTokens: 700,
      cacheWriteTokens: 0,
    });

    const second = await applyAutoRouting({
      request,
      alias: config.models.magic,
      canonicalModel: 'magic',
      candidates,
    });
    const group = (second.decision.groups as any[])[0];
    expect(group.costEvidence['provider-a/premium'].warmth).toBe('uncertain');
  });

  it('keeps branchless requests stateless so they cannot evict real scopes', async () => {
    const config = makeConfig({
      groups: [
        {
          name: 'auto',
          selector: 'auto',
          targets: [
            { provider: 'provider-a', model: 'premium', auto_profile: { capability: 'premium' } },
          ],
        },
      ],
    });
    // Fewer than two messages strips the first-messages branch anchor; without
    // a stable branch there is no session to read or write.
    const request = makeRequest({ messages: [{ role: 'user', content: 'single turn' }] });
    const candidates = await resolveEligible(config, request);

    const { candidates: ordered, decision } = await applyAutoRouting({
      request,
      alias: config.models.magic,
      canonicalModel: 'magic',
      candidates,
    });
    expect(decision.stateScope).toBeNull();

    recordAutoRoutingOutcome(request, ordered[0]!, { cachedTokens: 321, cacheWriteTokens: 0 });
    expect(AutoStateStore.getInstance().size()).toBe(0);
  });

  it('does not lock a cold portable tool turn and preserves the eligible child fallback chain', async () => {
    const config = makeConfig({
      groups: [
        {
          name: 'auto',
          selector: 'auto',
          targets: [{ alias: 'child-alias', auto_profile: { capability: 'premium' } }],
        },
      ],
    });
    const toolTurn = makeRequest({
      prompt_cache_key: 'cold-multi-leaf',
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'do it' },
        { role: 'tool', content: 'result', tool_call_id: 't1' },
      ],
    });
    const candidates = await resolveEligible(config, toolTurn);

    const result = await applyAutoRouting({
      request: toolTurn,
      alias: config.models.magic,
      canonicalModel: 'magic',
      candidates,
    });

    // Portable tool history does not pin the first child leaf; the eligible
    // child fallback chain is retained through normal ranking.
    expect(result.decision.continuationLocked).toBe(false);
    expect(result.candidates.map((c) => c.model)).toEqual(['child-fast', 'child-smart']);
  });

  it('records zero cache usage, overwriting prior warmth', async () => {
    const config = makeConfig({
      groups: [
        {
          name: 'auto',
          selector: 'auto',
          targets: [
            { provider: 'provider-a', model: 'premium', auto_profile: { capability: 'premium' } },
          ],
        },
      ],
    });
    const request = makeRequest({ prompt_cache_key: 'zero-usage' });
    const candidates = await resolveEligible(config, request);
    const { candidates: ordered, decision } = await applyAutoRouting({
      request,
      alias: config.models.magic,
      canonicalModel: 'magic',
      candidates,
    });
    const scope = decision.stateScope as string;

    recordAutoRoutingOutcome(request, ordered[0]!, { cachedTokens: 500, cacheWriteTokens: 0 });
    expect(
      AutoStateStore.getInstance().snapshot(scope)?.observations['provider-a/premium']
    ).toMatchObject({ cachedInputTokens: 500 });

    recordAutoRoutingOutcome(request, ordered[0]!, { cachedTokens: 0, cacheWriteTokens: 0 });
    expect(
      AutoStateStore.getInstance().snapshot(scope)?.observations['provider-a/premium']
    ).toMatchObject({ cachedInputTokens: 0, cacheWriteTokens: 0 });
  });

  it('returns zero-valued usage instead of undefined', () => {
    expect(
      autoObservedUsageFromResponse({
        usage: { cached_tokens: 0, cache_creation_tokens: 0 },
      } as any)
    ).toEqual({ cachedTokens: 0, cacheWriteTokens: 0 });
  });

  it('does not let a repeated same-sequence outcome overwrite the incumbent', async () => {
    const config = makeConfig({
      groups: [
        {
          name: 'auto',
          selector: 'auto',
          targets: [
            { provider: 'provider-a', model: 'premium', auto_profile: { capability: 'premium' } },
            { provider: 'provider-a', model: 'fast', auto_profile: { capability: 'economy' } },
          ],
        },
      ],
    });
    const request = makeRequest({ prompt_cache_key: 'same-sequence' });
    vi.mocked(classifyAutoRequest).mockResolvedValue({
      judgment: judgment({ complexity: 0, capability_required: 0, deep_reasoning: 0 }),
      source: 'fresh',
      latencyMs: 1,
    });
    const candidates = await resolveEligible(config, request);
    const { candidates: ordered, decision } = await applyAutoRouting({
      request,
      alias: config.models.magic,
      canonicalModel: 'magic',
      candidates,
    });
    const premium = ordered.find((c) => c.model === 'premium')!;
    const fast = ordered.find((c) => c.model === 'fast')!;

    recordAutoRoutingOutcome(request, premium, { cachedTokens: 100, cacheWriteTokens: 0 });
    recordAutoRoutingOutcome(request, fast, { cachedTokens: 100, cacheWriteTokens: 0 });

    const snapshot = AutoStateStore.getInstance().snapshot(decision.stateScope as string);
    expect(snapshot?.incumbent).toMatchObject({ model: 'premium' });
  });

  it('does not classify a locked continuation turn', async () => {
    const config = makeConfig({
      groups: [
        {
          name: 'auto',
          selector: 'auto',
          targets: [
            { provider: 'provider-a', model: 'premium', auto_profile: { capability: 'premium' } },
          ],
        },
      ],
    });
    const toolTurn = makeRequest({
      prompt_cache_key: 'locked-skip',
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'do it' },
        { role: 'tool', content: 'result', tool_call_id: 't1' },
      ],
    });
    const candidates = await resolveEligible(config, toolTurn);
    AutoStateStore.getInstance().recordIncumbent(
      buildAutoStateScope({
        keyId: 'key-1',
        alias: 'magic',
        apiType: 'chat',
        branch: 'locked-skip',
      }),
      { candidateId: 'provider-a/premium', provider: 'provider-a', model: 'premium' }
    );

    const result = await applyAutoRouting({
      request: toolTurn,
      alias: config.models.magic,
      canonicalModel: 'magic',
      candidates,
    });

    expect(result.decision.continuationLocked).toBe(true);
    expect(vi.mocked(classifyAutoRequest)).not.toHaveBeenCalled();
  });

  it('does not treat a stored lock as hard for a soft acknowledgement', async () => {
    const config = makeConfig({
      groups: [
        {
          name: 'auto',
          selector: 'auto',
          targets: [
            { provider: 'provider-a', model: 'premium', auto_profile: { capability: 'premium' } },
          ],
        },
      ],
    });
    const toolTurn = makeRequest({
      prompt_cache_key: 'soft-ack',
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'do it' },
        { role: 'tool', content: 'result', tool_call_id: 't1' },
      ],
    });
    const toolCandidates = await resolveEligible(config, toolTurn);
    AutoStateStore.getInstance().recordIncumbent(
      buildAutoStateScope({
        keyId: 'key-1',
        alias: 'magic',
        apiType: 'chat',
        branch: 'soft-ack',
      }),
      { candidateId: 'provider-a/premium', provider: 'provider-a', model: 'premium' }
    );
    const locked = await applyAutoRouting({
      request: toolTurn,
      alias: config.models.magic,
      canonicalModel: 'magic',
      candidates: toolCandidates,
    });
    expect(locked.decision.continuationLocked).toBe(true);

    const ack = makeRequest({
      prompt_cache_key: 'soft-ack',
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'do it' },
        { role: 'assistant', content: 'done' },
        { role: 'user', content: 'thanks' },
      ],
    });
    const ackCandidates = await resolveEligible(config, ack);
    const result = await applyAutoRouting({
      request: ack,
      alias: config.models.magic,
      canonicalModel: 'magic',
      candidates: ackCandidates,
    });

    expect(result.decision.continuationLocked).toBe(false);
    expect(vi.mocked(classifyAutoRequest)).toHaveBeenCalled();
  });

  it('strips ordinary fallback groups during a locked continuation', async () => {
    const config = makeConfig({
      groups: [
        {
          name: 'auto',
          selector: 'auto',
          targets: [
            { provider: 'provider-a', model: 'premium', auto_profile: { capability: 'premium' } },
          ],
        },
        {
          name: 'fallback',
          selector: 'in_order',
          targets: [{ provider: 'provider-b', model: 'solid' }],
        },
      ],
    });
    const first = makeRequest({ prompt_cache_key: 'aliaswide' });
    const firstCandidates = await resolveEligible(config, first);
    const initial = await applyAutoRouting({
      request: first,
      alias: config.models.magic,
      canonicalModel: 'magic',
      candidates: firstCandidates,
    });
    recordAutoRoutingOutcome(first, initial.candidates[0]!);

    const toolTurn = makeRequest({
      prompt_cache_key: 'aliaswide',
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'do it' },
        { role: 'tool', content: 'result', tool_call_id: 't1' },
      ],
    });
    const toolCandidates = await resolveEligible(config, toolTurn);
    const result = await applyAutoRouting({
      request: toolTurn,
      alias: config.models.magic,
      canonicalModel: 'magic',
      candidates: toolCandidates,
    });

    expect(result.candidates.map((c) => c.model)).toEqual(['premium']);
  });

  it('traces incumbent_unavailable when the incumbent is no longer eligible', async () => {
    const config = makeConfig({
      groups: [
        {
          name: 'auto',
          selector: 'auto',
          targets: [
            { provider: 'provider-b', model: 'solid', auto_profile: { capability: 'premium' } },
            { provider: 'provider-a', model: 'fast', auto_profile: { capability: 'economy' } },
          ],
        },
      ],
    });
    const request = makeRequest({ prompt_cache_key: 'inc-unavail' });
    const scope = buildAutoStateScope({
      keyId: 'key-1',
      alias: 'magic',
      apiType: 'chat',
      branch: 'inc-unavail',
    });
    AutoStateStore.getInstance().recordIncumbent(scope, {
      candidateId: 'provider-a/premium',
      provider: 'provider-a',
      model: 'premium',
    });
    const candidates = await resolveEligible(config, request);

    const { decision } = await applyAutoRouting({
      request,
      alias: config.models.magic,
      canonicalModel: 'magic',
      candidates,
    });

    expect(decision.reasons).toContain('incumbent_unavailable');
  });

  it('uses the incumbent leaf as the block representative for warmth', async () => {
    const config = makeConfig({
      groups: [
        {
          name: 'auto',
          selector: 'auto',
          targets: [{ alias: 'child-alias', auto_profile: { capability: 'premium' } }],
        },
      ],
    });
    const request = makeRequest({ prompt_cache_key: 'inc-leaf' });
    const scope = buildAutoStateScope({
      keyId: 'key-1',
      alias: 'magic',
      apiType: 'chat',
      branch: 'inc-leaf',
    });
    const fingerprint = deriveAutoPrefixFingerprint(request, config.models.magic);
    AutoStateStore.getInstance().recordIncumbent(scope, {
      candidateId: 'alias:child-alias',
      provider: 'provider-b',
      model: 'child-smart',
    });
    AutoStateStore.getInstance().recordObservation(scope, 'provider-b/child-smart', {
      cachedInputTokens: 400,
      cacheWriteTokens: 0,
      prefixFingerprint: fingerprint,
    });
    const candidates = await resolveEligible(config, request);

    const { decision } = await applyAutoRouting({
      request,
      alias: config.models.magic,
      canonicalModel: 'magic',
      candidates,
    });

    const group = (decision.groups as any[])[0];
    expect(group.costEvidence['alias:child-alias'].warmth).toBe('warm');
  });
});
