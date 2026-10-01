import { describe, expect, test } from 'vitest';
import {
  detectResponsesExtensions,
  hasUnsupportedResponsesExtensions,
  LITE_ALLOWED_TOOL_TYPES,
  resolveSupportedResponsesExtensions,
} from '../responses-extensions';

function route(config: Record<string, unknown> = {}) {
  return {
    provider: 'p',
    model: 'm',
    config: { api_base_url: 'https://api.test/v1', models: {}, ...config },
  } as any;
}

describe('detectResponsesExtensions', () => {
  test('detects each tool declaration extension', () => {
    expect(
      detectResponsesExtensions({
        tools: [
          { type: 'namespace', name: 'crm', tools: [] },
          { type: 'custom', name: 'apply_patch' },
          { type: 'tool_search' },
          { type: 'function', name: 'ls' },
        ],
      })
    ).toEqual(new Set(['namespace_tools', 'custom_tools', 'tool_search']));
  });

  test('detects each input item extension', () => {
    expect(
      detectResponsesExtensions({
        input: [
          { type: 'additional_tools', tools: [] },
          { type: 'custom_tool_call', name: 'exec' },
          { type: 'custom_tool_call_output', call_id: 'c' },
          { type: 'tool_search_call' },
          { type: 'function_call', name: 'list', namespace: 'crm' },
        ],
      })
    ).toEqual(new Set(['additional_tools', 'custom_calls', 'tool_search', 'namespaced_calls']));
  });

  test('detects custom tools nested in a namespace or declared in additional_tools', () => {
    expect(
      detectResponsesExtensions({
        tools: [
          { type: 'namespace', name: 'functions', tools: [{ type: 'custom', name: 'exec' }] },
        ],
      })
    ).toEqual(new Set(['namespace_tools', 'custom_tools']));
    expect(
      detectResponsesExtensions({
        input: [{ type: 'additional_tools', tools: [{ type: 'custom', name: 'exec' }] }],
      })
    ).toEqual(new Set(['additional_tools', 'custom_tools']));
  });

  test('detects Muse dotted history separately, only against a declared namespace', () => {
    const tools = [{ type: 'namespace', name: 'muse', tools: [] }];
    expect(
      detectResponsesExtensions({
        tools,
        input: [{ type: 'function_call', name: 'muse.bash' }],
      })
    ).toEqual(new Set(['namespace_tools', 'dotted_calls']));
    expect(
      detectResponsesExtensions({ input: [{ type: 'function_call', name: 'muse.bash' }] }).size
    ).toBe(0);
  });

  test('counts namespaces declared inside additional_tools items', () => {
    expect(
      detectResponsesExtensions({
        input: [
          {
            type: 'additional_tools',
            tools: [{ type: 'namespace', name: 'functions', tools: [] }],
          },
          { type: 'function_call', name: 'functions.wait' },
        ],
      }).has('dotted_calls')
    ).toBe(true);
  });

  test('plain bodies and malformed values carry no extensions', () => {
    expect(
      detectResponsesExtensions({
        tools: [{ type: 'function', name: 'ls' }, null, 'x'],
        input: [{ type: 'message' }, { type: 'function_call', name: 'ls' }, null],
      }).size
    ).toBe(0);
    expect(detectResponsesExtensions(null).size).toBe(0);
    expect(detectResponsesExtensions('nope').size).toBe(0);
  });
});

describe('resolveSupportedResponsesExtensions', () => {
  test('plain responses accepts custom tool declarations only', () => {
    expect(resolveSupportedResponsesExtensions(route(), 'responses')).toEqual(
      new Set(['custom_tools'])
    );
  });

  test('responses:lite rejects top-level namespace tools and dotted names', () => {
    const supported = resolveSupportedResponsesExtensions(route(), 'responses:lite');
    expect(supported).toEqual(
      new Set([
        'namespaced_calls',
        'custom_tools',
        'custom_calls',
        'additional_tools',
        'tool_search',
      ])
    );
  });

  test('OAuth providers use their shared defaults', () => {
    const codex = resolveSupportedResponsesExtensions(
      route({ oauth_provider: 'openai-codex' }),
      'responses'
    );
    expect(codex.size).toBe(6);
    expect(codex.has('dotted_calls')).toBe(false);
    expect(
      resolveSupportedResponsesExtensions(route({ oauth_provider: 'meta' }), 'responses')
    ).toEqual(new Set(['namespace_tools', 'namespaced_calls', 'dotted_calls']));
  });

  test('API-key providers default by their Responses endpoint host', () => {
    expect(
      resolveSupportedResponsesExtensions(
        route({ api_base_url: { chat: 'https://x.test/v1', responses: 'https://api.meta.ai/v1' } }),
        'responses'
      )
    ).toEqual(new Set(['namespace_tools', 'namespaced_calls', 'dotted_calls']));
    expect(
      resolveSupportedResponsesExtensions(
        route({ api_base_url: 'https://api.openai.com/v1' }),
        'responses'
      )
    ).toEqual(new Set(['namespace_tools', 'namespaced_calls', 'custom_tools', 'custom_calls']));
    expect(
      resolveSupportedResponsesExtensions(
        route({ api_base_url: { responses: 'https://openrouter.ai/api/v1' } }),
        'responses'
      )
    ).toEqual(new Set(['custom_tools']));
  });

  test('responses:lite wins over the endpoint default', () => {
    expect(
      resolveSupportedResponsesExtensions(
        route({ api_base_url: 'https://api.openai.com/v1' }),
        'responses:lite'
      ).has('namespace_tools')
    ).toBe(false);
  });

  test('an explicit provider list overrides the default, and [] accepts nothing', () => {
    expect(
      resolveSupportedResponsesExtensions(
        route({ oauth_provider: 'meta', responses_extensions: ['custom_tools'] }),
        'responses'
      )
    ).toEqual(new Set(['custom_tools']));
    expect(
      resolveSupportedResponsesExtensions(route({ responses_extensions: [] }), 'responses').size
    ).toBe(0);
  });

  test('an explicit provider list never narrows the responses:lite contract', () => {
    expect(
      resolveSupportedResponsesExtensions(
        route({ responses_extensions: ['custom_tools'] }),
        'responses:lite'
      )
    ).toEqual(resolveSupportedResponsesExtensions(route(), 'responses:lite'));
  });
});

describe('hasUnsupportedResponsesExtensions', () => {
  const namespaceBody = { tools: [{ type: 'namespace', name: 'muse', tools: [] }] };

  test('flags extensions outside the target set', () => {
    expect(hasUnsupportedResponsesExtensions(namespaceBody, route(), 'responses')).toBe(true);
    expect(
      hasUnsupportedResponsesExtensions(
        namespaceBody,
        route({ oauth_provider: 'meta' }),
        'responses'
      )
    ).toBe(false);
    expect(
      hasUnsupportedResponsesExtensions(
        { tools: [{ type: 'custom', name: 'apply_patch' }] },
        route({ oauth_provider: 'meta' }),
        'responses'
      )
    ).toBe(true);
  });

  test('a provider can opt in to namespace pass-through', () => {
    expect(
      hasUnsupportedResponsesExtensions(
        namespaceBody,
        route({ responses_extensions: ['namespace_tools', 'namespaced_calls'] }),
        'responses'
      )
    ).toBe(false);
  });

  test('api.openai.com takes namespace-field history verbatim but flattens Muse dotted names', () => {
    const openai = route({ api_base_url: 'https://api.openai.com/v1' });
    const history = (call: Record<string, unknown>) => ({
      ...namespaceBody,
      input: [{ type: 'function_call', call_id: 'c1', arguments: '{}', ...call }],
    });
    expect(
      hasUnsupportedResponsesExtensions(
        history({ name: 'bash', namespace: 'muse' }),
        openai,
        'responses'
      )
    ).toBe(false);
    expect(
      hasUnsupportedResponsesExtensions(history({ name: 'muse.bash' }), openai, 'responses')
    ).toBe(true);
  });

  test('only applies to Responses targets', () => {
    expect(hasUnsupportedResponsesExtensions(namespaceBody, route(), 'chat')).toBe(false);
  });
});

test('LITE_ALLOWED_TOOL_TYPES matches the responses:lite wire contract', () => {
  expect(LITE_ALLOWED_TOOL_TYPES).toEqual(new Set(['function', 'custom', 'tool_search']));
});
