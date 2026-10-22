import { describe, expect, it, test } from 'bun:test';

import { ProviderConfigSchema } from '../../../config';
import { AnthropicTransformer } from '../../../transformers/anthropic';
import { OpenAITransformer } from '../../../transformers/openai';
import type { RouteResult } from '../../routing/router';
import { applyEagerToolInputStreaming, sendsToAnthropicApi } from '../eager-tool-streaming';
import { buildRequestPayload } from '../request-payload-builder';

// Claude buffers a client tool's whole input unless the tool opts into eager
// streaming, so a chat client asking for a large tool call sees a minute or
// more of silence. Chat clients cannot express the per-tool option, so a
// streaming chat -> Anthropic request opts in for them - and only toward
// Anthropic's own API, which is the one upstream known to accept the field.

const route = (config: Record<string, unknown>, provider = 'claude'): RouteResult => ({
  provider,
  model: 'claude-sonnet-5',
  config: ProviderConfigSchema.parse(config),
});
const apiKeyRoute = (api_base_url: unknown) => route({ api_base_url, api_key: 'test-key' });

describe('sendsToAnthropicApi', () => {
  test('Anthropic OAuth and the Claude-masking route always reach Anthropic', () => {
    const oauth = route({
      api_base_url: 'oauth://anthropic',
      oauth_provider: 'anthropic',
      oauth_account: 'default',
    });
    const masking = route({
      api_base_url: 'https://api.anthropic.com/v1',
      api_key: 'test-key',
      useClaudeMasking: true,
    });
    expect(sendsToAnthropicApi(oauth, 'messages')).toBe(true);
    expect(sendsToAnthropicApi(masking, 'messages')).toBe(true);
  });

  test('an API-key provider qualifies only on an anthropic.com host', () => {
    expect(sendsToAnthropicApi(apiKeyRoute('https://api.anthropic.com/v1'), 'messages')).toBe(true);
    for (const url of [
      'https://api.minimax.io/anthropic',
      'https://openrouter.ai/api/v1',
      // Lookalikes a substring match would accept.
      'https://api.anthropic.com.proxy.example/v1',
      'https://gateway.example.com/anthropic.com/v1',
      'https://notanthropic.com/v1',
    ]) {
      expect(sendsToAnthropicApi(apiKeyRoute(url), 'messages'), url).toBe(false);
    }
  });

  test('a per-API URL map is judged by the URL for the target API only', () => {
    const mixed = apiKeyRoute({
      chat: 'https://api.anthropic.com/v1',
      messages: 'https://llm-proxy.example.com/v1',
    });
    expect(sendsToAnthropicApi(mixed, 'messages')).toBe(false);
  });

  test('OAuth providers other than Anthropic and non-Messages targets never qualify', () => {
    const codex = route({
      api_base_url: 'oauth://openai-codex',
      oauth_provider: 'openai-codex',
      oauth_account: 'default',
    });
    expect(sendsToAnthropicApi(codex, 'responses')).toBe(false);
    expect(sendsToAnthropicApi(apiKeyRoute('https://api.anthropic.com/v1'), 'chat')).toBe(false);
  });
});

describe('applyEagerToolInputStreaming', () => {
  const anthropic = apiKeyRoute('https://api.anthropic.com/v1');
  const chatRequest = { incomingApiType: 'chat' } as any;
  const clientTool = (name: string, extra: Record<string, unknown> = {}) => ({
    name,
    input_schema: { type: 'object', properties: {} },
    ...extra,
  });
  const apply = (tools: any[]) =>
    applyEagerToolInputStreaming({ stream: true, tools }, chatRequest, anthropic, 'messages', false)
      .tools;

  test('opts client tools in, keeping explicit choices and server tools as they are', () => {
    const webSearch = { type: 'web_search_20250305', name: 'web_search', max_uses: 3 };
    const tools = apply([
      clientTool('create_page'),
      clientTool('search', { type: 'custom' }),
      clientTool('lookup', { eager_input_streaming: false }),
      webSearch,
    ]);
    expect(tools.map((t: any) => t.eager_input_streaming)).toEqual([true, true, false, undefined]);
    expect(tools[3]).toEqual(webSearch);
  });

  test('does not mutate the payload it was given', () => {
    const payload = { stream: true, tools: [clientTool('create_page')] };
    applyEagerToolInputStreaming(payload, chatRequest, anthropic, 'messages', false);
    expect(payload.tools[0]).not.toHaveProperty('eager_input_streaming');
  });

  test('leaves pass-through bodies alone', () => {
    const payload = { stream: true, tools: [clientTool('create_page')] };
    expect(applyEagerToolInputStreaming(payload, chatRequest, anthropic, 'messages', true)).toBe(
      payload
    );
  });
});

describe('buildRequestPayload for a chat client', () => {
  const chatBody = (stream: boolean) => ({
    model: 'claude-sonnet-5',
    stream,
    messages: [{ role: 'user', content: 'Write the homepage.' }],
    tools: [
      {
        type: 'function',
        function: {
          name: 'create_page',
          description: 'Create a WordPress page.',
          parameters: { type: 'object', properties: { content: { type: 'string' } } },
        },
      },
    ],
  });

  async function chatPayload(api_base_url: string, stream: boolean) {
    const body = chatBody(stream);
    const request = await new OpenAITransformer().parseRequest(body);
    request.incomingApiType = 'chat';
    request.originalBody = body;
    const { payload } = await buildRequestPayload(
      request,
      apiKeyRoute(api_base_url),
      new AnthropicTransformer(),
      'messages'
    );
    return payload;
  }

  test('streaming to Anthropic opts the tools in', async () => {
    const payload = await chatPayload('https://api.anthropic.com/v1', true);
    expect(payload.tools[0].eager_input_streaming).toBe(true);
  });

  test('non-streaming requests are left alone', async () => {
    const payload = await chatPayload('https://api.anthropic.com/v1', false);
    expect(payload.tools[0]).not.toHaveProperty('eager_input_streaming');
  });

  test('other Messages-compatible upstreams are left alone', async () => {
    const payload = await chatPayload('https://llm-proxy.example.com/v1', true);
    expect(payload.tools[0]).not.toHaveProperty('eager_input_streaming');
  });

  test("a Messages client's own tool options pass through untouched", async () => {
    const body = {
      model: 'claude-sonnet-5',
      max_tokens: 1024,
      stream: true,
      messages: [{ role: 'user', content: 'Write the homepage.' }],
      tools: [
        {
          name: 'create_page',
          description: 'Create a WordPress page.',
          input_schema: { type: 'object', properties: {} },
        },
      ],
    };
    const transformer = new AnthropicTransformer();
    const request = await transformer.parseRequest(body);
    request.incomingApiType = 'messages';
    request.originalBody = body;
    const { payload } = await buildRequestPayload(
      request,
      apiKeyRoute('https://api.anthropic.com/v1'),
      transformer,
      'messages'
    );
    expect(payload.tools[0]).not.toHaveProperty('eager_input_streaming');
  });
});
