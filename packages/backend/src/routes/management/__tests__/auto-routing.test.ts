import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_AUTO_ROUTING_CONFIG } from '@plexus/shared';
import { setConfigForTesting, type PlexusConfig } from '../../../config';
import { registerAutoRoutingRoutes } from '../auto-routing';

vi.mock('../../../services/routing/auto-classifier', () => ({
  classifyAutoRequest: vi.fn(async () => ({
    judgment: {
      task_kind: 'chat',
      complexity: 1,
      capability_required: 1,
      deep_reasoning: 0.1,
      confidence: 0.9,
    },
    source: 'fresh',
    latencyMs: 3,
    cost: 0.0005,
    handle: 'route-handle',
  })),
  lookupAutoJudgmentForHandle: vi.fn(() => undefined),
}));

const DRAFT = {
  type: 'text',
  auto_routing: {
    ...DEFAULT_AUTO_ROUTING_CONFIG,
    mode: 'active',
    classifier_alias: 'judge',
  },
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
      ],
    },
  ],
};

const CONFIG = {
  providers: {
    'provider-a': {
      enabled: true,
      models: { fast: { pricing: { source: 'simple', input: 1, output: 1 } } },
    },
  },
  models: {
    magic: DRAFT,
    judge: { type: 'decisions', target_groups: [] },
  },
  keys: {},
} as unknown as PlexusConfig;

describe('POST /v0/management/models/auto-routing/preview', () => {
  let fastify: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    setConfigForTesting(CONFIG);
    fastify = Fastify();
    await registerAutoRoutingRoutes(fastify);
  });

  afterEach(async () => {
    await fastify.close();
  });

  const body = (overrides: Record<string, unknown> = {}) => ({
    alias: DRAFT,
    alias_name: 'magic',
    prompt: 'say hi',
    ...overrides,
  });

  it('rejects a missing or overlong prompt', async () => {
    const missing = await fastify.inject({
      method: 'POST',
      url: '/v0/management/models/auto-routing/preview',
      payload: { alias: DRAFT },
    });
    expect(missing.statusCode).toBe(400);

    const overlong = await fastify.inject({
      method: 'POST',
      url: '/v0/management/models/auto-routing/preview',
      payload: body({ prompt: 'x'.repeat(32_001) }),
    });
    expect(overlong.statusCode).toBe(400);
  });

  it('rejects a non-existent input_tokens or unknown cache label', async () => {
    const badTokens = await fastify.inject({
      method: 'POST',
      url: '/v0/management/models/auto-routing/preview',
      payload: body({ scenario: { input_tokens: Number.POSITIVE_INFINITY } }),
    });
    expect(badTokens.statusCode).toBe(400);

    const badCache = await fastify.inject({
      method: 'POST',
      url: '/v0/management/models/auto-routing/preview',
      payload: body({ scenario: { cache_state: 'lukewarm' } }),
    });
    expect(badCache.statusCode).toBe(400);
  });

  it('returns a ranked preview with a reusable handle', async () => {
    const response = await fastify.inject({
      method: 'POST',
      url: '/v0/management/models/auto-routing/preview',
      payload: body({ scenario: { input_tokens: 500, cache_state: 'cold' } }),
    });

    expect(response.statusCode).toBe(200);
    const json = response.json();
    expect(json.judgment_handle).toBe('route-handle');
    expect(json.analysis).toMatchObject({ source: 'fresh', latencyMs: 3, cost: 0.0005 });
    expect(json.groups[0].name).toBe('Main');
    expect(json.groups[0].targets[0].id).toBe('provider-a/fast');
    expect(json.groups[0].targets[0].leaves).toHaveLength(1);
    expect(Array.isArray(json.assumptions)).toBe(true);
  });

  it('rejects an invalid configured auto graph with 400, not 500', async () => {
    const invalidDraft = {
      ...DRAFT,
      auto_routing: { ...DRAFT.auto_routing, classifier_alias: 'missing-judge' },
    };
    const response = await fastify.inject({
      method: 'POST',
      url: '/v0/management/models/auto-routing/preview',
      payload: body({ alias: invalidDraft }),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('invalid_auto_graph');
  });

  it('rejects an invalid judgment handle without reclassifying', async () => {
    const response = await fastify.inject({
      method: 'POST',
      url: '/v0/management/models/auto-routing/preview',
      payload: body({ judgment_handle: 'unknown-handle' }),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('invalid_judgment_handle');
    const { classifyAutoRequest } = await import('../../../services/routing/auto-classifier');
    expect(classifyAutoRequest).not.toHaveBeenCalled();
  });
});
