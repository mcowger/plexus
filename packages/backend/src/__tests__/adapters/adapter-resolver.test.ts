import { describe, expect, it } from 'vitest';
import { resolveAdapters } from '../../services/adapter-resolver';
import type { RouteResult } from '../../services/router';

// Minimal RouteResult factory
function makeRoute(
  providerAdapter?: string | string[],
  modelAdapter?: string | string[]
): RouteResult {
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

  it('resolves a provider-level string adapter', () => {
    const route = makeRoute('reasoning_content');
    const adapters = resolveAdapters(route);
    expect(adapters).toHaveLength(1);
    expect(adapters[0]!.name).toBe('reasoning_content');
  });

  it('resolves a provider-level array adapter', () => {
    const route = makeRoute(['reasoning_content', 'suppress_developer_role']);
    const adapters = resolveAdapters(route);
    expect(adapters.map((a) => a.name)).toEqual(['reasoning_content', 'suppress_developer_role']);
  });

  it('resolves a model-level string adapter', () => {
    const route = makeRoute(undefined, 'suppress_developer_role');
    const adapters = resolveAdapters(route);
    expect(adapters).toHaveLength(1);
    expect(adapters[0]!.name).toBe('suppress_developer_role');
  });

  it('merges provider-level then model-level adapters in order', () => {
    const route = makeRoute('reasoning_content', 'suppress_developer_role');
    const adapters = resolveAdapters(route);
    expect(adapters.map((a) => a.name)).toEqual(['reasoning_content', 'suppress_developer_role']);
  });

  it('skips and warns on unknown adapter names (does not throw)', () => {
    const route = makeRoute('nonexistent_adapter');
    // Should not throw; unknown names are skipped
    const adapters = resolveAdapters(route);
    expect(adapters).toHaveLength(0);
  });

  it('handles mixed valid and invalid adapter names', () => {
    const route = makeRoute(['reasoning_content', 'bogus'], 'suppress_developer_role');
    const adapters = resolveAdapters(route);
    expect(adapters.map((a) => a.name)).toEqual(['reasoning_content', 'suppress_developer_role']);
  });

  it('handles model-level array adapters', () => {
    const route = makeRoute(undefined, ['reasoning_content', 'suppress_developer_role']);
    const adapters = resolveAdapters(route);
    expect(adapters.map((a) => a.name)).toEqual(['reasoning_content', 'suppress_developer_role']);
  });
});
