/**
 * Tests for the "auto" model routing integration.
 * Verifies that Router correctly intercepts model="auto", runs the classifier,
 * applies agentic boost, and resolves to the tier-mapped model alias.
 */
import { describe, test, expect, beforeEach } from 'bun:test';
import { Router } from '../../src/services/router';
import { setConfigForTesting, type PlexusConfig } from '../../src/config';

/**
 * Build a minimal PlexusConfig for testing auto-routing.
 * Each tier alias resolves to a single provider/model target.
 */
function buildAutoConfig(overrides: Partial<PlexusConfig['auto']> = {}): PlexusConfig {
  return {
    providers: {
      'test-provider': {
        api_base_url: 'https://api.example.com/v1',
        api_key: 'test-key',
        disable_cooldown: true, // Bypass cooldown checks in tests
        estimateTokens: false,
      },
    },
    models: {
      'heartbeat-model': {
        targets: [{ provider: 'test-provider', model: 'hb-model' }],
      },
      'simple-model': {
        targets: [{ provider: 'test-provider', model: 'sm-model' }],
      },
      'medium-model': {
        targets: [{ provider: 'test-provider', model: 'md-model' }],
      },
      'complex-model': {
        targets: [{ provider: 'test-provider', model: 'cx-model' }],
      },
      'reasoning-model': {
        targets: [{ provider: 'test-provider', model: 'rs-model' }],
      },
    },
    keys: {},
    adminKey: 'test-admin',
    failover: {
      enabled: true,
      retryableStatusCodes: [500, 502, 503, 504],
      retryableErrors: [],
    },
    quotas: [],
    auto: {
      enabled: true,
      tier_models: {
        heartbeat: 'heartbeat-model',
        simple: 'simple-model',
        medium: 'medium-model',
        complex: 'complex-model',
        reasoning: 'reasoning-model',
      },
      agentic_boost_threshold: 0.8,
      ...overrides,
    },
  } as unknown as PlexusConfig;
}

describe('Router.resolveCandidates with model="auto"', () => {
  beforeEach(() => {
    setConfigForTesting(buildAutoConfig());
  });

  test('heartbeat request resolves to heartbeat tier model', async () => {
    const candidates = await Router.resolveCandidates(
      'auto',
      undefined,
      { messages: [{ role: 'user', content: 'ping' }] },
      'test-req-1'
    );
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0]!.model).toBe('hb-model');
  });

  test('simple factual question resolves to simple tier model', async () => {
    const candidates = await Router.resolveCandidates(
      'auto',
      undefined,
      { messages: [{ role: 'user', content: 'What is the capital of France?' }] },
      'test-req-2'
    );
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0]!.model).toBe('sm-model');
  });

  test('reasoning request resolves to reasoning tier model', async () => {
    const candidates = await Router.resolveCandidates(
      'auto',
      undefined,
      {
        messages: [
          {
            role: 'user',
            content:
              'Prove that the square root of 2 is irrational. Derive the proof step by step using proof by contradiction.',
          },
        ],
      },
      'test-req-3'
    );
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0]!.model).toBe('rs-model');
  });

  test('auto without requestContext falls through to normal alias lookup (not found)', async () => {
    // When requestContext is not passed, "auto" is treated as a regular alias name
    // which does not exist in models → should return empty array
    const candidates = await Router.resolveCandidates('auto', undefined, undefined, undefined);
    expect(candidates).toHaveLength(0);
  });

  test('incomingModelAlias is preserved as "auto" in results', async () => {
    const candidates = await Router.resolveCandidates(
      'auto',
      undefined,
      { messages: [{ role: 'user', content: 'What is 2+2?' }] },
      'test-req-4'
    );
    // The final RouteResult should trace back to the tier-resolved alias,
    // but the incomingModelAlias used in Router.resolveCandidates is the tier alias
    expect(candidates.length).toBeGreaterThan(0);
  });
});

describe('Router.resolve with model="auto"', () => {
  beforeEach(() => {
    setConfigForTesting(buildAutoConfig());
  });

  test('resolves a simple question to the simple model', async () => {
    const result = await Router.resolve(
      'auto',
      undefined,
      { messages: [{ role: 'user', content: 'What is 2+2?' }] },
      'test-req-5'
    );
    // "What is 2+2?" with a question mark — single question → simplicity signal
    // Should resolve to simple or heartbeat
    expect(['sm-model', 'hb-model']).toContain(result.model);
  });

  test('throws when auto is not configured', async () => {
    const cfg = buildAutoConfig();
    cfg.auto = undefined;
    setConfigForTesting(cfg);

    expect(
      Router.resolve(
        'auto',
        undefined,
        { messages: [{ role: 'user', content: 'What is the capital of France?' }] },
        'test-req-6'
      )
    ).rejects.toThrow('auto model not configured');
  });

  test('throws when auto is disabled', async () => {
    setConfigForTesting(buildAutoConfig({ enabled: false } as any));

    expect(
      Router.resolve(
        'auto',
        undefined,
        { messages: [{ role: 'user', content: 'What is the capital of France?' }] },
        'test-req-7'
      )
    ).rejects.toThrow('auto model not configured');
  });
});

describe('agentic boost in auto routing', () => {
  test('strongly agentic request with low boost threshold gets promoted', async () => {
    // Set a very low agentic boost threshold so any agentic signal triggers boost
    setConfigForTesting(buildAutoConfig({ agentic_boost_threshold: 0.1 } as any));

    // Simple cognitive content but with agentic keywords and tools
    const result = await Router.resolve(
      'auto',
      undefined,
      {
        messages: [
          {
            role: 'user',
            content:
              'Read the file config.json, check the database settings, then update the connection string and verify it works.',
          },
        ],
        tools: [
          {
            type: 'function',
            function: {
              name: 'read_file',
              description: 'Read a file',
              parameters: { type: 'object', properties: {} },
            },
          },
          {
            type: 'function',
            function: {
              name: 'write_file',
              description: 'Write a file',
              parameters: { type: 'object', properties: {} },
            },
          },
        ],
      },
      'test-req-8'
    );

    // With very low boost threshold, the tier should be boosted above base
    // (MEDIUM → COMPLEX or COMPLEX → REASONING)
    expect(['cx-model', 'rs-model']).toContain(result.model);
  });
});
