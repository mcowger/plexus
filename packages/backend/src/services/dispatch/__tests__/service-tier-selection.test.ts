import { describe, expect, test } from 'vitest';
import { ProviderConfigSchema, setConfigForTesting } from '../../../config';
import { AnthropicTransformer } from '../../../transformers/anthropic';
import { OpenAITransformer } from '../../../transformers/openai';
import type { UnifiedChatRequest } from '../../../types/unified';
import type { RouteResult } from '../../routing/router';
import { buildRequestPayload } from '../request-payload-builder';
import { applyServiceTierSelection } from '../service-tier-selection';

const request = (overrides: Partial<UnifiedChatRequest> = {}) =>
  ({ model: 'gpt-6-luna', messages: [], ...overrides }) as UnifiedChatRequest;

describe('applyServiceTierSelection', () => {
  test.each(['chat', 'responses', 'responses:lite'])(
    'sets service_tier on %s bodies',
    (apiType) => {
      expect(
        applyServiceTierSelection({ model: 'm' }, request({ serviceTier: 'flex' }), apiType)
      ).toEqual({
        model: 'm',
        service_tier: 'flex',
      });
    }
  );

  test('replaces a service_tier already in the body', () => {
    expect(
      applyServiceTierSelection(
        { model: 'm', service_tier: 'default' },
        request({ serviceTier: 'priority' }),
        'chat'
      )
    ).toEqual({ model: 'm', service_tier: 'priority' });
  });

  test.each(['messages', 'gemini'])('leaves %s bodies alone', (apiType) => {
    const payload = { model: 'm' };
    expect(applyServiceTierSelection(payload, request({ serviceTier: 'flex' }), apiType)).toBe(
      payload
    );
  });

  test('does nothing when no tier was selected', () => {
    const payload = { model: 'm', service_tier: 'default' };
    expect(applyServiceTierSelection(payload, request(), 'chat')).toBe(payload);
  });

  test('does not mutate the body it is given', () => {
    const payload = { model: 'm' };
    applyServiceTierSelection(payload, request({ serviceTier: 'flex' }), 'chat');
    expect(payload).toEqual({ model: 'm' });
  });
});

describe('buildRequestPayload with a selected tier', () => {
  const route = (config: Record<string, unknown> = {}, canonicalModel?: string): RouteResult => ({
    provider: 'openai',
    model: 'gpt-6-luna',
    canonicalModel,
    config: ProviderConfigSchema.parse({
      api_base_url: 'https://api.openai.com/v1',
      api_key: 'test-key',
      ...config,
    }),
  });

  const clientBody = {
    model: 'gpt-6-luna@flex',
    messages: [{ role: 'user', content: 'hi' }],
    service_tier: 'default',
  };

  /** A chat client's request as the dispatcher hands it to the payload builder. */
  async function chatRequest(options: { passThrough: boolean }) {
    const parsed = await new OpenAITransformer().parseRequest(clientBody);
    parsed.model = 'gpt-6-luna';
    parsed.incomingApiType = 'chat';
    parsed.serviceTier = 'flex';
    if (options.passThrough) parsed.originalBody = clientBody;
    return parsed;
  }

  test('a same-format pass-through body takes the selected tier over the client tier', async () => {
    const { payload, bypassTransformation } = await buildRequestPayload(
      await chatRequest({ passThrough: true }),
      route(),
      new OpenAITransformer(),
      'chat'
    );

    expect(bypassTransformation).toBe(true);
    expect(payload.service_tier).toBe('flex');
    expect(payload.model).toBe('gpt-6-luna');
  });

  test('a transformed body carries the selected tier', async () => {
    const { payload, bypassTransformation } = await buildRequestPayload(
      await chatRequest({ passThrough: false }),
      route(),
      new OpenAITransformer(),
      'chat'
    );

    expect(bypassTransformation).toBe(false);
    expect(payload.service_tier).toBe('flex');
  });

  test('provider extraBody still wins over the selected tier', async () => {
    const { payload } = await buildRequestPayload(
      await chatRequest({ passThrough: true }),
      route({ extraBody: { service_tier: 'default' } }),
      new OpenAITransformer(),
      'chat'
    );

    expect(payload.service_tier).toBe('default');
  });

  test('alias extraBody still wins over the selected tier', async () => {
    setConfigForTesting({
      providers: {},
      models: { 'gpt-6-luna': { extraBody: { service_tier: 'priority' }, target_groups: [] } },
      keys: {},
    } as any);

    const { payload } = await buildRequestPayload(
      await chatRequest({ passThrough: true }),
      route({}, 'gpt-6-luna'),
      new OpenAITransformer(),
      'chat'
    );

    expect(payload.service_tier).toBe('priority');
  });

  test('a Messages target gets no service_tier', async () => {
    const { payload } = await buildRequestPayload(
      await chatRequest({ passThrough: false }),
      route({ api_base_url: 'https://api.anthropic.com/v1' }),
      new AnthropicTransformer(),
      'messages'
    );

    expect(payload).not.toHaveProperty('service_tier');
  });
});
