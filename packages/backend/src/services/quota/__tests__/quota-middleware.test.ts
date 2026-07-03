import { describe, expect, test, vi } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  buildQuotaExceededBody,
  buildQuotaExceededError,
  buildQuotaHeaders,
  attachQuotaContext,
  checkQuotaMiddleware,
  recordQuotaUsage,
} from '../quota-middleware';
import type { QuotaContext, QuotaCheckSnapshot, QuotaEnforcer } from '../quota-enforcer';

function makeSnapshot(overrides: Partial<QuotaCheckSnapshot> = {}): QuotaCheckSnapshot {
  return {
    quotaName: 'daily-tokens',
    limitType: 'tokens',
    limit: 1000,
    currentUsage: 1000,
    remaining: 0,
    allowed: false,
    resetsAtMs: Date.parse('2026-07-03T00:00:00.000Z'),
    scope: {},
    global: true,
    shared: false,
    source: 'assigned',
    ...overrides,
  };
}

function makeContext(overrides: Partial<QuotaContext> = {}): QuotaContext {
  return {
    keyName: 'test-key',
    checks: [],
    blockedGlobal: null,
    ...overrides,
  };
}

function makeReply(): FastifyReply {
  return {
    send: vi.fn(function (this: any, data) {
      this.body = data;
      return this;
    }),
    code: vi.fn(function (this: any, code: number) {
      this.statusCode = code;
      return this;
    }),
  } as unknown as FastifyReply;
}

describe('buildQuotaExceededBody', () => {
  test('single blocking quota — legacy top-level fields mirror it exactly', () => {
    const quota = makeSnapshot({ quotaName: 'daily-tokens', limit: 1000, currentUsage: 1000 });
    const body: any = buildQuotaExceededBody([quota]);

    expect(body.error.type).toBe('quota_exceeded');
    expect(body.error.quota_name).toBe('daily-tokens');
    expect(body.error.current_usage).toBe(1000);
    expect(body.error.limit).toBe(1000);
    expect(body.error.resets_at).toBe(new Date(quota.resetsAtMs).toISOString());
    expect(body.error.blocking_quotas).toEqual([
      {
        quotaName: 'daily-tokens',
        limitType: 'tokens',
        limit: 1000,
        currentUsage: 1000,
        remaining: 0,
        resetsAt: new Date(quota.resetsAtMs).toISOString(),
      },
    ]);
  });

  test('multiple blocking quotas — top-level fields derive from the most-constrained (smallest remaining/limit)', () => {
    const looser = makeSnapshot({
      quotaName: 'monthly-cost',
      limitType: 'cost',
      limit: 100,
      currentUsage: 100,
      remaining: 0,
    });
    // Same 0-remaining ratio would tie; make one genuinely more constrained
    // by giving it a nonzero remaining/limit floor via a different limit.
    const tighter = makeSnapshot({
      quotaName: 'hourly-requests',
      limitType: 'requests',
      limit: 10,
      currentUsage: 10,
      remaining: 0,
    });

    const body: any = buildQuotaExceededBody([looser, tighter]);

    // Both are fully exhausted (remaining=0) — the reduce picks the first
    // when ratios tie, so the primary should be `looser` (first in array).
    expect(body.error.quota_name).toBe('monthly-cost');
    expect(body.error.blocking_quotas).toHaveLength(2);
    expect(body.error.blocking_quotas.map((q: any) => q.quotaName)).toEqual([
      'monthly-cost',
      'hourly-requests',
    ]);
  });

  test('picks the snapshot with the smallest remaining/limit ratio as primary', () => {
    const partiallyUsed = makeSnapshot({
      quotaName: 'partially-used',
      limit: 1000,
      currentUsage: 400,
      remaining: 600, // ratio 0.6
      allowed: true,
    });
    const nearlyExhausted = makeSnapshot({
      quotaName: 'nearly-exhausted',
      limit: 1000,
      currentUsage: 990,
      remaining: 10, // ratio 0.01 — most constrained
      allowed: true,
    });

    const body: any = buildQuotaExceededBody([partiallyUsed, nearlyExhausted]);
    expect(body.error.quota_name).toBe('nearly-exhausted');
  });
});

describe('buildQuotaExceededError', () => {
  test('mirrors the buildAccessDeniedError pattern: plain Error + routingContext', () => {
    const quota = makeSnapshot();
    const error = buildQuotaExceededError([quota]);

    expect(error).toBeInstanceOf(Error);
    const routingContext = (error as any).routingContext;
    expect(routingContext.statusCode).toBe(429);
    expect(routingContext.code).toBe('quota_exceeded');
    expect(routingContext.body).toEqual(buildQuotaExceededBody([quota]));
  });
});

describe('buildQuotaHeaders', () => {
  test('returns {} when ctx is null', () => {
    expect(buildQuotaHeaders(null, 'openai', 'gpt-5')).toEqual({});
  });

  test('returns {} when no check matches the (provider, model)', () => {
    const ctx = makeContext({
      checks: [
        makeSnapshot({
          quotaName: 'scoped',
          scope: { allowedProviders: ['anthropic'] },
          allowed: true,
        }),
      ],
    });
    expect(buildQuotaHeaders(ctx, 'openai', 'gpt-5')).toEqual({});
  });

  test('selects the most-constrained applicable quota and sets limit/remaining/reset headers', () => {
    const looseGlobal = makeSnapshot({
      quotaName: 'loose-global',
      limit: 1000,
      currentUsage: 100,
      remaining: 900,
      allowed: true,
      global: true,
    });
    const tightScoped = makeSnapshot({
      quotaName: 'tight-scoped',
      limit: 100,
      currentUsage: 95,
      remaining: 5,
      allowed: true,
      global: false,
      scope: { allowedProviders: ['openai'] },
    });
    const ctx = makeContext({ checks: [looseGlobal, tightScoped] });

    const headers = buildQuotaHeaders(ctx, 'openai', 'gpt-5');
    expect(headers['x-plexus-quota']).toBe('tight-scoped');
    expect(headers['x-plexus-quota-limit']).toBe('100');
    expect(headers['x-plexus-quota-remaining']).toBe('5');
    expect(headers['x-plexus-quota-reset']).toBe(new Date(tightScoped.resetsAtMs).toISOString());
    expect(headers['x-plexus-quota-warning']).toBeUndefined();
  });

  test('warnAt threshold edge: usage exactly at warnAt sets the warning header', () => {
    const quota = makeSnapshot({
      quotaName: 'warn-quota',
      limit: 100,
      currentUsage: 80,
      remaining: 20,
      allowed: true,
      warnAt: 0.8,
    });
    const ctx = makeContext({ checks: [quota] });

    const headers = buildQuotaHeaders(ctx, 'openai', 'gpt-5');
    expect(headers['x-plexus-quota-warning']).toBe('warn-quota');
  });

  test('warnAt threshold edge: usage just below warnAt does not set the warning header', () => {
    const quota = makeSnapshot({
      quotaName: 'warn-quota',
      limit: 100,
      currentUsage: 79,
      remaining: 21,
      allowed: true,
      warnAt: 0.8,
    });
    const ctx = makeContext({ checks: [quota] });

    const headers = buildQuotaHeaders(ctx, 'openai', 'gpt-5');
    expect(headers['x-plexus-quota-warning']).toBeUndefined();
  });
});

describe('attachQuotaContext', () => {
  test('returns the request unchanged when ctx is null', () => {
    const request = { metadata: { foo: 'bar' } };
    expect(attachQuotaContext(request, null)).toBe(request);
  });

  test('stores ctx at metadata.plexus_metadata.plexus_quota_context, preserving existing metadata', () => {
    const ctx = makeContext();
    const request = {
      metadata: { plexus_metadata: { plexus_key_policy: { allowedModels: ['gpt-5'] } } },
    };

    const result = attachQuotaContext(request, ctx) as any;
    expect(result.metadata.plexus_metadata.plexus_quota_context).toBe(ctx);
    expect(result.metadata.plexus_metadata.plexus_key_policy).toEqual({ allowedModels: ['gpt-5'] });
    // Original request is not mutated.
    expect((request as any).metadata.plexus_metadata.plexus_quota_context).toBeUndefined();
  });
});

describe('checkQuotaMiddleware', () => {
  test('no keyName on request — allows through with a null context', async () => {
    const request = {} as FastifyRequest;
    const reply = makeReply();
    const quotaEnforcer = { loadQuotaContext: vi.fn() } as unknown as QuotaEnforcer;

    const result = await checkQuotaMiddleware(request, reply, quotaEnforcer);
    expect(result).toEqual({ ok: true, context: null });
    expect(quotaEnforcer.loadQuotaContext).not.toHaveBeenCalled();
  });

  test('blockedGlobal set — 429s with the legacy body + blocking_quotas, and stashes the context', async () => {
    const blocked = makeSnapshot({ quotaName: 'global-daily' });
    const ctx = makeContext({ checks: [blocked], blockedGlobal: blocked });
    const request = { keyName: 'k1' } as unknown as FastifyRequest;
    const reply = makeReply();
    const quotaEnforcer = {
      loadQuotaContext: vi.fn().mockResolvedValue(ctx),
    } as unknown as QuotaEnforcer;

    const result = await checkQuotaMiddleware(request, reply, quotaEnforcer);

    expect(result.ok).toBe(false);
    expect(result.context).toBe(ctx);
    expect((request as any).quotaContext).toBe(ctx);
    expect(reply.code).toHaveBeenCalledWith(429);
    const sentBody = (reply.send as any).mock.calls[0][0];
    expect(sentBody).toEqual(buildQuotaExceededBody([blocked]));
  });

  test('scoped-only exhaustion (no blockedGlobal) — ok:true, context still attached', async () => {
    const scopedExhausted = makeSnapshot({
      quotaName: 'scoped-daily',
      global: false,
      allowed: false,
      scope: { allowedProviders: ['openai'] },
    });
    const ctx = makeContext({ checks: [scopedExhausted], blockedGlobal: null });
    const request = { keyName: 'k1' } as unknown as FastifyRequest;
    const reply = makeReply();
    const quotaEnforcer = {
      loadQuotaContext: vi.fn().mockResolvedValue(ctx),
    } as unknown as QuotaEnforcer;

    const result = await checkQuotaMiddleware(request, reply, quotaEnforcer);

    expect(result).toEqual({ ok: true, context: ctx });
    expect((request as any).quotaContext).toBe(ctx);
    expect(reply.code).not.toHaveBeenCalled();
    expect(reply.send).not.toHaveBeenCalled();
  });

  test('no quota context at all (unassigned key) — ok:true, context null', async () => {
    const request = { keyName: 'k1' } as unknown as FastifyRequest;
    const reply = makeReply();
    const quotaEnforcer = {
      loadQuotaContext: vi.fn().mockResolvedValue(null),
    } as unknown as QuotaEnforcer;

    const result = await checkQuotaMiddleware(request, reply, quotaEnforcer);
    expect(result).toEqual({ ok: true, context: null });
    expect(reply.code).not.toHaveBeenCalled();
  });
});

describe('recordQuotaUsage', () => {
  function makeEnforcer(recordUsage = vi.fn(async () => undefined)): QuotaEnforcer {
    return { recordUsage } as unknown as QuotaEnforcer;
  }

  test('no keyName — returns without touching the enforcer', async () => {
    const quotaEnforcer = makeEnforcer();
    await recordQuotaUsage(undefined, 'openai', 'gpt-5', { costTotal: 1 }, quotaEnforcer);
    expect(quotaEnforcer.recordUsage).not.toHaveBeenCalled();
  });

  test('normalizes nullable usage fields to undefined and forwards provider/model positionally', async () => {
    const quotaEnforcer = makeEnforcer();
    await recordQuotaUsage(
      'k1',
      'openai',
      'gpt-5',
      {
        tokensInput: 100,
        tokensOutput: null,
        tokensCacheWrite: null,
        tokensReasoning: 7,
        costTotal: null,
      },
      quotaEnforcer
    );

    expect(quotaEnforcer.recordUsage).toHaveBeenCalledTimes(1);
    const [keyArg, providerArg, modelArg, usageArg] = vi.mocked(quotaEnforcer.recordUsage).mock
      .calls[0]!;
    expect(keyArg).toBe('k1');
    expect(providerArg).toBe('openai');
    expect(modelArg).toBe('gpt-5');
    // toEqual treats null as a real value, so any null leaking through
    // (instead of being ??-normalized to undefined) fails here.
    expect(usageArg).toEqual({ tokensInput: 100, tokensReasoning: 7 });
  });

  test('null/undefined finalProvider and finalModel fall back to empty strings', async () => {
    const quotaEnforcer = makeEnforcer();
    await recordQuotaUsage('k1', null, undefined, {}, quotaEnforcer);

    const [, providerArg, modelArg] = vi.mocked(quotaEnforcer.recordUsage).mock.calls[0]!;
    expect(providerArg).toBe('');
    expect(modelArg).toBe('');
  });

  test('a failing enforcer is swallowed — quota accounting must not fail the request', async () => {
    const quotaEnforcer = makeEnforcer(vi.fn().mockRejectedValue(new Error('db down')));
    await expect(
      recordQuotaUsage('k1', 'openai', 'gpt-5', { costTotal: 1 }, quotaEnforcer)
    ).resolves.toBeUndefined();
  });
});
