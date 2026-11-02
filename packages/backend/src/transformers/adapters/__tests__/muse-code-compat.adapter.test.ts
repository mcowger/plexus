/**
 * muse_code_compat adapter.
 *
 * Meta's Model API (`api.meta.ai/v1`) 400s on `tool_choice` values other
 * than `"auto"` and on `custom` tool declarations (verified against the
 * endpoint; see oh-my-pi's meta provider notes).
 *
 * What must hold:
 *   - `tool_choice` is omitted in all cases (`"auto"` is the default when
 *     absent, so the drop is semantics-preserving where Meta would comply);
 *   - `custom` tools are stripped (function and other tools untouched),
 *     preserving an emptied `tools` array rather than deleting it;
 *   - payloads needing no work return by reference;
 *   - the adapter auto-injects for `meta` OAuth routes and direct
 *     `api.meta.ai` targets, and a tombstone opts out.
 */

import { describe, expect, it, test } from 'bun:test';

import { resolveAdapters } from '../../../services/dispatch/adapter-resolver';
import type { RouteResult } from '../../../services/routing/router';
import {
  hasMuseBuiltinNamespace,
  injectMuseBuiltinTool,
  MUSE_BUILTIN_NAMESPACE_DECLARATION,
} from '../muse-builtin-tool';
import {
  isCustomTool,
  isMuseSubscriptionTarget,
  isMuseTarget,
  museCodeCompatAdapter,
} from '../muse-code-compat.adapter';

function makeRoute(configOverrides: Record<string, any> = {}): RouteResult {
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
      ...configOverrides,
    } as any,
  } as RouteResult;
}

describe('isCustomTool', () => {
  it('matches custom tool declarations', () => {
    expect(isCustomTool({ type: 'custom', name: 'apply_patch' })).toBe(true);
    expect(isCustomTool({ type: 'Custom', name: 'x' })).toBe(true);
  });

  it('rejects everything else', () => {
    expect(isCustomTool({ type: 'function', function: { name: 'f' } })).toBe(false);
    expect(isCustomTool({ type: 'web_search' })).toBe(false);
    expect(isCustomTool({ name: 'no-type' })).toBe(false);
    expect(isCustomTool(null)).toBe(false);
    expect(isCustomTool('custom')).toBe(false);
  });
});

describe('museCodeCompatAdapter.preDispatch', () => {
  it('returns payload by reference when no work is needed', () => {
    const payload = {
      model: 'muse-spark-1.3',
      input: [],
      tools: [{ type: 'function', name: 'read', function: { name: 'read' } }],
    };
    expect(museCodeCompatAdapter.preDispatch(payload)).toBe(payload);
  });

  it('omits tool_choice in all its forms', () => {
    for (const tool_choice of [
      'auto',
      'none',
      'required',
      { type: 'function', function: { name: 'read' } },
    ]) {
      const result = museCodeCompatAdapter.preDispatch({
        model: 'muse-spark-1.3',
        input: [],
        tool_choice,
      });
      expect(result).not.toHaveProperty('tool_choice');
    }
  });

  it('strips custom tools but keeps function tools', () => {
    const read = { type: 'function', name: 'read', function: { name: 'read' } };
    const result = museCodeCompatAdapter.preDispatch({
      model: 'muse-spark-1.3',
      input: [],
      tool_choice: 'required',
      tools: [read, { type: 'custom', name: 'apply_patch' }],
    });
    expect(result.tools).toEqual([read]);
    expect(result).not.toHaveProperty('tool_choice');
  });

  it('preserves an emptied tools array instead of deleting it', () => {
    const result = museCodeCompatAdapter.preDispatch({
      model: 'muse-spark-1.3',
      input: [],
      tools: [{ type: 'custom', name: 'apply_patch' }],
    });
    expect(result.tools).toEqual([]);
  });
});

describe('Muse builtin tool declaration', () => {
  it('appends the namespace to a body that declares tools', () => {
    const read = { type: 'function', name: 'read', function: { name: 'read' } };
    const result = injectMuseBuiltinTool({ tools: [read] });
    expect(result.tools).toHaveLength(2);
    expect(result.tools[0]).toBe(read);
    expect(result.tools[1]).toEqual(MUSE_BUILTIN_NAMESPACE_DECLARATION);
  });

  it('leaves bodies without tools untouched', () => {
    const noTools = { model: 'muse-spark-1.3' };
    expect(injectMuseBuiltinTool(noTools)).toBe(noTools);

    const empty = { tools: [] };
    expect(injectMuseBuiltinTool(empty)).toBe(empty);
  });

  it('is idempotent, including for a genuine Muse Code body', () => {
    const genuine = { tools: [structuredClone(MUSE_BUILTIN_NAMESPACE_DECLARATION)] };
    expect(hasMuseBuiltinNamespace(genuine.tools)).toBe(true);
    expect(injectMuseBuiltinTool(genuine)).toBe(genuine);

    const once = injectMuseBuiltinTool({ tools: [{ type: 'function', name: 'read' }] });
    expect(injectMuseBuiltinTool(once)).toBe(once);
  });

  it('clones the declaration so callers cannot corrupt the constant', () => {
    const first = injectMuseBuiltinTool({ tools: [{ type: 'function', name: 'read' }] });
    (first.tools[1] as any).tools[0].name = 'mutated';
    const second = injectMuseBuiltinTool({ tools: [{ type: 'function', name: 'read' }] });
    expect((second.tools[1] as any).tools[0].name).toBe('cron_list');
    expect(MUSE_BUILTIN_NAMESPACE_DECLARATION.tools[0].name).toBe('cron_list');
  });

  it('injects only when the adapter is asked to', () => {
    const payload = { tools: [{ type: 'function', name: 'read' }] };
    expect(museCodeCompatAdapter.preDispatch(payload)).toBe(payload);
    expect(museCodeCompatAdapter.preDispatch(payload, { inject_builtin_tool: false })).toBe(
      payload
    );
    const injected = museCodeCompatAdapter.preDispatch(payload, { inject_builtin_tool: true });
    expect(hasMuseBuiltinNamespace(injected.tools)).toBe(true);
  });
});

describe('isMuseSubscriptionTarget', () => {
  it('matches meta OAuth routes', () => {
    expect(
      isMuseSubscriptionTarget(
        makeRoute({ api_base_url: 'oauth://plexus', oauth_provider: 'meta' })
      )
    ).toBe(true);
  });

  it('skips pay-as-you-go keys on the same host', () => {
    expect(isMuseSubscriptionTarget(makeRoute({ api_base_url: 'https://api.meta.ai/v1' }))).toBe(
      false
    );
  });

  it('requests the declaration only for subscription routes', () => {
    const subscription = resolveAdapters(
      makeRoute({ api_base_url: 'oauth://plexus', oauth_provider: 'meta' })
    );
    expect(subscription[0]?.options).toEqual({ inject_builtin_tool: true });

    const payg = resolveAdapters(makeRoute({ api_base_url: 'https://api.meta.ai/v1' }));
    expect(payg[0]?.options).toEqual({});
  });
});

describe('muse_code_compat implicit injection', () => {
  it('auto-injects for meta OAuth routes', () => {
    const route = makeRoute({ api_base_url: 'oauth://plexus', oauth_provider: 'meta' });
    expect(isMuseTarget(route)).toBe(true);
    expect(resolveAdapters(route).map((r) => r.adapter.name)).toEqual(['muse_code_compat']);
  });

  it('auto-injects for direct api.meta.ai targets', () => {
    const route = makeRoute({ api_base_url: 'https://api.meta.ai/v1' });
    expect(isMuseTarget(route)).toBe(true);
    expect(resolveAdapters(route).map((r) => r.adapter.name)).toEqual(['muse_code_compat']);
  });

  it('stays out of unrelated routes', () => {
    expect(resolveAdapters(makeRoute()).map((r) => r.adapter.name)).toEqual([]);
  });

  it('honors the opt-out tombstone', () => {
    const route = makeRoute({
      api_base_url: 'oauth://plexus',
      oauth_provider: 'meta',
      adapter: [{ name: 'muse_code_compat', enabled: false }],
    });
    expect(resolveAdapters(route)).toHaveLength(0);
  });
});
