import { describe, expect, it } from 'vitest';
import {
  isAnthropicTargetProvider,
  resolveAdapters,
} from '../../services/dispatch/adapter-resolver';
import type { RouteResult } from '../../services/routing/router';
import { apiAccessToKey } from '../../utils/api-format';

// Minimal RouteResult factory. `configOverrides` is spread LAST so a test can
// replace any baseline config field (api_base_url, useClaudeMasking, …).
function makeRoute(
  providerAdapter?: any[],
  modelAdapter?: any[],
  configOverrides?: Record<string, any>
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
      ...configOverrides,
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

  it('auto-injects unsupported-option suppression for a provider-prefixed GPT-5 target model', () => {
    // Target models routed through the pi-ai registry carry a provider prefix
    // (e.g. an OpenLimits aggregator target for gpt-5.5), which the anchored
    // legacy regex missed entirely.
    const route: RouteResult = { ...makeRoute(), model: 'openai/gpt-5.5' };
    expect(resolveAdapters(route).map((r) => r.adapter.name)).toEqual([
      'suppress_unsupported_gpt5_options',
    ]);
  });

  it('auto-injects unsupported-option suppression for gpt-5 and gpt-5-mini', () => {
    for (const model of ['gpt-5', 'gpt-5-mini']) {
      const route: RouteResult = { ...makeRoute(), model };
      expect(resolveAdapters(route).map((r) => r.adapter.name)).toEqual([
        'suppress_unsupported_gpt5_options',
      ]);
    }
  });

  it('does not auto-inject GPT-5 suppression for lookalike model ids', () => {
    for (const model of ['gpt-55', 'chatgpt-5', 'my-gpt-5x']) {
      const route: RouteResult = { ...makeRoute(), model };
      expect(resolveAdapters(route)).toHaveLength(0);
    }
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

describe('resolveAdapters — Anthropic tool-id normalization gate', () => {
  // The gate has TWO parts: the outbound wire format must be Anthropic Messages
  // AND the target must look like Anthropic. Not every messages-format target is
  // Anthropic — a plain Messages-speaking proxy does not enforce Anthropic's
  // tool-id charset, and rewriting ids there would corrupt ids the client
  // matches against on its next turn.
  const NORMALIZER = 'normalize_anthropic_tool_ids';
  const UNSIGNED_STRIP = 'strip_unsigned_thinking';
  // Both adapters hang off the same "target is Anthropic" gate and are injected
  // together, in this order.
  const ANTHROPIC_IMPLICIT = [NORMALIZER, UNSIGNED_STRIP];

  it('auto-injects for a string anthropic.com base URL on the messages wire format', () => {
    const route = makeRoute(undefined, undefined, {
      api_base_url: 'https://api.anthropic.com',
    });
    expect(resolveAdapters(route, 'messages').map((r) => r.adapter.name)).toEqual(
      ANTHROPIC_IMPLICIT
    );
  });

  it('auto-injects for a record base URL whose messages value is anthropic.com', () => {
    const route = makeRoute(undefined, undefined, {
      api_base_url: { messages: 'https://gw.anthropic.com/v1' },
    });
    expect(resolveAdapters(route, 'messages').map((r) => r.adapter.name)).toEqual(
      ANTHROPIC_IMPLICIT
    );
  });

  it('matches the anthropic.com host case-insensitively', () => {
    const route = makeRoute(undefined, undefined, {
      api_base_url: 'https://API.ANTHROPIC.COM',
    });
    expect(resolveAdapters(route, 'messages').map((r) => r.adapter.name)).toEqual(
      ANTHROPIC_IMPLICIT
    );
  });

  it('auto-injects for an Anthropic OAuth route (string oauth:// URL)', () => {
    // Native-OAuth Anthropic routes reach the resolver with effectiveApiType
    // already resolved to 'messages' (request-manager.ts), never 'oauth'.
    const route = makeRoute(undefined, undefined, {
      api_base_url: 'oauth://anthropic',
      oauth_provider: 'anthropic',
    });
    expect(resolveAdapters(route, 'messages').map((r) => r.adapter.name)).toEqual(
      ANTHROPIC_IMPLICIT
    );
  });

  it('auto-injects for an Anthropic OAuth route (record oauth:// URL)', () => {
    const route = makeRoute(undefined, undefined, {
      api_base_url: { messages: 'oauth://anthropic' },
      oauth_provider: 'anthropic',
    });
    expect(resolveAdapters(route, 'messages').map((r) => r.adapter.name)).toEqual(
      ANTHROPIC_IMPLICIT
    );
  });

  it('auto-injects for a Claude-masking route regardless of its base URL', () => {
    const route = makeRoute(undefined, undefined, {
      api_base_url: 'https://example.com',
      useClaudeMasking: true,
    });
    expect(resolveAdapters(route, 'messages').map((r) => r.adapter.name)).toEqual(
      ANTHROPIC_IMPLICIT
    );
  });

  it('auto-injects for a messages subtype on an Anthropic target', () => {
    // Subtype keys are minted by apiAccessToKey from a configured
    // `access_via: [{ type, subtype }]` entry, so the injection has to match on
    // the base type rather than the whole string. No `messages:*` subtype ships
    // today ('responses:lite' is the only named one), but the config schema
    // accepts any type/subtype pair, so one is constructible.
    const subtypeApiType = apiAccessToKey({ type: 'Messages', subtype: 'Lite' });
    expect(subtypeApiType).toBe('messages:lite');
    const route = makeRoute(undefined, undefined, {
      api_base_url: 'https://api.anthropic.com',
    });
    expect(resolveAdapters(route, subtypeApiType).map((r) => r.adapter.name)).toEqual(
      ANTHROPIC_IMPLICIT
    );
  });

  it('does NOT auto-inject for a non-Anthropic messages proxy', () => {
    const route = makeRoute(undefined, undefined, {
      api_base_url: 'https://p1.example.com/v1',
    });
    expect(resolveAdapters(route, 'messages')).toHaveLength(0);
  });

  it('does NOT auto-inject for a record whose anthropic.com URL is not the dispatched one', () => {
    // The messages request goes to r8.example; the chat URL is never dispatched
    // for this wire format and must not pull the normalizer in.
    const route = makeRoute(undefined, undefined, {
      api_base_url: { messages: 'https://r8.example/v1', chat: 'https://api.anthropic.com/v1' },
    });
    expect(resolveAdapters(route, 'messages')).toHaveLength(0);
  });

  it('does NOT auto-inject for a Copilot OAuth route serving a Claude model over messages', () => {
    // The real-world non-Anthropic messages-wire OAuth case: GitHub Copilot
    // fronts Claude models, so nativeOAuthApiType() resolves this route's wire
    // type to 'messages' — yet the upstream is Copilot, not Anthropic, and it
    // does not enforce Anthropic's tool-id charset.
    const route = makeRoute(undefined, undefined, {
      api_base_url: 'oauth://github-copilot',
      oauth_provider: 'github-copilot',
    });
    expect(resolveAdapters(route, 'messages')).toHaveLength(0);
  });

  it('does NOT auto-inject for a non-Anthropic OAuth provider', () => {
    const route = makeRoute(undefined, undefined, {
      api_base_url: 'oauth://openai-codex',
      oauth_provider: 'openai-codex',
    });
    expect(resolveAdapters(route, 'messages')).toHaveLength(0);
  });

  it('does not auto-inject the tool-id normalizer for non-messages API types', () => {
    const route = makeRoute(undefined, undefined, {
      api_base_url: 'https://api.anthropic.com',
    });
    for (const apiType of [
      'chat',
      'responses',
      'responses:lite',
      'gemini',
      'completions',
      'ollama',
    ]) {
      expect(resolveAdapters(route, apiType)).toHaveLength(0);
    }
  });

  it('does not auto-inject the tool-id normalizer when no API type is passed', () => {
    const route = makeRoute(undefined, undefined, {
      api_base_url: 'https://api.anthropic.com',
    });
    expect(resolveAdapters(route)).toHaveLength(0);
  });

  it('allows a provider adapter entry to disable the tool-id normalizer', () => {
    const route = makeRoute([{ name: NORMALIZER, enabled: false }], undefined, {
      api_base_url: 'https://api.anthropic.com',
    });
    expect(resolveAdapters(route, 'messages').map((r) => r.adapter.name)).toEqual([UNSIGNED_STRIP]);
  });

  it('allows a model adapter entry to disable the tool-id normalizer', () => {
    // Same tombstone override as the provider level, one scope down.
    const route = makeRoute(undefined, [{ name: NORMALIZER, enabled: false }], {
      api_base_url: 'https://api.anthropic.com',
    });
    expect(resolveAdapters(route, 'messages').map((r) => r.adapter.name)).toEqual([UNSIGNED_STRIP]);
  });

  it('allows a provider adapter entry to force-enable the normalizer on a non-Anthropic proxy', () => {
    // The escape hatch for an Anthropic-compatible gateway on some other host
    // that DOES enforce the tool-id charset.
    const route = makeRoute([{ name: NORMALIZER, options: {}, enabled: true }], undefined, {
      api_base_url: 'https://p1.example.com/v1',
    });
    expect(resolveAdapters(route, 'messages').map((r) => r.adapter.name)).toEqual([NORMALIZER]);
  });

  it('allows a model adapter entry to restore the tool-id normalizer disabled by its provider', () => {
    const route = makeRoute(
      [{ name: NORMALIZER, enabled: false }],
      [{ name: NORMALIZER, enabled: true }],
      { api_base_url: 'https://api.anthropic.com' }
    );
    expect(resolveAdapters(route, 'messages').map((r) => r.adapter.name)).toEqual([
      UNSIGNED_STRIP,
      NORMALIZER,
    ]);
  });

  it('resolves the normalizer TWICE when an Anthropic route also enables it explicitly', () => {
    // Pins the tolerated duplicate: the implicit injection and the explicit
    // enabled entry both land in the list. Harmless because the sanitizer is
    // idempotent (f(f(x)) === f(x)), so the second pass rewrites nothing. This
    // test exists so that adding de-duplication later is a conscious decision
    // rather than an accidental behaviour change.
    const route = makeRoute([{ name: NORMALIZER, options: {}, enabled: true }], undefined, {
      api_base_url: 'https://api.anthropic.com',
    });
    expect(resolveAdapters(route, 'messages').map((r) => r.adapter.name)).toEqual([
      NORMALIZER,
      UNSIGNED_STRIP,
      NORMALIZER,
    ]);
  });

  it('runs the tool-id normalizer after other implicit adapters and before configured ones', () => {
    const route = makeRoute([{ name: 'reasoning_content', options: {} }], undefined, {
      pi_ai_provider: 'openrouter',
      useClaudeMasking: true,
    });
    route.model = 'gpt-5.2';
    expect(resolveAdapters(route, 'messages').map((r) => r.adapter.name)).toEqual([
      'suppress_unsupported_gpt5_options',
      'strip_unsupported_tool_search',
      'normalize_anthropic_tool_ids',
      'strip_unsigned_thinking',
      'reasoning_content',
    ]);
  });
});

describe('resolveAdapters — Anthropic unsigned-thinking strip gate', () => {
  // `strip_unsigned_thinking` shares the tool-id normalizer's gate (Anthropic
  // Messages wire format AND an Anthropic-looking target) but is its own
  // adapter, so it can be tombstoned or force-enabled independently. The gate
  // itself is exercised exhaustively above; these cases pin the independence.
  const NORMALIZER = 'normalize_anthropic_tool_ids';
  const UNSIGNED_STRIP = 'strip_unsigned_thinking';

  it('is injected after the tool-id normalizer for an Anthropic target', () => {
    const route = makeRoute(undefined, undefined, {
      api_base_url: 'https://api.anthropic.com/v1',
    });
    expect(resolveAdapters(route, 'messages').map((r) => r.adapter.name)).toEqual([
      NORMALIZER,
      UNSIGNED_STRIP,
    ]);
  });

  it('is NOT injected for a non-Anthropic messages proxy (unsigned thinking must survive for e.g. Kimi)', () => {
    const route = makeRoute(undefined, undefined, {
      api_base_url: { messages: 'https://api.moonshot.ai/anthropic' },
    });
    expect(resolveAdapters(route, 'messages')).toHaveLength(0);
  });

  it('is NOT injected for an Anthropic target on a non-messages wire format', () => {
    const route = makeRoute(undefined, undefined, {
      api_base_url: 'https://api.anthropic.com/v1',
    });
    expect(resolveAdapters(route, 'chat')).toHaveLength(0);
  });

  it('can be tombstoned on its own, leaving the tool-id normalizer in place', () => {
    const route = makeRoute([{ name: UNSIGNED_STRIP, enabled: false }], undefined, {
      api_base_url: 'https://api.anthropic.com/v1',
    });
    expect(resolveAdapters(route, 'messages').map((r) => r.adapter.name)).toEqual([NORMALIZER]);
  });

  it('can be force-enabled on a strict Anthropic-compatible gateway on another host', () => {
    const route = makeRoute([{ name: UNSIGNED_STRIP, options: {}, enabled: true }], undefined, {
      api_base_url: 'https://claude-gateway.example.com/v1',
    });
    expect(resolveAdapters(route, 'messages').map((r) => r.adapter.name)).toEqual([UNSIGNED_STRIP]);
  });
});

describe('isAnthropicTargetProvider', () => {
  // Contract: "is the URL this dispatch would actually be sent to an Anthropic
  // one?". For the record form of api_base_url the answer is therefore scoped to
  // the key `resolveProviderBaseUrl` would pick for the given wire type (exact
  // key, then base type); with no wire type passed, every value is scanned.

  it('matches a string anthropic.com base URL', () => {
    expect(
      isAnthropicTargetProvider(
        makeRoute(undefined, undefined, { api_base_url: 'https://api.anthropic.com' })
      )
    ).toBe(true);
  });

  it('matches a string anthropic.com base URL case-insensitively', () => {
    expect(
      isAnthropicTargetProvider(
        makeRoute(undefined, undefined, { api_base_url: 'https://API.ANTHROPIC.COM/v1' })
      )
    ).toBe(true);
  });

  it('matches a string base URL regardless of the API type passed', () => {
    // Nothing to select in the string form — the same URL serves every type.
    const route = makeRoute(undefined, undefined, { api_base_url: 'https://api.anthropic.com' });
    for (const apiType of [undefined, 'messages', 'messages:lite', 'chat']) {
      expect(isAnthropicTargetProvider(route, apiType)).toBe(true);
    }
  });

  it('matches a record base URL whose messages value is anthropic.com', () => {
    expect(
      isAnthropicTargetProvider(
        makeRoute(undefined, undefined, {
          api_base_url: { messages: 'https://gw.anthropic.com/v1' },
        }),
        'messages'
      )
    ).toBe(true);
  });

  it("matches the record's messages value even when another key points elsewhere", () => {
    expect(
      isAnthropicTargetProvider(
        makeRoute(undefined, undefined, {
          api_base_url: { chat: 'https://x.example.com', messages: 'https://y.anthropic.com' },
        }),
        'messages'
      )
    ).toBe(true);
  });

  it('does NOT match a record whose anthropic.com value sits under an unused key', () => {
    // The bug this scoping exists for: dispatch sends the messages request to
    // r8.example, so the (unused) chat URL must not make it look Anthropic.
    expect(
      isAnthropicTargetProvider(
        makeRoute(undefined, undefined, {
          api_base_url: { messages: 'https://r8.example/v1', chat: 'https://api.anthropic.com/v1' },
        }),
        'messages'
      )
    ).toBe(false);
  });

  it('matches that same record when the dispatched key IS the anthropic.com one', () => {
    // Chat is not the Messages wire format, so resolveAdapters' gate would never
    // inject for it — but the helper's own contract is per-key, and the URL a
    // 'chat' dispatch uses here really is Anthropic's.
    expect(
      isAnthropicTargetProvider(
        makeRoute(undefined, undefined, {
          api_base_url: { messages: 'https://r8.example/v1', chat: 'https://api.anthropic.com/v1' },
        }),
        'chat'
      )
    ).toBe(true);
  });

  it('scans every record value when no API type is passed', () => {
    // Legacy/unscoped callers keep the pre-scoping any-value behaviour.
    expect(
      isAnthropicTargetProvider(
        makeRoute(undefined, undefined, {
          api_base_url: { messages: 'https://r8.example/v1', chat: 'https://api.anthropic.com/v1' },
        })
      )
    ).toBe(true);
  });

  it('resolves a messages subtype to the exact key first, then the base-type key', () => {
    // Mirrors resolveProviderBaseUrl's `urlMap[typeKey] || urlMap[baseType]`.
    expect(
      isAnthropicTargetProvider(
        makeRoute(undefined, undefined, {
          api_base_url: { messages: 'https://gw.anthropic.com/v1' },
        }),
        'messages:lite'
      )
    ).toBe(true);
    expect(
      isAnthropicTargetProvider(
        makeRoute(undefined, undefined, {
          api_base_url: {
            'messages:lite': 'https://r8.example/v1',
            messages: 'https://gw.anthropic.com/v1',
          },
        }),
        'messages:lite'
      )
    ).toBe(false);
  });

  it('does not match when the record has no key for the dispatched API type', () => {
    // resolveProviderBaseUrl would fall back further (default key, aliases, first
    // key); the gate deliberately treats a provider that doesn't advertise the
    // wire type as no evidence of an Anthropic target.
    expect(
      isAnthropicTargetProvider(
        makeRoute(undefined, undefined, {
          api_base_url: { chat: 'https://api.anthropic.com/v1' },
        }),
        'messages'
      )
    ).toBe(false);
  });

  it('does not match a record base URL with no anthropic.com value', () => {
    expect(
      isAnthropicTargetProvider(
        makeRoute(undefined, undefined, {
          api_base_url: { messages: 'https://p1.example.com/v1' },
        }),
        'messages'
      )
    ).toBe(false);
  });

  it('does not match a plain string proxy URL', () => {
    expect(
      isAnthropicTargetProvider(
        makeRoute(undefined, undefined, { api_base_url: 'https://p1.example.com/v1' })
      )
    ).toBe(false);
  });

  it('matches an oauth:// route whose oauth_provider is anthropic', () => {
    expect(
      isAnthropicTargetProvider(
        makeRoute(undefined, undefined, {
          api_base_url: 'oauth://anthropic',
          oauth_provider: 'anthropic',
        })
      )
    ).toBe(true);
  });

  it('does not match an oauth:// route for a non-Anthropic OAuth provider', () => {
    expect(
      isAnthropicTargetProvider(
        makeRoute(undefined, undefined, {
          api_base_url: 'oauth://openai-codex',
          oauth_provider: 'openai-codex',
        })
      )
    ).toBe(false);
  });

  it('falls back to the provider slug when oauth_provider is unset', () => {
    // Same `oauth_provider || route.provider` resolution request-manager.ts uses.
    const route = makeRoute(undefined, undefined, { api_base_url: 'oauth://anthropic' });
    route.provider = 'anthropic';
    expect(isAnthropicTargetProvider(route)).toBe(true);
  });

  it('matches an oauth:// value inside a record base URL', () => {
    expect(
      isAnthropicTargetProvider(
        makeRoute(undefined, undefined, {
          api_base_url: { messages: 'oauth://anthropic' },
          oauth_provider: 'anthropic',
        }),
        'messages'
      )
    ).toBe(true);
  });

  it('does NOT match an oauth:// value sitting under an unused key', () => {
    // The key scoping applies to the oauth:// signal too, not just the host test.
    expect(
      isAnthropicTargetProvider(
        makeRoute(undefined, undefined, {
          api_base_url: { messages: 'https://r8.example/v1', chat: 'oauth://anthropic' },
          oauth_provider: 'anthropic',
        }),
        'messages'
      )
    ).toBe(false);
  });

  it('matches a Claude-masking route regardless of its base URL or API type', () => {
    const route = makeRoute(undefined, undefined, {
      api_base_url: 'https://example.com',
      useClaudeMasking: true,
    });
    for (const apiType of [undefined, 'messages', 'chat']) {
      expect(isAnthropicTargetProvider(route, apiType)).toBe(true);
    }
  });
});
