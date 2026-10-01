import { beforeEach, describe, expect, it } from 'vitest';
import { AutoStateStore, buildAutoStateScope } from '../auto-state';
import type { AutoJudgment } from '../auto-policy';

const NOW = 1_000_000;

const judgment: AutoJudgment = {
  task_kind: 'chat',
  complexity: 1,
  capability_required: 1,
  deep_reasoning: 0,
};

describe('auto state: scope keys', () => {
  it('isolates tenants by key, alias, contract, and branch', () => {
    const a = buildAutoStateScope({ keyId: 'k1', alias: 'alias', apiType: 'chat', branch: 'b' });
    const b = buildAutoStateScope({ keyId: 'k2', alias: 'alias', apiType: 'chat', branch: 'b' });
    expect(a).not.toBe(b);

    const aliasDiff = buildAutoStateScope({
      keyId: 'k1',
      alias: 'other',
      apiType: 'chat',
      requestUnique: 'r1',
    });
    expect(aliasDiff).not.toBe(
      buildAutoStateScope({
        keyId: 'k1',
        alias: 'alias',
        apiType: 'chat',
        requestUnique: 'r1',
      })
    );

    const branchDiff = buildAutoStateScope({
      keyId: 'k1',
      alias: 'alias',
      apiType: 'chat',
      branch: 'b2',
    });
    expect(branchDiff).not.toBe(a);
  });

  it('normalizes API contract casing and whitespace', () => {
    expect(
      buildAutoStateScope({ keyId: 'k1', alias: 'a', apiType: 'CHAT', requestUnique: 'r1' })
    ).toBe(
      buildAutoStateScope({ keyId: 'k1', alias: 'a', apiType: ' chat ', requestUnique: 'r1' })
    );
  });

  it('does not collapse branchless requests onto one shared scope', () => {
    const a = buildAutoStateScope({ keyId: 'k1', alias: 'a', apiType: 'chat' });
    const b = buildAutoStateScope({ keyId: 'k1', alias: 'a', apiType: 'chat' });
    expect(a).not.toBe(b);

    // The parent runtime's request-unique coordinate keeps read and write in
    // the same branchless scope without leaking across conversations.
    const first = buildAutoStateScope({
      keyId: 'k1',
      alias: 'a',
      apiType: 'chat',
      requestUnique: 'req-1',
    });
    const second = buildAutoStateScope({
      keyId: 'k1',
      alias: 'a',
      apiType: 'chat',
      requestUnique: 'req-1',
    });
    expect(first).toBe(second);
    expect(first).not.toBe(
      buildAutoStateScope({
        keyId: 'k1',
        alias: 'a',
        apiType: 'chat',
        requestUnique: 'req-2',
      })
    );
    expect(first).not.toBe(a);
  });
});

describe('auto state: incumbent and observations', () => {
  let store: AutoStateStore;
  let scope: string;

  beforeEach(() => {
    store = new AutoStateStore();
    scope = buildAutoStateScope({ keyId: 'k1', alias: 'a', apiType: 'chat', branch: 'b' });
  });

  it('keeps incumbents isolated per scope', () => {
    const otherScope = buildAutoStateScope({
      keyId: 'k2',
      alias: 'a',
      apiType: 'chat',
      branch: 'b',
    });
    store.recordIncumbent(scope, {
      candidateId: 'm1',
      provider: 'p',
      model: 'm',
      now: NOW,
    });
    expect(store.getIncumbent(scope, NOW)?.candidateId).toBe('m1');
    expect(store.getIncumbent(otherScope, NOW)).toBeNull();
  });

  it('ignores late incumbent writes from older sequences', () => {
    store.recordIncumbent(scope, {
      candidateId: 'old',
      provider: 'p',
      model: 'm',
      sequence: 5,
      now: NOW,
    });
    const applied = store.recordIncumbent(scope, {
      candidateId: 'new',
      provider: 'p',
      model: 'm',
      sequence: 4,
      now: NOW + 1,
    });
    expect(applied).toBe(false);
    expect(store.getIncumbent(scope, NOW + 1)?.candidateId).toBe('old');

    store.recordIncumbent(scope, {
      candidateId: 'new',
      provider: 'p',
      model: 'm',
      sequence: 6,
      now: NOW + 2,
    });
    expect(store.getIncumbent(scope, NOW + 2)?.candidateId).toBe('new');
  });

  it('rejects a late incumbent after a newer session operation', () => {
    // A newer observation advances the session sequence...
    store.recordObservation(scope, 'm2', {
      cachedInputTokens: 10,
      cacheWriteTokens: 0,
      sequence: 10,
      now: NOW,
    });
    // ...so a completion from an older request must not become incumbent.
    const applied = store.recordIncumbent(scope, {
      candidateId: 'stale',
      provider: 'p',
      model: 'm',
      sequence: 9,
      now: NOW + 1,
    });
    expect(applied).toBe(false);
    expect(store.getIncumbent(scope, NOW + 1)).toBeNull();
  });

  it('expires observations by TTL and rejects prefix mismatches', () => {
    store.recordObservation(scope, 'm1', {
      cachedInputTokens: 100,
      cacheWriteTokens: 0,
      prefixFingerprint: 'p',
      ttlMs: 1000,
      now: NOW,
    });
    expect(store.getWarmth(scope, 'm1', 'p', NOW + 500)).not.toBeNull();
    expect(store.getWarmth(scope, 'm1', 'other', NOW + 500)).toBeNull();
    expect(store.getWarmth(scope, 'm1', 'p', NOW + 2001)).toBeNull();
  });

  it('ignores late observation writes for a target', () => {
    store.recordObservation(scope, 'm1', {
      cachedInputTokens: 100,
      cacheWriteTokens: 0,
      sequence: 10,
      now: NOW,
    });
    const applied = store.recordObservation(scope, 'm1', {
      cachedInputTokens: 999,
      cacheWriteTokens: 0,
      sequence: 9,
      now: NOW + 1,
    });
    expect(applied).toBe(false);
    expect(store.getWarmth(scope, 'm1', undefined, NOW)?.cachedInputTokens).toBe(100);
  });

  it('ignores a late observation after a newer session operation', () => {
    store.recordObservation(scope, 'm1', {
      cachedInputTokens: 100,
      cacheWriteTokens: 0,
      sequence: 10,
      now: NOW,
    });
    const applied = store.recordObservation(scope, 'm2', {
      cachedInputTokens: 999,
      cacheWriteTokens: 0,
      sequence: 9,
      now: NOW + 1,
    });
    expect(applied).toBe(false);
    expect(store.getWarmth(scope, 'm2', undefined, NOW + 1)).toBeNull();
  });

  it('returns the observation when the caller does not know the prefix', () => {
    store.recordObservation(scope, 'm1', {
      cachedInputTokens: 100,
      cacheWriteTokens: 0,
      prefixFingerprint: 'p',
      ttlMs: 1000,
      now: NOW,
    });
    expect(store.getWarmth(scope, 'm1', undefined, NOW)).not.toBeNull();
  });
});

describe('auto state: judgments, continuation, and lifecycle', () => {
  let store: AutoStateStore;
  let scope: string;

  beforeEach(() => {
    store = new AutoStateStore();
    scope = buildAutoStateScope({ keyId: 'k1', alias: 'a', apiType: 'chat', branch: 'b' });
  });

  it('caches judgments by caller key and expires them', () => {
    store.recordJudgment(scope, {
      key: 'fingerprint',
      judgment,
      rubricVersion: 1,
      classifierId: 'judge',
      ttlMs: 1000,
      now: NOW,
    });
    expect(store.getJudgment(scope, 'fingerprint', NOW + 500)?.judgment).toEqual(judgment);
    expect(store.getJudgment(scope, 'other', NOW + 500)).toBeNull();
    expect(store.getJudgment(scope, 'fingerprint', NOW + 2001)).toBeNull();
  });

  it('bounds cached judgments per session and evicts the oldest', () => {
    const capped = new AutoStateStore({ maxJudgmentsPerSession: 2 });
    for (let i = 0; i < 3; i++) {
      capped.recordJudgment(scope, {
        key: `fp-${i}`,
        judgment,
        rubricVersion: 1,
        classifierId: 'judge',
        now: NOW + i,
      });
    }
    expect(capped.getJudgment(scope, 'fp-0', NOW + 3)).toBeNull();
    expect(capped.getJudgment(scope, 'fp-1', NOW + 3)).not.toBeNull();
    expect(capped.getJudgment(scope, 'fp-2', NOW + 3)).not.toBeNull();
  });

  it('tracks continuation locks', () => {
    store.setContinuation(scope, true, undefined, NOW);
    expect(store.getContinuation(scope, NOW)?.locked).toBe(true);
    store.setContinuation(scope, false, undefined, NOW + 1);
    expect(store.getContinuation(scope, NOW + 1)?.locked).toBe(false);
  });

  it('retains the locked target identity and clears it on release', () => {
    store.setContinuation(scope, true, undefined, NOW, {
      candidateId: 'provider-a/premium',
      provider: 'provider-a',
      model: 'premium',
    });
    expect(store.getContinuation(scope, NOW)).toMatchObject({
      locked: true,
      candidateId: 'provider-a/premium',
      provider: 'provider-a',
      model: 'premium',
    });

    // A later lock update without a target preserves the earlier identity.
    store.setContinuation(scope, true, undefined, NOW + 1);
    expect(store.getContinuation(scope, NOW + 1)?.candidateId).toBe('provider-a/premium');

    store.setContinuation(scope, false, undefined, NOW + 2);
    expect(store.getContinuation(scope, NOW + 2)?.candidateId).toBeUndefined();
  });

  it('evicts the oldest session when over the bound', () => {
    const bounded = new AutoStateStore({ maxSessions: 2, sessionTtlMs: 10_000_000 });
    bounded.recordIncumbent('s1', { candidateId: 'a', provider: 'p', model: 'm', now: NOW });
    bounded.recordIncumbent('s2', { candidateId: 'b', provider: 'p', model: 'm', now: NOW });
    bounded.recordIncumbent('s3', { candidateId: 'c', provider: 'p', model: 'm', now: NOW });
    expect(bounded.size()).toBe(2);
    expect(bounded.getIncumbent('s1', NOW + 2)).toBeNull();
    expect(bounded.getIncumbent('s3', NOW + 2)?.candidateId).toBe('c');
  });

  it('evicts the least-recently-used session, not the first inserted', () => {
    const bounded = new AutoStateStore({ maxSessions: 2, sessionTtlMs: 10_000_000 });
    bounded.recordIncumbent('s1', { candidateId: 'a', provider: 'p', model: 'm', now: NOW });
    bounded.recordIncumbent('s2', { candidateId: 'b', provider: 'p', model: 'm', now: NOW });
    // Touch s1 so s2 becomes the least-recently-used.
    expect(bounded.getIncumbent('s1', NOW + 1)?.candidateId).toBe('a');
    bounded.recordIncumbent('s3', { candidateId: 'c', provider: 'p', model: 'm', now: NOW + 2 });
    expect(bounded.size()).toBe(2);
    expect(bounded.getIncumbent('s1', NOW + 3)?.candidateId).toBe('a');
    expect(bounded.getIncumbent('s2', NOW + 3)).toBeNull();
    expect(bounded.getIncumbent('s3', NOW + 3)?.candidateId).toBe('c');
  });

  it('evicts sessions past their TTL', () => {
    const ttlStore = new AutoStateStore({ sessionTtlMs: 1000, maxSessions: 10 });
    ttlStore.recordIncumbent('s1', { candidateId: 'a', provider: 'p', model: 'm', now: NOW });
    ttlStore.getIncumbent('s1', NOW + 500);
    ttlStore.recordIncumbent('s2', {
      candidateId: 'b',
      provider: 'p',
      model: 'm',
      now: NOW + 3000,
    });
    expect(ttlStore.size()).toBe(1);
  });

  it('enforces TTL on reads of an expired session', () => {
    const ttlStore = new AutoStateStore({ sessionTtlMs: 1000, maxSessions: 10 });
    ttlStore.recordIncumbent('s1', { candidateId: 'a', provider: 'p', model: 'm', now: NOW });
    ttlStore.setContinuation('s1', true, undefined, NOW);
    expect(ttlStore.getIncumbent('s1', NOW + 500)?.candidateId).toBe('a');
    expect(ttlStore.getContinuation('s1', NOW + 500)?.locked).toBe(true);

    expect(ttlStore.getIncumbent('s1', NOW + 2000)).toBeNull();
    expect(ttlStore.getContinuation('s1', NOW + 2000)).toBeNull();
    expect(ttlStore.size()).toBe(0);
  });

  it('deduplicates concurrent work with single-flight', async () => {
    let calls = 0;
    const first = store.singleFlight('scope', 'classify', async () => {
      calls += 1;
      return 'result';
    });
    const second = store.singleFlight('scope', 'classify', async () => {
      calls += 1;
      return 'other';
    });
    await expect(first).resolves.toBe('result');
    await expect(second).resolves.toBe('result');
    expect(calls).toBe(1);
  });

  it('scopes single-flight keys so tenants do not share work', async () => {
    let calls = 0;
    const fn = async () => {
      calls += 1;
      return calls;
    };
    await store.singleFlight('scope-a', 'classify', fn);
    await store.singleFlight('scope-b', 'classify', fn);
    expect(calls).toBe(2);
  });

  it('detaches only the aborting waiter from shared single-flight work', async () => {
    let resolveWork!: (value: string) => void;
    const work = () =>
      new Promise<string>((resolve) => {
        resolveWork = resolve;
      });
    const controller = new AbortController();
    const aborting = store.singleFlight('scope', 'classify', work, controller.signal);
    const waiting = store.singleFlight('scope', 'classify', work);
    controller.abort();
    await expect(aborting).rejects.toMatchObject({ name: 'AbortError' });
    resolveWork('done');
    await expect(waiting).resolves.toBe('done');
  });

  it('snapshots state and resets for testing', () => {
    store.recordIncumbent(scope, {
      candidateId: 'm1',
      provider: 'p',
      model: 'm',
      previousDemand: 2,
      previousRequiredTier: 'high',
      now: NOW,
    });
    store.recordObservation(scope, 'm1', {
      cachedInputTokens: 50,
      cacheWriteTokens: 0,
      prefixFingerprint: 'p',
      now: NOW,
    });
    store.recordJudgment(scope, {
      key: 'fp',
      judgment,
      rubricVersion: 1,
      classifierId: 'judge',
      now: NOW,
    });

    const snapshot = store.snapshot(scope, NOW);
    expect(snapshot?.incumbent?.candidateId).toBe('m1');
    expect(snapshot?.incumbent?.previousRequiredTier).toBe('high');
    expect(snapshot?.judgment?.key).toBe('fp');
    expect(snapshot?.observations.m1?.cachedInputTokens).toBe(50);

    store.reset(scope);
    expect(store.getIncumbent(scope)).toBeNull();

    store.resetForTesting();
    expect(store.size()).toBe(0);
  });
});
