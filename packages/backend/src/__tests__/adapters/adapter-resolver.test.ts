import { describe, expect, it } from 'vitest';
import { resolveAdapters } from '../../services/adapter-resolver';
import type { RouteResult } from '../../services/router';

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
