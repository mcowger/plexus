import { describe, expect, test, beforeEach } from 'vitest';
import { registerSpy } from '../../../test/test-utils';
import { Router } from '../router';
import { setConfigForTesting } from '../../config';
import { CooldownManager } from '../cooldown-manager';
import { StickySessionManager } from '../sticky-session-manager';

function configWithThreeTargets(): any {
  return {
    providers: {
      p1: {
        type: 'openai',
        api_base_url: 'http://localhost',
        enabled: true,
        models: { m1: { pricing: { source: 'simple', input: 1, output: 1 } } },
      },
      p2: {
        type: 'openai',
        api_base_url: 'http://localhost',
        enabled: true,
        models: { m2: { pricing: { source: 'simple', input: 1, output: 1 } } },
      },
      p3: {
        type: 'openai',
        api_base_url: 'http://localhost',
        enabled: true,
        models: { m3: { pricing: { source: 'simple', input: 1, output: 1 } } },
      },
    },
    models: {
      'sticky-alias': {
        selector: 'in_order',
        sticky_session: true,
        targets: [
          { provider: 'p1', model: 'm1' },
          { provider: 'p2', model: 'm2' },
          { provider: 'p3', model: 'm3' },
        ],
      },
    },
    keys: {},
  };
}

describe('Router sticky_session integration', () => {
  beforeEach(() => {
    StickySessionManager.getInstance().clear();
    // Default: all targets healthy, in submitted order.
    registerSpy(CooldownManager.getInstance(), 'filterHealthyTargets').mockImplementation(
      async (targets: any[]) => targets
    );
  });

  test('hoists the sticky target to position 0 when present and healthy', async () => {
    setConfigForTesting(configWithThreeTargets() as any);

    StickySessionManager.getInstance().set('sticky-alias', 'm:abc', 'p3', 'm3');

    const result = await Router.resolveCandidates('sticky-alias', 'chat', 'm:abc');

    expect(result).toHaveLength(3);
    expect(result[0]?.provider).toBe('p3');
    expect(result[0]?.model).toBe('m3');
    // The other two targets are still in the candidate list for failover.
    const remaining = result.slice(1).map((r) => `${r.provider}/${r.model}`);
    expect(remaining).toContain('p1/m1');
    expect(remaining).toContain('p2/m2');
  });

  test('does not hoist when sticky_session flag is disabled on the alias', async () => {
    const cfg = configWithThreeTargets();
    cfg.models['sticky-alias'].sticky_session = false;
    setConfigForTesting(cfg as any);

    StickySessionManager.getInstance().set('sticky-alias', 'm:abc', 'p3', 'm3');

    const result = await Router.resolveCandidates('sticky-alias', 'chat', 'm:abc');

    // Selector is 'in_order', so default ordering puts p1 first.
    expect(result[0]?.provider).toBe('p1');
  });

  test('does not hoist when no session key is provided (single-turn request)', async () => {
    setConfigForTesting(configWithThreeTargets() as any);

    StickySessionManager.getInstance().set('sticky-alias', 'm:abc', 'p3', 'm3');

    const result = await Router.resolveCandidates('sticky-alias', 'chat', null);

    expect(result[0]?.provider).toBe('p1');
  });

  test('falls back to normal ordering when sticky pick is on cooldown', async () => {
    setConfigForTesting(configWithThreeTargets() as any);

    // p3 is unhealthy — gets filtered out.
    registerSpy(CooldownManager.getInstance(), 'filterHealthyTargets').mockImplementation(
      async (targets: any[]) => targets.filter((t: any) => t.provider !== 'p3')
    );

    StickySessionManager.getInstance().set('sticky-alias', 'm:abc', 'p3', 'm3');

    const result = await Router.resolveCandidates('sticky-alias', 'chat', 'm:abc');

    expect(result).toHaveLength(2);
    // p3 isn't a candidate, so normal selector order wins (p1 first).
    expect(result[0]?.provider).toBe('p1');
  });

  test('falls back to normal ordering when sticky pick no longer exists in alias targets', async () => {
    setConfigForTesting(configWithThreeTargets() as any);

    // Stored target points at a provider that is no longer in the alias config.
    StickySessionManager.getInstance().set('sticky-alias', 'm:abc', 'removed', 'gone');

    const result = await Router.resolveCandidates('sticky-alias', 'chat', 'm:abc');

    expect(result).toHaveLength(3);
    expect(result[0]?.provider).toBe('p1');
  });

  test('alias isolation: sticky entry for one alias does not affect another', async () => {
    const cfg = configWithThreeTargets();
    cfg.models['other-alias'] = {
      selector: 'in_order',
      sticky_session: true,
      targets: [
        { provider: 'p1', model: 'm1' },
        { provider: 'p2', model: 'm2' },
        { provider: 'p3', model: 'm3' },
      ],
    } as any;
    setConfigForTesting(cfg as any);

    StickySessionManager.getInstance().set('sticky-alias', 'm:abc', 'p3', 'm3');

    const result = await Router.resolveCandidates('other-alias', 'chat', 'm:abc');

    // Same session key, different alias → no hoist.
    expect(result[0]?.provider).toBe('p1');
  });

  test('different session keys on the same alias route independently (no cross-session leak)', async () => {
    setConfigForTesting(configWithThreeTargets() as any);

    StickySessionManager.getInstance().set('sticky-alias', 'm:session-A', 'p3', 'm3');

    // Lookup with a DIFFERENT session key on the same alias — must not hoist p3.
    const result = await Router.resolveCandidates('sticky-alias', 'chat', 'm:session-B');

    expect(result[0]?.provider).toBe('p1');
    // The session-A entry is untouched and still hoists when looked up.
    const resultA = await Router.resolveCandidates('sticky-alias', 'chat', 'm:session-A');
    expect(resultA[0]?.provider).toBe('p3');
  });

  test('uses canonical alias name for sticky lookup when called via additional_alias', async () => {
    const cfg = configWithThreeTargets();
    cfg.models['sticky-alias'].additional_aliases = ['nickname'] as any;
    setConfigForTesting(cfg as any);

    // Sticky entry was stored under the canonical name.
    StickySessionManager.getInstance().set('sticky-alias', 'm:abc', 'p3', 'm3');

    const result = await Router.resolveCandidates('nickname', 'chat', 'm:abc');

    expect(result[0]?.provider).toBe('p3');
  });
});
