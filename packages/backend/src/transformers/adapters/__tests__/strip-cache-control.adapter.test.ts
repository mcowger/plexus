import { describe, expect, it } from 'bun:test';

import { resolveAdapters } from '../../../services/dispatch/adapter-resolver';
import type { RouteResult } from '../../../services/routing/router';
import { buildAnthropicRequest } from '../../anthropic/request-builder';
import { parseAnthropicRequest } from '../../anthropic/request-parser';
import { OpenAITransformer } from '../../openai';
import { stripCacheControlAdapter } from '../strip-cache-control.adapter';

const ephemeral = { type: 'ephemeral' };

const ANTHROPIC_REQUEST = {
  model: 'plan',
  max_tokens: 1024,
  system: [{ type: 'text', text: 'You are helpful.', cache_control: ephemeral }],
  messages: [
    {
      role: 'user',
      content: [{ type: 'text', text: 'Hello', cache_control: ephemeral }],
    },
  ],
  tools: [
    {
      name: 'get_time',
      description: 'time',
      input_schema: { type: 'object', properties: { cache_control: { type: 'string' } } },
      cache_control: ephemeral,
    },
  ],
};

const route = (api_base_url: string): RouteResult =>
  ({ provider: 'p', model: 'm', config: { api_base_url, enabled: true } }) as any;

const run = (payload: Record<string, any>) => stripCacheControlAdapter.preDispatch(payload);

describe('strip_cache_control: chat completions target', () => {
  it('removes every cache_control marker from the payload built for a chat wire', async () => {
    const unified = await parseAnthropicRequest(ANTHROPIC_REQUEST);
    const built = await new OpenAITransformer().transformRequest({
      ...unified,
      incomingApiType: 'messages',
      originalBody: ANTHROPIC_REQUEST,
    } as any);
    // Guard: the unstripped payload really carries the marker Mistral rejects.
    expect(JSON.stringify(built)).toContain('ephemeral');

    const stripped = run(built);
    expect(JSON.stringify(stripped)).not.toContain('ephemeral');
    expect(stripped.messages.some((m: any) => m.role === 'system')).toBe(true);
  });

  it('keeps a tool parameter that happens to be named cache_control', () => {
    const out = run({
      tools: [
        {
          type: 'function',
          function: {
            name: 'f',
            parameters: { type: 'object', properties: { cache_control: { type: 'string' } } },
            cache_control: ephemeral,
          },
          cache_control: ephemeral,
        },
      ],
    });
    expect(out.tools[0].cache_control).toBeUndefined();
    expect(out.tools[0].function.cache_control).toBeUndefined();
    expect(out.tools[0].function.parameters.properties.cache_control).toEqual({ type: 'string' });
  });

  it('strips nested tool_result content and does not mutate the input', () => {
    const payload = {
      cache_control: ephemeral,
      system: [{ type: 'text', text: 's', cache_control: ephemeral }],
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              content: [{ type: 'text', text: 'x', cache_control: ephemeral }],
            },
          ],
        },
      ],
    };
    const snapshot = JSON.stringify(payload);
    const out = run(payload);
    expect(JSON.stringify(out)).not.toContain('cache_control');
    expect(JSON.stringify(payload)).toBe(snapshot);
  });

  it('returns the same reference when there is nothing to strip', () => {
    const payload = { messages: [{ role: 'user', content: [{ type: 'text', text: 'a' }] }] };
    expect(run(payload)).toBe(payload);
  });
});

describe('strip_cache_control: injection is per target wire', () => {
  const names = (apiType?: string) =>
    resolveAdapters(route('https://api.mistral.ai'), apiType).map((r) => r.adapter.name);

  it('is injected for non-messages wires', () => {
    for (const apiType of ['chat', 'completions', 'ollama']) {
      expect(names(apiType)).toContain('strip_cache_control');
    }
  });

  it('is not injected for OpenRouter chat routes, which forward the marker to Claude', () => {
    const r = route('https://openrouter.ai/api/v1');
    (r.config as any).pi_ai_provider = 'openrouter';
    expect(resolveAdapters(r, 'chat').map((x) => x.adapter.name)).not.toContain(
      'strip_cache_control'
    );
  });

  it('is not injected for the messages wire (Claude keeps its cache markers)', () => {
    expect(names('messages')).not.toContain('strip_cache_control');
    expect(names('messages:foo')).not.toContain('strip_cache_control');
    expect(names('responses')).not.toContain('strip_cache_control');
    expect(names()).not.toContain('strip_cache_control');
  });

  it('can be opted out with a disabled adapter entry', () => {
    const r = route('https://api.mistral.ai');
    (r.config as any).adapter = [{ name: 'strip_cache_control', enabled: false }];
    expect(resolveAdapters(r, 'chat').map((x) => x.adapter.name)).not.toContain(
      'strip_cache_control'
    );
  });

  it('messages target: markers survive the Anthropic request builder untouched', async () => {
    const unified = await parseAnthropicRequest(ANTHROPIC_REQUEST);
    const built = await buildAnthropicRequest({
      ...unified,
      incomingApiType: 'messages',
      originalBody: ANTHROPIC_REQUEST,
    } as any);
    expect(built.system[0].cache_control).toEqual(ephemeral);
    expect(built.messages[0].content[0].cache_control).toEqual(ephemeral);
  });
});
