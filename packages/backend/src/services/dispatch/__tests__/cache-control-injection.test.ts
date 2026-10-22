import { afterEach, describe, expect, it } from 'bun:test';

import { getConfig, ProviderConfigSchema, setConfigForTesting } from '../../../config';
import { AnthropicTransformer } from '../../../transformers/anthropic';
import { OpenAITransformer } from '../../../transformers/openai';
import type { RouteResult } from '../../routing/router';
import { buildRequestPayload } from '../request-payload-builder';

const EPHEMERAL = { type: 'ephemeral' };

// Every test installs its own alias config. Restore the preload's baseline so
// those aliases can't leak into later files during a shared (non-parallel) run.
const baselineConfig = getConfig();
afterEach(() => setConfigForTesting(baselineConfig));

const route = (apiBaseUrl: string, canonicalModel?: string): RouteResult => ({
  provider: 'claude',
  model: 'claude-sonnet-5',
  canonicalModel,
  config: ProviderConfigSchema.parse({ api_base_url: apiBaseUrl, api_key: 'test-key' }),
});

/** Installs a config whose only alias is `claude-alias`. */
function setAlias(advanced?: unknown[]) {
  setConfigForTesting({
    providers: {},
    models: {
      'claude-alias': {
        target_groups: [],
        ...(advanced ? { advanced } : {}),
      },
    },
    keys: {},
  } as any);
}

const chatBody = () => ({
  model: 'claude-alias',
  messages: [
    { role: 'system', content: 'You are a coding agent.' },
    { role: 'user', content: 'first' },
    { role: 'assistant', content: 'reply' },
    { role: 'user', content: 'second' },
  ],
  tools: [
    {
      type: 'function',
      function: {
        name: 'Read',
        description: 'Read a file',
        parameters: { type: 'object', properties: {} },
      },
    },
  ],
});

async function chatPayload(apiBaseUrl: string) {
  const body = chatBody();
  const request = await new OpenAITransformer().parseRequest(body);
  request.incomingApiType = 'chat';
  request.originalBody = body;
  const { payload, bypassTransformation } = await buildRequestPayload(
    request,
    route(apiBaseUrl, 'claude-alias'),
    new AnthropicTransformer(),
    'messages'
  );
  expect(bypassTransformation).toBe(false);
  return payload;
}

const lastBlock = (payload: any, messageIndex: number) =>
  payload.messages.at(messageIndex).content.at(-1);

describe('inject_cache_control through buildRequestPayload', () => {
  it('auto-enables for a chat client routed to Anthropic-owned targets', async () => {
    setAlias();

    const payload = await chatPayload('https://api.anthropic.com/v1');

    expect(payload.tools.at(-1).cache_control).toEqual(EPHEMERAL);
    expect(payload.system.at(-1).cache_control).toEqual(EPHEMERAL);
    expect(lastBlock(payload, -1).cache_control).toEqual(EPHEMERAL);
    expect(lastBlock(payload, -2).cache_control).toEqual(EPHEMERAL);
  });

  it('stays off for Messages-compatible upstreams that are not Anthropic', async () => {
    setAlias();

    const payload = await chatPayload('https://llm-proxy.example.com/v1');

    expect(payload.tools.at(-1)).not.toHaveProperty('cache_control');
    expect(lastBlock(payload, -1)).not.toHaveProperty('cache_control');
  });

  it('lets an alias opt in on any Messages-compatible upstream', async () => {
    setAlias([{ type: 'inject_cache_control' }]);

    const payload = await chatPayload('https://llm-proxy.example.com/v1');

    expect(payload.tools.at(-1).cache_control).toEqual(EPHEMERAL);
    expect(lastBlock(payload, -1).cache_control).toEqual(EPHEMERAL);
  });

  it('lets an alias opt out on an Anthropic-owned target', async () => {
    setAlias([{ type: 'inject_cache_control', enabled: false }]);

    const payload = await chatPayload('https://api.anthropic.com/v1');

    expect(payload.tools.at(-1)).not.toHaveProperty('cache_control');
    expect(payload.system).toBe('You are a coding agent.');
  });

  it('carries the configured ttl and trailing depth to the wire', async () => {
    setAlias([{ type: 'inject_cache_control', ttl: '1h', message_breakpoints: 1 }]);

    const payload = await chatPayload('https://api.anthropic.com/v1');

    expect(payload.tools.at(-1).cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
    expect(lastBlock(payload, -1).cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
    expect(lastBlock(payload, -2)).not.toHaveProperty('cache_control');
  });

  it('leaves a native Messages client body untouched', async () => {
    setAlias();

    const body = {
      model: 'claude-alias',
      max_tokens: 1024,
      system: 'You are a coding agent.',
      messages: [{ role: 'user', content: 'hello' }],
      tools: [{ name: 'Read', description: 'Read a file', input_schema: { type: 'object' } }],
    };
    const transformer = new AnthropicTransformer();
    const request = await transformer.parseRequest(body);
    request.incomingApiType = 'messages';
    request.originalBody = body;

    const { payload, bypassTransformation } = await buildRequestPayload(
      request,
      route('https://api.anthropic.com/v1', 'claude-alias'),
      transformer,
      'messages'
    );

    expect(bypassTransformation).toBe(true);
    expect(payload.tools.at(-1)).not.toHaveProperty('cache_control');
    expect(payload.system).toBe('You are a coding agent.');
    expect(payload.messages.at(-1).content).toBe('hello');
  });
});
