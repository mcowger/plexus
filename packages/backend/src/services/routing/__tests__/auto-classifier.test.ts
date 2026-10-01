import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AutoRoutingConfigSchema, type AutoRoutingConfig } from '@plexus/shared';
import type { ModelConfig } from '../../../config';
import type {
  UnifiedChatRequest,
  UnifiedDecisionsRequest,
  UnifiedDecisionsResponse,
} from '../../../types/unified';
import type { UsageRecord } from '../../../types/usage';
import type { QuotaCheckSnapshot, QuotaContext } from '../../quota/quota-enforcer';
import { DebugManager } from '../../observability/debug-manager';
import { registerSpy } from '../../../../test/test-utils';
import {
  assertClassifierAliasUsable,
  buildClassifierQuestions,
  classifyAutoRequest,
  configureAutoClassifier,
  drainAutoClassifierAccountingForTesting,
  getAutoJudgmentHandle,
  isContinuation,
  lookupAutoJudgmentForHandle,
  parseJudgmentAnswers,
  resetAutoClassifierForTesting,
  type AutoClassifierDispatcher,
  type AutoClassifierQuotaRecorder,
  type AutoClassifierUsageRecorder,
} from '../auto-classifier';

// ── Fixtures ────────────────────────────────────────────────────────

type ModelGraph = Record<string, ModelConfig>;

function makeModels(overrides: ModelGraph = {}): ModelGraph {
  return {
    judge: {
      type: 'decisions',
      target_groups: [
        {
          name: 'main',
          selector: 'in_order',
          targets: [{ provider: 'judge-provider', model: 'judge-model' }],
        },
      ],
    },
    'auto-alias': {
      type: 'text',
      target_groups: [{ name: 'auto', selector: 'auto', targets: [{ provider: 'p', model: 'm' }] }],
    },
    ...overrides,
  } as unknown as ModelGraph;
}

function makeConfig(overrides: Record<string, unknown> = {}): AutoRoutingConfig {
  return AutoRoutingConfigSchema.parse({
    mode: 'active',
    classifier_alias: 'judge',
    classifier_deadline_ms: 200,
    ...overrides,
  });
}

function makeRequest(overrides: Partial<UnifiedChatRequest> = {}): UnifiedChatRequest {
  return {
    model: 'auto-alias',
    messages: [{ role: 'user', content: 'Implement a complex multi-step feature' }],
    metadata: { plexus_metadata: { plexus_key_id: 'key-1' } },
    ...overrides,
  };
}

function makeAnswers(overrides: Record<string, unknown> = {}): UnifiedDecisionsResponse['answers'] {
  return {
    task_kind: { type: 'choice', choice: 'implement' },
    complexity: { type: 'score', score: 2 },
    capability_required: { type: 'score', score: 2 },
    deep_reasoning: { type: 'noul', noul: 0.9 },
    ...overrides,
  } as UnifiedDecisionsResponse['answers'];
}

function makeResponse(overrides: Partial<UnifiedDecisionsResponse> = {}): UnifiedDecisionsResponse {
  return {
    model: 'judge-model',
    answers: makeAnswers(),
    usage: { input_tokens: 12, output_tokens: 4, cost: 0.002 },
    plexus: {
      provider: 'judge-provider',
      model: 'judge-model',
      pricing: { source: 'simple', input: 3, output: 6 },
    },
    ...overrides,
  };
}

function makeQuotaSnapshot(overrides: Partial<QuotaCheckSnapshot> = {}): QuotaCheckSnapshot {
  return {
    quotaName: 'daily',
    limitType: 'requests',
    limit: 100,
    currentUsage: 100,
    remaining: 0,
    allowed: false,
    resetsAtMs: Date.now() + 60_000,
    scope: {},
    global: true,
    shared: false,
    source: 'assigned',
    ...overrides,
  };
}

function makeQuotaContext(overrides: Partial<QuotaContext> = {}): QuotaContext {
  return { keyName: 'key-1', checks: [], blockedGlobal: null, ...overrides };
}

interface DispatcherDouble extends AutoClassifierDispatcher {
  calls: number;
}

function makeDispatcher(
  impl: (
    request: UnifiedDecisionsRequest,
    signal?: AbortSignal
  ) => Promise<UnifiedDecisionsResponse> = async () => makeResponse()
): DispatcherDouble {
  const double: DispatcherDouble = {
    calls: 0,
    async dispatchDecisions(request, signal) {
      double.calls += 1;
      return impl(request, signal);
    },
  };
  return double;
}

function installDeps(
  options: {
    dispatcher?: DispatcherDouble;
    models?: ModelGraph;
    usage?: AutoClassifierUsageRecorder;
    quota?: AutoClassifierQuotaRecorder;
    now?: () => number;
  } = {}
) {
  const dispatcher = options.dispatcher ?? makeDispatcher();
  configureAutoClassifier({
    getModels: () => options.models ?? makeModels(),
    createDispatcher: async () => dispatcher,
    getUsageRecorder: () => options.usage,
    getQuotaRecorder: () => options.quota,
    now: options.now ?? (() => Date.now()),
  });
  return { dispatcher };
}

beforeEach(() => {
  resetAutoClassifierForTesting();
  registerSpy(DebugManager.prototype, 'startLog').mockImplementation(() => undefined);
  registerSpy(DebugManager.prototype, 'flush').mockImplementation(() => undefined);
});

// ── Guards and early exits ──────────────────────────────────────────

describe('classifyAutoRequest early exits', () => {
  it('returns unavailable when auto mode is off', async () => {
    const { dispatcher } = installDeps();
    const result = await classifyAutoRequest(makeRequest(), makeConfig({ mode: 'off' }));
    expect(result).toMatchObject({ source: 'unavailable', reason: 'auto_off' });
    expect(dispatcher.calls).toBe(0);
  });

  it('returns unavailable when the classifier alias is missing', async () => {
    const { dispatcher } = installDeps();
    const result = await classifyAutoRequest(makeRequest(), makeConfig({ classifier_alias: '' }));
    expect(result).toMatchObject({ source: 'unavailable', reason: 'classifier_unavailable' });
    expect(dispatcher.calls).toBe(0);
  });

  it('rejects a classifier alias that is not a Decisions alias', async () => {
    const models = makeModels({
      judge: { type: 'text', target_groups: [] } as unknown as ModelConfig,
    });
    const { dispatcher } = installDeps({ models });
    const result = await classifyAutoRequest(makeRequest(), makeConfig());
    expect(result).toMatchObject({ source: 'unavailable', reason: 'classifier_unavailable' });
    expect(dispatcher.calls).toBe(0);
  });

  it('rejects a classifier alias that reaches an auto group', () => {
    const models = makeModels({
      judge: {
        type: 'decisions',
        target_groups: [{ name: 'a', selector: 'auto', targets: [{ provider: 'p', model: 'm' }] }],
      } as unknown as ModelConfig,
    });
    expect(() => assertClassifierAliasUsable('judge', models)).toThrow(/must not use auto routing/);
  });

  it('rejects a classifier alias reachable through an alias reference', () => {
    const models = makeModels({
      'judge-wrapper': {
        type: 'decisions',
        target_groups: [{ name: 'main', selector: 'in_order', targets: [{ alias: 'auto-alias' }] }],
      } as unknown as ModelConfig,
    });
    expect(() => assertClassifierAliasUsable('judge-wrapper', models)).toThrow(
      /must not use auto routing/
    );
  });

  it('returns unavailable when no API key scope is available', async () => {
    const { dispatcher } = installDeps();
    const request = makeRequest({ metadata: {} });
    const result = await classifyAutoRequest(request, makeConfig());
    expect(result).toMatchObject({ source: 'unavailable', reason: 'unauthenticated' });
    expect(dispatcher.calls).toBe(0);
  });
});

// ── Fresh classification ────────────────────────────────────────────

describe('classifyAutoRequest fresh classification', () => {
  it('dispatches the classifier alias and returns a validated judgment', async () => {
    const { dispatcher } = installDeps();
    const result = await classifyAutoRequest(makeRequest(), makeConfig());

    expect(dispatcher.calls).toBe(1);
    expect(result).toMatchObject({
      source: 'fresh',
      reason: 'classified',
      cost: 0.002,
      judgment: {
        task_kind: 'implement',
        complexity: 2,
        capability_required: 2,
        deep_reasoning: 0.9,
      },
    });
    expect(result.handle).toMatch(/^[0-9a-f]{32}$/);
  });

  it('sends a child request with a distinct id, internal purpose, and no parent key policy', async () => {
    let captured: UnifiedDecisionsRequest | undefined;
    const dispatcher = makeDispatcher(async (request) => {
      captured = request;
      return makeResponse();
    });
    installDeps({ dispatcher });

    const request = makeRequest({
      requestId: 'parent-1',
      metadata: {
        plexus_metadata: {
          plexus_key_id: 'key-1',
          plexus_key_policy: { allowedModels: ['only-this'] },
        } as any,
      },
    });
    await classifyAutoRequest(request, makeConfig());

    expect(captured?.model).toBe('judge');
    expect(captured?.requestId).toBeDefined();
    expect(captured?.requestId).not.toBe('parent-1');
    expect(captured?.requestId).toContain('parent-1');
    const meta = captured?.metadata?.plexus_metadata as Record<string, unknown>;
    expect(meta.plexus_internal_purpose).toBe('auto_classifier');
    expect(meta.parent_request_id).toBe('parent-1');
    expect(meta).not.toHaveProperty('plexus_key_policy');
    expect(captured?.questions.task_kind?.type).toBe('choice');
    expect(captured?.questions.complexity?.type).toBe('score');
    expect(captured?.questions.deep_reasoning?.type).toBe('noul');
  });

  it('links a distinct child trace to the parent request', async () => {
    const startLog = registerSpy(DebugManager.prototype, 'startLog').mockImplementation(
      () => undefined
    );
    installDeps();
    await classifyAutoRequest(makeRequest({ requestId: 'parent-trace' }), makeConfig());
    expect(startLog).toHaveBeenCalledTimes(1);
    const [childId, raw] = startLog.mock.calls[0];
    expect(childId).toContain('parent-trace');
    expect((raw as any).plexus_auto_classifier.parent_request_id).toBe('parent-trace');
  });
});

// ── Strict validation ───────────────────────────────────────────────

describe('judgment validation', () => {
  it('accepts fractional scores and normalizes min confidence', () => {
    const parsed = parseJudgmentAnswers(
      makeResponse({
        answers: makeAnswers({
          task_kind: { type: 'choice', choice: 'plan', confidence: 0.7 },
          complexity: { type: 'score', score: 1.5, confidence: 0.5 },
        }),
      })
    );
    expect(parsed).toMatchObject({
      judgment: { task_kind: 'plan', complexity: 1.5, capability_required: 2, confidence: 0.5 },
    });
  });

  it('leaves confidence neutral when absent', () => {
    const parsed = parseJudgmentAnswers(makeResponse());
    expect('judgment' in parsed).toBe(true);
    if ('judgment' in parsed) {
      expect(parsed.judgment).not.toHaveProperty('confidence');
    }
  });

  it.each([
    ['task_kind missing', { task_kind: undefined }, 'task_kind_missing'],
    [
      'task_kind unknown label',
      { task_kind: { type: 'choice', choice: 'sing' } },
      'task_kind_invalid',
    ],
    ['complexity out of range', { complexity: { type: 'score', score: 4 } }, 'complexity_invalid'],
    [
      'capability_required wrong type',
      { capability_required: { type: 'noul', noul: 1 } },
      'capability_required_invalid',
    ],
    [
      'deep_reasoning out of range',
      { deep_reasoning: { type: 'noul', noul: 1.5 } },
      'deep_reasoning_invalid',
    ],
    [
      'confidence out of range',
      { complexity: { type: 'score', score: 2, confidence: 1.2 } },
      'confidence_invalid',
    ],
  ])('rejects malformed answers: %s', (_label, override, reason) => {
    const parsed = parseJudgmentAnswers(makeResponse({ answers: makeAnswers(override as any) }));
    expect(parsed).toEqual({ error: reason });
  });

  it('returns invalid_judgment when the provider sends unusable answers', async () => {
    const dispatcher = makeDispatcher(async () =>
      makeResponse({ answers: makeAnswers({ complexity: { type: 'score', score: 99 } }) })
    );
    installDeps({ dispatcher });
    const result = await classifyAutoRequest(makeRequest(), makeConfig());
    expect(result).toMatchObject({ source: 'unavailable', reason: 'complexity_invalid' });
  });

  it('accounts child usage even when the answers are invalid', async () => {
    const dispatcher = makeDispatcher(async () =>
      makeResponse({ answers: makeAnswers({ complexity: { type: 'score', score: 9 } }) })
    );
    const usage: AutoClassifierUsageRecorder = { saveRequest: vi.fn(async () => undefined) };
    installDeps({ dispatcher, usage });

    const result = await classifyAutoRequest(makeRequest(), makeConfig());
    expect(result).toMatchObject({ source: 'unavailable', reason: 'complexity_invalid' });
    expect(usage.saveRequest).toHaveBeenCalledTimes(1);
  });

  it('rejects unsupported rubric versions', () => {
    expect(() => buildClassifierQuestions(2)).toThrow(/Unsupported auto routing rubric/);
  });
});

// ── Caching / single-flight / continuation ──────────────────────────

describe('judgment caching', () => {
  it('reuses the exact cache without dispatching again', async () => {
    const { dispatcher } = installDeps();
    const first = await classifyAutoRequest(makeRequest(), makeConfig());
    const second = await classifyAutoRequest(makeRequest(), makeConfig());

    expect(dispatcher.calls).toBe(1);
    expect(first.source).toBe('fresh');
    expect(second).toMatchObject({ source: 'exact_cache', judgment: first.judgment });
  });

  it('scopes the exact cache to the authenticated API key', async () => {
    const { dispatcher } = installDeps();
    await classifyAutoRequest(makeRequest(), makeConfig());
    await classifyAutoRequest(
      makeRequest({ metadata: { plexus_metadata: { plexus_key_id: 'key-2' } } }),
      makeConfig()
    );
    expect(dispatcher.calls).toBe(2);
  });

  it('invalidates the cache when the classifier or rubric identity changes', async () => {
    const { dispatcher } = installDeps();
    await classifyAutoRequest(makeRequest(), makeConfig());
    await classifyAutoRequest(
      makeRequest(),
      makeConfig({ classifier_alias: 'judge', rubric_version: 1 })
    );
    // same identity → cache hit
    expect(dispatcher.calls).toBe(1);
  });

  it('invalidates the cache when the classifier target binding changes', async () => {
    const { dispatcher } = installDeps();
    const first = await classifyAutoRequest(makeRequest(), makeConfig());
    expect(first.source).toBe('fresh');

    installDeps({
      dispatcher,
      models: makeModels({
        judge: {
          type: 'decisions',
          target_groups: [
            {
              name: 'main',
              selector: 'in_order',
              targets: [{ provider: 'judge-provider-2', model: 'judge-model-2' }],
            },
          ],
        } as unknown as ModelConfig,
      }),
    });

    const second = await classifyAutoRequest(makeRequest(), makeConfig());
    expect(second.source).toBe('fresh');
    expect(dispatcher.calls).toBe(2);
  });

  it('deduplicates identical concurrent requests with single-flight', async () => {
    let resolveDispatch: ((value: UnifiedDecisionsResponse) => void) | undefined;
    const dispatcher = makeDispatcher(
      () =>
        new Promise<UnifiedDecisionsResponse>((resolve) => {
          resolveDispatch = resolve;
        })
    );
    installDeps({ dispatcher });

    const requests = [
      classifyAutoRequest(makeRequest(), makeConfig()),
      classifyAutoRequest(makeRequest(), makeConfig()),
    ];
    await vi.waitFor(() => expect(dispatcher.calls).toBe(1));

    resolveDispatch?.(makeResponse());
    const [a, b] = await Promise.all(requests);
    expect(a!.source).toBe('fresh');
    expect(b!.source).toBe('fresh');
    expect(a!.judgment).toEqual(b!.judgment);
  });

  it('reuses a retained judgment for a session continuation', async () => {
    const { dispatcher } = installDeps();
    const base = { claudeCodeSessionId: 'session-1' } as const;

    const first = await classifyAutoRequest(
      makeRequest({
        ...base,
        messages: [{ role: 'user', content: 'Implement the parser change' }],
      }),
      makeConfig()
    );
    const continuation = await classifyAutoRequest(
      makeRequest({
        ...base,
        messages: [
          { role: 'user', content: 'Implement the parser change' },
          { role: 'assistant', content: 'Done, parser updated.' },
          { role: 'user', content: 'thanks' },
        ],
      }),
      makeConfig()
    );

    expect(dispatcher.calls).toBe(1);
    expect(continuation).toMatchObject({ source: 'continuation', judgment: first.judgment });
  });

  it('classifies a short first request instead of treating it as a continuation', async () => {
    const { dispatcher } = installDeps();
    const result = await classifyAutoRequest(
      makeRequest({ messages: [{ role: 'user', content: 'hi' }] }),
      makeConfig()
    );
    expect(result.source).toBe('fresh');
    expect(dispatcher.calls).toBe(1);
  });

  it('treats tool-result turns as continuations', () => {
    expect(
      isContinuation(
        makeRequest({
          messages: [
            { role: 'user', content: 'Do the work' },
            {
              role: 'assistant',
              content: null,
              tool_calls: [
                { id: '1', type: 'function', function: { name: 'run', arguments: '{}' } },
              ],
            },
            { role: 'tool', content: 'result: ok', tool_call_id: '1' },
          ],
        })
      )
    ).toBe(true);
  });
});

// ── Deadline / cancellation / breaker ───────────────────────────────

describe('deadline and cancellation', () => {
  it('returns parent_cancelled immediately when the signal is already aborted', async () => {
    const { dispatcher } = installDeps();
    const controller = new AbortController();
    controller.abort();
    const result = await classifyAutoRequest(makeRequest(), makeConfig(), controller.signal);
    expect(result).toMatchObject({ source: 'unavailable', reason: 'parent_cancelled' });
    expect(dispatcher.calls).toBe(0);
  });

  it('settles on parent cancellation even if the provider ignores the abort', async () => {
    const dispatcher = makeDispatcher(() => new Promise<UnifiedDecisionsResponse>(() => {}));
    installDeps({ dispatcher });
    const controller = new AbortController();
    const pending = classifyAutoRequest(makeRequest(), makeConfig(), controller.signal);
    controller.abort();
    const result = await pending;
    expect(result).toMatchObject({ source: 'unavailable', reason: 'parent_cancelled' });
  });

  it('returns classifier_timeout when the provider exceeds the deadline', async () => {
    const dispatcher = makeDispatcher(() => new Promise<UnifiedDecisionsResponse>(() => {}));
    installDeps({ dispatcher });
    const result = await classifyAutoRequest(
      makeRequest(),
      makeConfig({ classifier_deadline_ms: 30 })
    );
    expect(result).toMatchObject({ source: 'unavailable', reason: 'classifier_timeout' });
  });

  it('does not let one waiter cancellation fail a concurrent waiter', async () => {
    let resolveDispatch: ((value: UnifiedDecisionsResponse) => void) | undefined;
    const dispatcher = makeDispatcher(
      () =>
        new Promise<UnifiedDecisionsResponse>((resolve) => {
          resolveDispatch = resolve;
        })
    );
    installDeps({ dispatcher });

    const firstController = new AbortController();
    const first = classifyAutoRequest(makeRequest(), makeConfig(), firstController.signal);
    const second = classifyAutoRequest(makeRequest(), makeConfig());
    await vi.waitFor(() => expect(dispatcher.calls).toBe(1));

    firstController.abort();
    await expect(first).resolves.toMatchObject({
      source: 'unavailable',
      reason: 'parent_cancelled',
    });

    resolveDispatch?.(makeResponse());
    await expect(second).resolves.toMatchObject({ source: 'fresh' });
  });

  it('keeps the first waiter alive when a later waiter cancels', async () => {
    let resolveDispatch: ((value: UnifiedDecisionsResponse) => void) | undefined;
    const dispatcher = makeDispatcher(
      () =>
        new Promise<UnifiedDecisionsResponse>((resolve) => {
          resolveDispatch = resolve;
        })
    );
    installDeps({ dispatcher });

    const first = classifyAutoRequest(makeRequest(), makeConfig());
    const secondController = new AbortController();
    const second = classifyAutoRequest(makeRequest(), makeConfig(), secondController.signal);
    await vi.waitFor(() => expect(dispatcher.calls).toBe(1));

    secondController.abort();
    await expect(second).resolves.toMatchObject({
      source: 'unavailable',
      reason: 'parent_cancelled',
    });

    resolveDispatch?.(makeResponse());
    await expect(first).resolves.toMatchObject({ source: 'fresh' });
  });

  it('returns classifier_overloaded immediately instead of queueing unbounded', async () => {
    const pending: Array<() => void> = [];
    const dispatcher = makeDispatcher(
      () =>
        new Promise<UnifiedDecisionsResponse>((resolve) => {
          pending.push(() => resolve(makeResponse()));
        })
    );
    installDeps({ dispatcher });

    const inFlight = Array.from({ length: 4 }, (_, i) =>
      classifyAutoRequest(
        makeRequest({ messages: [{ role: 'user', content: `unique request ${i}` }] }),
        makeConfig()
      )
    );
    await vi.waitFor(() => expect(dispatcher.calls).toBe(4));

    const overflow = await classifyAutoRequest(
      makeRequest({ messages: [{ role: 'user', content: 'overflow request' }] }),
      makeConfig()
    );
    expect(overflow).toMatchObject({ source: 'unavailable', reason: 'classifier_overloaded' });

    pending.forEach((resolve) => resolve());
    await Promise.all(inFlight);
  });

  it('accounts late usage when the provider ignores the abort', async () => {
    let resolveDispatch: ((value: UnifiedDecisionsResponse) => void) | undefined;
    const dispatcher = makeDispatcher(
      () =>
        new Promise<UnifiedDecisionsResponse>((resolve) => {
          resolveDispatch = resolve;
        })
    );
    const usage: AutoClassifierUsageRecorder = { saveRequest: vi.fn(async () => undefined) };
    installDeps({ dispatcher, usage });

    const controller = new AbortController();
    const pending = classifyAutoRequest(
      makeRequest({ requestId: 'parent-abandon' }),
      makeConfig({ classifier_deadline_ms: 5000 }),
      controller.signal
    );
    await vi.waitFor(() => expect(dispatcher.calls).toBe(1));
    controller.abort();
    const result = await pending;
    expect(result).toMatchObject({ source: 'unavailable', reason: 'parent_cancelled' });

    resolveDispatch?.(makeResponse());
    await vi.waitFor(() => expect(usage.saveRequest).toHaveBeenCalledTimes(1));
  });

  it('opens the circuit after repeated failures and stops dispatching', async () => {
    const dispatcher = makeDispatcher(async () => {
      throw new Error('classifier down');
    });
    installDeps({ dispatcher });

    for (let i = 0; i < 3; i++) {
      const result = await classifyAutoRequest(
        makeRequest({ messages: [{ role: 'user', content: `request number ${i}` }] }),
        makeConfig()
      );
      expect(result).toMatchObject({ source: 'unavailable', reason: 'classifier_error' });
    }
    const blocked = await classifyAutoRequest(
      makeRequest({ messages: [{ role: 'user', content: 'request number blocked' }] }),
      makeConfig()
    );
    expect(blocked).toMatchObject({ source: 'unavailable', reason: 'classifier_circuit_open' });
    expect(dispatcher.calls).toBe(3);
  });

  it('keys the circuit breaker per classifier alias so one bad alias does not block another', async () => {
    const dispatcher = makeDispatcher(async (request) => {
      if (request.model === 'judge') throw new Error('judge down');
      return makeResponse();
    });
    installDeps({
      dispatcher,
      models: makeModels({
        'judge-2': {
          type: 'decisions',
          target_groups: [
            { name: 'main', selector: 'in_order', targets: [{ provider: 'p2', model: 'm2' }] },
          ],
        } as unknown as ModelConfig,
      }),
    });

    for (let i = 0; i < 3; i++) {
      const result = await classifyAutoRequest(
        makeRequest({ messages: [{ role: 'user', content: `failing request ${i}` }] }),
        makeConfig()
      );
      expect(result).toMatchObject({ source: 'unavailable', reason: 'classifier_error' });
    }
    const blocked = await classifyAutoRequest(
      makeRequest({ messages: [{ role: 'user', content: 'blocked request' }] }),
      makeConfig()
    );
    expect(blocked).toMatchObject({ source: 'unavailable', reason: 'classifier_circuit_open' });

    const other = await classifyAutoRequest(
      makeRequest({ messages: [{ role: 'user', content: 'other alias request' }] }),
      makeConfig({ classifier_alias: 'judge-2' })
    );
    expect(other.source).toBe('fresh');
  });
});

// ── Quota + accounting ──────────────────────────────────────────────

describe('quota and usage accounting', () => {
  it('blocks classification when the key has a globally exhausted quota', async () => {
    const { dispatcher } = installDeps({
      quota: {
        loadQuotaContext: vi.fn(async () =>
          makeQuotaContext({ blockedGlobal: makeQuotaSnapshot() })
        ),
        recordUsage: vi.fn(async () => undefined),
      },
    });
    const result = await classifyAutoRequest(makeRequest(), makeConfig());
    expect(result).toMatchObject({ source: 'unavailable', reason: 'key_quota_blocked' });
    expect(dispatcher.calls).toBe(0);
  });

  it('attaches the loaded scoped quota context to the child request', async () => {
    let captured: UnifiedDecisionsRequest | undefined;
    const dispatcher = makeDispatcher(async (request) => {
      captured = request;
      return makeResponse();
    });
    const scopedSnapshot = makeQuotaSnapshot({
      quotaName: 'provider-daily',
      global: false,
      scope: { allowedProviders: ['judge-provider'] },
    });
    installDeps({
      dispatcher,
      quota: {
        loadQuotaContext: vi.fn(async () => makeQuotaContext({ checks: [scopedSnapshot] })),
        recordUsage: vi.fn(async () => undefined),
      },
    });

    const result = await classifyAutoRequest(makeRequest(), makeConfig());
    expect(result.source).toBe('fresh');
    const attached = (captured?.metadata?.plexus_metadata as any)?.plexus_quota_context;
    expect(attached).toEqual(makeQuotaContext({ checks: [scopedSnapshot] }));
  });

  it('bounds a hanging quota pre-check by the routing deadline', async () => {
    const dispatcher = makeDispatcher(() => new Promise<UnifiedDecisionsResponse>(() => {}));
    installDeps({
      dispatcher,
      quota: {
        loadQuotaContext: vi.fn(() => new Promise<QuotaContext | null>(() => {})),
        recordUsage: vi.fn(async () => undefined),
      },
    });

    const result = await classifyAutoRequest(
      makeRequest(),
      makeConfig({ classifier_deadline_ms: 25 })
    );
    // The deadline covers the pre-check, so the dispatch is admitted and
    // immediately timed out rather than hanging on the unbounded ledger read.
    expect(result).toMatchObject({ source: 'unavailable', reason: 'classifier_timeout' });
  });

  it('records child usage/cost and quota against the caller key', async () => {
    const usage: AutoClassifierUsageRecorder = { saveRequest: vi.fn(async () => undefined) };
    const quota: AutoClassifierQuotaRecorder = {
      loadQuotaContext: vi.fn(async () => null),
      recordUsage: vi.fn(async () => undefined),
    };
    installDeps({ usage, quota });

    const result = await classifyAutoRequest(makeRequest({ requestId: 'parent-9' }), makeConfig());
    expect(result.source).toBe('fresh');

    expect(usage.saveRequest).toHaveBeenCalledTimes(1);
    const record = (usage.saveRequest as any).mock.calls[0][0] as Partial<UsageRecord>;
    expect(record.apiKey).toBe('key-1');
    expect(record.incomingApiType).toBe('decisions');
    expect(record.requestId).toContain('parent-9');
    expect(record.provider).toBe('judge-provider');
    expect(record.tokensInput).toBe(12);
    expect(record.costTotal).toBeCloseTo((12 / 1_000_000) * 3 + (4 / 1_000_000) * 6, 10);

    expect(quota.recordUsage).toHaveBeenCalledWith(
      'key-1',
      'judge-provider',
      'judge-model',
      expect.objectContaining({ tokensInput: 12, tokensOutput: 4 })
    );
  });

  it('still classifies when accounting fails', async () => {
    const usage: AutoClassifierUsageRecorder = {
      saveRequest: vi.fn(async () => {
        throw new Error('ledger unavailable');
      }),
    };
    installDeps({ usage });
    const result = await classifyAutoRequest(makeRequest(), makeConfig());
    expect(result.source).toBe('fresh');
  });

  it('reports the calculated cost when the provider omits one', async () => {
    const dispatcher = makeDispatcher(async () =>
      makeResponse({ usage: { input_tokens: 1000, output_tokens: 0 } })
    );
    installDeps({ dispatcher });

    const result = await classifyAutoRequest(makeRequest(), makeConfig());
    expect(result.source).toBe('fresh');
    expect(result.cost).toBeCloseTo((1000 / 1_000_000) * 3, 10);
  });

  it('does not let a hanging ledger push the routing deadline out', async () => {
    let releaseLedger: (() => void) | undefined;
    const usage: AutoClassifierUsageRecorder = {
      saveRequest: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            releaseLedger = resolve;
          })
      ),
    };
    installDeps({ usage });

    const result = await classifyAutoRequest(
      makeRequest(),
      makeConfig({ classifier_deadline_ms: 30 })
    );
    expect(result.source).toBe('fresh');
    // Recording continues in the background and is tracked.
    releaseLedger?.();
    await drainAutoClassifierAccountingForTesting();
  });
});

// ── Preview scoping + accounting ────────────────────────────────────

describe('preview purpose scoping', () => {
  it('does not collide a preview scope with a real API key named admin', async () => {
    const { dispatcher } = installDeps();
    const messages = [{ role: 'user' as const, content: 'Implement the parser change' }];
    const inference = makeRequest({
      messages,
      metadata: { plexus_metadata: { plexus_key_id: 'admin' } },
    });
    const preview = makeRequest({
      messages,
      metadata: { plexus_metadata: { plexus_key_id: 'admin', plexus_auto_purpose: 'preview' } },
    });

    const first = await classifyAutoRequest(inference, makeConfig());
    const second = await classifyAutoRequest(preview, makeConfig());

    expect(first.source).toBe('fresh');
    expect(second.source).toBe('fresh');
    expect(dispatcher.calls).toBe(2);
    expect(first.handle).toBeDefined();
    expect(second.handle).toBeDefined();
    expect(second.handle).not.toBe(first.handle);
  });

  it('does not debit key quota for a preview and attributes usage to the admin', async () => {
    const usage: AutoClassifierUsageRecorder = { saveRequest: vi.fn(async () => undefined) };
    const quota: AutoClassifierQuotaRecorder = {
      loadQuotaContext: vi.fn(async () => makeQuotaContext({ blockedGlobal: makeQuotaSnapshot() })),
      recordUsage: vi.fn(async () => undefined),
    };
    installDeps({ usage, quota });

    const preview = makeRequest({
      metadata: { plexus_metadata: { plexus_key_id: 'admin', plexus_auto_purpose: 'preview' } },
    });
    const result = await classifyAutoRequest(preview, makeConfig());
    expect(result.source).toBe('fresh');

    // Preview never consults the key's quota, so an exhausted key cannot block it.
    expect(quota.loadQuotaContext).not.toHaveBeenCalled();
    expect(quota.recordUsage).not.toHaveBeenCalled();

    const record = (usage.saveRequest as any).mock.calls[0][0] as Partial<UsageRecord>;
    expect(record.apiKey).toBeNull();
    expect(record.attribution).toBe('auto-preview:admin');
  });
});

// ── Preview handle reuse ────────────────────────────────────────────

describe('reusable judgment handles', () => {
  it('returns the same handle and lookup result for equal scope', async () => {
    installDeps();
    const request = makeRequest();
    const config = makeConfig();
    const result = await classifyAutoRequest(request, config);

    const handle = getAutoJudgmentHandle(request, config);
    expect(handle).toBe(result.handle);
    expect(lookupAutoJudgmentForHandle(handle!, request, config)).toEqual(result.judgment);
  });

  it('rejects a handle from a different context or API key', async () => {
    installDeps();
    const request = makeRequest();
    const config = makeConfig();
    const result = await classifyAutoRequest(request, config);

    const otherContext = makeRequest({
      messages: [{ role: 'user', content: 'Something else entirely' }],
    });
    expect(lookupAutoJudgmentForHandle(result.handle!, otherContext, config)).toBeUndefined();

    const otherKey = makeRequest({ metadata: { plexus_metadata: { plexus_key_id: 'key-2' } } });
    expect(lookupAutoJudgmentForHandle(result.handle!, otherKey, config)).toBeUndefined();
  });

  it('does not retain raw prompt text in the handle', async () => {
    installDeps();
    const secret = 'super-secret-prompt-value';
    const request = makeRequest({ messages: [{ role: 'user', content: secret }] });
    const handle = getAutoJudgmentHandle(request, makeConfig());
    expect(handle).toBeDefined();
    expect(handle).not.toContain(secret);
  });
});
