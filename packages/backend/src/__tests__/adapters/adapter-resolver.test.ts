import { describe, expect, it } from 'vitest';
import { resolveAdapters } from '../../services/dispatch/adapter-resolver';
import type { RouteResult } from '../../services/routing/router';

// Minimal RouteResult factory
function makeRoute(providerAdapter?: any[], modelAdapter?: any[]): RouteResult {
  return {
    provider: 'test-provider',
    model: 'test-model',
    config: {
      api_base_url: 'https://example.com',
      api_key: 'key',
      enabled: true,
      disable_cooldown: false,
      estimateTokens: false,
      useClaudeMasking: false,
      adapter: providerAdapter,
    } as any,
    modelConfig: modelAdapter !== undefined ? ({ adapter: modelAdapter } as any) : undefined,
  } as RouteResult;
}

describe('resolveAdapters', () => {
  it('returns empty array when no adapter is configured', () => {
    const route = makeRoute(undefined, undefined);
    expect(resolveAdapters(route)).toHaveLength(0);
  });

  it('auto-injects the tool-search strip adapter when pi_ai_provider is openrouter', () => {
    const route: RouteResult = {
      ...makeRoute(undefined, undefined),
      config: {
        ...makeRoute().config,
        pi_ai_provider: 'openrouter',
      },
    };
    const resolved = resolveAdapters(route);
    expect(resolved.map((r) => r.adapter.name)).toEqual(['strip_unsupported_tool_search']);
  });

  it('auto-injects unsupported-option suppression for GPT-5 family models', () => {
    const route: RouteResult = { ...makeRoute(), model: 'gpt-5.2' };
    expect(resolveAdapters(route).map((r) => r.adapter.name)).toEqual([
      'suppress_unsupported_gpt5_options',
    ]);
  });

  it('does not auto-inject GPT-5 suppression for other model families', () => {
    const route: RouteResult = { ...makeRoute(), model: 'gpt-4.1' };
    expect(resolveAdapters(route)).toHaveLength(0);
  });

  it('allows a model adapter entry to disable GPT-5 suppression', () => {
    const route = makeRoute(undefined, [
      { name: 'suppress_unsupported_gpt5_options', enabled: false },
    ]);
    route.model = 'gpt-5.2';
    expect(resolveAdapters(route)).toHaveLength(0);
  });

  it('allows a model adapter entry to restore an adapter disabled by its provider', () => {
    const route = makeRoute(
      [{ name: 'suppress_unsupported_gpt5_options', enabled: false }],
      [{ name: 'suppress_unsupported_gpt5_options', enabled: true }]
    );
    route.model = 'gpt-5.2';
    expect(resolveAdapters(route).map((r) => r.adapter.name)).toEqual([
      'suppress_unsupported_gpt5_options',
    ]);
  });

  it('does not auto-inject anything for non-openrouter pi_ai_provider', () => {
    const route: RouteResult = {
      ...makeRoute(undefined, undefined),
      config: {
        ...makeRoute().config,
        pi_ai_provider: 'anthropic',
      },
    };
    expect(resolveAdapters(route)).toHaveLength(0);
  });

  it('does not auto-inject anything when pi_ai_provider is unset', () => {
    expect(resolveAdapters(makeRoute(undefined, undefined))).toHaveLength(0);
  });

  it('runs the implicit adapter before user-configured adapters', () => {
    const base = makeRoute([{ name: 'reasoning_content', options: {} }]);
    const route: RouteResult = {
      ...base,
      config: { ...base.config, pi_ai_provider: 'openrouter' },
    };
    const resolved = resolveAdapters(route);
    expect(resolved.map((r) => r.adapter.name)).toEqual([
      'strip_unsupported_tool_search',
      'reasoning_content',
    ]);
  });

  it('runs GPT-5 suppression before other implicit and configured adapters', () => {
    const base = makeRoute([{ name: 'reasoning_content', options: {} }]);
    const route: RouteResult = {
      ...base,
      model: 'gpt-5-codex',
      config: { ...base.config, pi_ai_provider: 'openrouter' },
    };
    expect(resolveAdapters(route).map((r) => r.adapter.name)).toEqual([
      'suppress_unsupported_gpt5_options',
      'strip_unsupported_tool_search',
      'reasoning_content',
    ]);
  });

  it('resolves a provider-level adapter entry', () => {
    const route = makeRoute([{ name: 'reasoning_content', options: {} }]);
    const resolved = resolveAdapters(route);
    expect(resolved).toHaveLength(1);
    expect(resolved[0]!.adapter.name).toBe('reasoning_content');
    expect(resolved[0]!.options).toEqual({});
  });

  it('resolves a model-level adapter entry', () => {
    const route = makeRoute(undefined, [{ name: 'suppress_developer_role', options: {} }]);
    const resolved = resolveAdapters(route);
    expect(resolved).toHaveLength(1);
    expect(resolved[0]!.adapter.name).toBe('suppress_developer_role');
    expect(resolved[0]!.options).toEqual({});
  });

  it('merges provider-level then model-level adapters in order', () => {
    const route = makeRoute(
      [{ name: 'reasoning_content', options: {} }],
      [{ name: 'suppress_developer_role', options: {} }]
    );
    const resolved = resolveAdapters(route);
    expect(resolved.map((r) => r.adapter.name)).toEqual([
      'reasoning_content',
      'suppress_developer_role',
    ]);
  });

  it('passes options through from config', () => {
    const rules = [
      {
        model: 'deepseek-r1',
        rewriteTo: 'deepseek-r1-fast',
        conditions: [{ field: 'reasoning.enabled', value: false }],
      },
    ];
    const route = makeRoute([{ name: 'model_override', options: { rules } }]);
    const resolved = resolveAdapters(route);
    expect(resolved).toHaveLength(1);
    expect(resolved[0]!.adapter.name).toBe('model_override');
    expect(resolved[0]!.options).toEqual({ rules });
  });

  it('skips and warns on unknown adapter names (does not throw)', () => {
    const route = makeRoute([{ name: 'nonexistent_adapter', options: {} }]);
    const resolved = resolveAdapters(route);
    expect(resolved).toHaveLength(0);
  });

  it('handles mixed valid and invalid adapter names', () => {
    const route = makeRoute(
      [
        { name: 'reasoning_content', options: {} },
        { name: 'bogus', options: {} },
      ],
      [{ name: 'suppress_developer_role', options: {} }]
    );
    const resolved = resolveAdapters(route);
    expect(resolved.map((r) => r.adapter.name)).toEqual([
      'reasoning_content',
      'suppress_developer_role',
    ]);
  });

  it('handles multiple provider-level adapter entries', () => {
    const route = makeRoute([
      { name: 'reasoning_content', options: {} },
      { name: 'suppress_developer_role', options: {} },
    ]);
    const resolved = resolveAdapters(route);
    expect(resolved.map((r) => r.adapter.name)).toEqual([
      'reasoning_content',
      'suppress_developer_role',
    ]);
  });

  it('resolves model_override adapter', () => {
    const route = makeRoute([{ name: 'model_override', options: { rules: [] } }]);
    const resolved = resolveAdapters(route);
    expect(resolved).toHaveLength(1);
    expect(resolved[0]!.adapter.name).toBe('model_override');
  });
});
