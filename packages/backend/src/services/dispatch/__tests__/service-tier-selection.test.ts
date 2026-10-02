import { describe, expect, test } from 'vitest';
import { ProviderConfigSchema, setConfigForTesting } from '../../../config';
import { AnthropicTransformer } from '../../../transformers/anthropic';
import { OpenAITransformer } from '../../../transformers/openai';
import type { UnifiedChatRequest } from '../../../types/unified';
import type { RouteResult } from '../../routing/router';
import { buildRequestPayload, applyAutoAnthropicBetas } from '../request-payload-builder';
import { setupProviderHeaders } from '../../providers/provider-request-headers';
import {
  applyServiceTierSelection,
  normalizeServiceTier,
  resolveServiceTier,
} from '../service-tier-selection';

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

  test.each([
    ['standard', 'default'],
    ['ultrafast', 'priority'],
    ['default', 'default'],
    ['priority', 'priority'],
    ['fast', 'fast'],
    ['flex', 'flex'],
  ])('normalizes the legacy %s suffix to the OpenAI %s wire value', (tier, expected) => {
    expect(
      applyServiceTierSelection({ model: 'm' }, request({ serviceTier: tier }), 'chat')
    ).toEqual({ model: 'm', service_tier: expected });
  });

  test('leaves the request serviceTier canonical so a map can still see ultrafast', () => {
    const parsed = request({ serviceTier: 'ultrafast' });
    applyServiceTierSelection({ model: 'm' }, parsed, 'chat');
    expect(parsed.serviceTier).toBe('ultrafast');
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

describe('applyServiceTierSelection — per-key default tier', () => {
  const withDefault = (tier: string, overrides: Partial<UnifiedChatRequest> = {}) =>
    request({
      metadata: { plexus_metadata: { defaultServiceTier: tier } } as UnifiedChatRequest['metadata'],
      ...overrides,
    });

  test.each(['chat', 'responses', 'responses:lite'])(
    'applies the key default on %s when the client requested no tier',
    (apiType) => {
      expect(applyServiceTierSelection({ model: 'm' }, withDefault('flex'), apiType)).toEqual({
        model: 'm',
        service_tier: 'flex',
      });
    }
  );

  test('normalizes a standard key default to the OpenAI wire value', () => {
    expect(applyServiceTierSelection({ model: 'm' }, withDefault('standard'), 'chat')).toEqual({
      model: 'm',
      service_tier: 'default',
    });
  });

  test('an explicit @tier suffix beats the key default', () => {
    const out = applyServiceTierSelection(
      { model: 'm' },
      withDefault('priority', { serviceTier: 'flex' }),
      'chat'
    );

    expect(out.service_tier).toBe('flex');
  });

  test('an explicit body service_tier beats the key default and is left untouched', () => {
    const payload = { model: 'm', service_tier: 'flex' };

    expect(applyServiceTierSelection(payload, withDefault('priority'), 'chat')).toBe(payload);
  });

  test('an explicit originalBody service_tier (cross-format) beats the key default', () => {
    const payload = { model: 'm' };

    expect(
      applyServiceTierSelection(
        payload,
        withDefault('priority', { originalBody: { service_tier: 'flex' } }),
        'chat'
      )
    ).toBe(payload);
  });

  test('an explicit originalBody speed (cross-format) beats the key default', () => {
    const payload = { model: 'm' };

    expect(
      applyServiceTierSelection(
        payload,
        withDefault('priority', { originalBody: { speed: 'fast' } }),
        'chat'
      )
    ).toBe(payload);
  });

  test('does not apply the key default to messages or gemini bodies', () => {
    for (const apiType of ['messages', 'gemini']) {
      const payload = { model: 'm' };

      expect(applyServiceTierSelection(payload, withDefault('flex'), apiType)).toBe(payload);
    }
  });

  test('never mutates originalBody', () => {
    const originalBody = { model: 'm', messages: [] };

    applyServiceTierSelection({ model: 'm' }, withDefault('flex', { originalBody }), 'chat');

    expect(originalBody).toEqual({ model: 'm', messages: [] });
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

  const anthropicOverlay = (extraBody?: Record<string, unknown>) => ({
    api_base_url: { messages: 'https://api.anthropic.com/v1' },
    api_key: 'test-key',
    auto_compat: true,
    pi_ai_quirks: {
      messages: { api: 'anthropic-messages', serviceTierMap: { priority: 'fast' } },
    },
    ...(extraBody ? { extraBody } : {}),
  });

  test('mapped Anthropic priority adds speed fast and the fast-mode beta', async () => {
    const parsed = request({
      model: 'claude-x',
      incomingApiType: 'messages',
      serviceTier: 'priority',
      originalBody: {
        model: 'claude-x',
        max_tokens: 100,
        messages: [{ role: 'user', content: 'hi' }],
      },
    });
    parsed.anthropicBeta = undefined;

    const routeConfig = route(anthropicOverlay());
    const { payload } = await buildRequestPayload(
      parsed,
      routeConfig,
      new AnthropicTransformer(),
      'messages'
    );

    expect(payload.speed).toBe('fast');
    // The auto beta is derived from the final payload at fetch time, not
    // persisted onto the shared request.
    expect(parsed.anthropicBeta).toBeUndefined();
    const headers = setupProviderHeaders(routeConfig, 'messages', parsed);
    applyAutoAnthropicBetas(headers, payload, 'messages');
    expect(headers['anthropic-beta']).toContain('fast-mode-2026-02-01');
  });

  test('an extraBody speed:standard override leaves no fast-mode beta behind', async () => {
    const parsed = request({
      model: 'claude-x',
      incomingApiType: 'messages',
      serviceTier: 'priority',
      originalBody: {
        model: 'claude-x',
        max_tokens: 100,
        messages: [{ role: 'user', content: 'hi' }],
      },
    });
    parsed.anthropicBeta = undefined;

    const routeConfig = route(anthropicOverlay({ speed: 'standard' }));
    const { payload } = await buildRequestPayload(
      parsed,
      routeConfig,
      new AnthropicTransformer(),
      'messages'
    );

    expect(payload.speed).toBe('standard');
    const headers = setupProviderHeaders(routeConfig, 'messages', parsed);
    applyAutoAnthropicBetas(headers, payload, 'messages');
    expect(headers['anthropic-beta'] ?? '').not.toContain('fast-mode-2026-02-01');
  });

  test('fast-mode beta merges into an existing differently-cased header', () => {
    const headers: Record<string, string> = { 'Anthropic-Beta': 'client-beta' };

    applyAutoAnthropicBetas(headers, { speed: 'fast' }, 'messages');

    expect(headers['Anthropic-Beta']).toBe('client-beta,fast-mode-2026-02-01');
    expect(
      Object.keys(headers).filter((key) => key.toLowerCase() === 'anthropic-beta')
    ).toHaveLength(1);
  });
});

describe('normalizeServiceTier', () => {
  test.each([
    ['auto', 'auto'],
    ['default', 'standard'],
    ['on_demand', 'standard'],
    ['standard_only', 'standard'],
    ['standard', 'standard'],
    ['flex', 'flex'],
    ['FLEX', 'flex'],
    ['fast', 'priority'],
    ['priority', 'priority'],
    ['ultrafast', 'ultrafast'],
  ])('normalizes %s to %s', (raw, expected) => {
    expect(normalizeServiceTier(raw)).toBe(expected);
  });

  test('returns undefined for a provider-specific value', () => {
    expect(normalizeServiceTier('scale')).toBeUndefined();
    expect(normalizeServiceTier(undefined)).toBeUndefined();
  });
});

describe('resolveServiceTier', () => {
  const openAiMap = {
    auto: 'auto',
    standard: 'default',
    flex: 'flex',
    priority: 'priority',
    ultrafast: 'ultrafast',
  };

  test('emits nothing when there is no tier intent', () => {
    expect(resolveServiceTier(undefined, openAiMap, 'service-tier')).toBeUndefined();
  });

  test('maps a supported tier to its native value', () => {
    expect(resolveServiceTier('flex', openAiMap, 'service-tier')).toEqual({ value: 'flex' });
    expect(resolveServiceTier('fast', openAiMap, 'service-tier')).toEqual({ value: 'priority' });
    expect(resolveServiceTier('on_demand', openAiMap, 'service-tier')).toEqual({
      value: 'default',
    });
  });

  test('falls back to the nearest same-idea tier', () => {
    const map = { standard: 'default' };
    expect(resolveServiceTier('ultrafast', map, 'service-tier')).toEqual({ value: 'default' });
    expect(resolveServiceTier('priority', map, 'service-tier')).toEqual({ value: 'default' });
    expect(resolveServiceTier('flex', map, 'service-tier')).toEqual({ value: 'default' });
  });

  test('an explicit null tier is unsupported and falls through', () => {
    const map = { standard: null, priority: null as string | null };
    expect(resolveServiceTier('priority', map, 'service-tier')).toEqual({});
  });

  test('preserves a provider-specific value for service-tier, omits it for anthropic-speed', () => {
    expect(resolveServiceTier('scale', {}, 'service-tier')).toEqual({ value: 'scale' });
    expect(resolveServiceTier('scale', {}, 'anthropic-speed')).toEqual({});
  });

  test('anthropic-speed writes only fast/standard and omits auto', () => {
    const map = { auto: 'auto', standard: 'standard', priority: 'fast' };
    expect(resolveServiceTier('priority', map, 'anthropic-speed')).toEqual({ value: 'fast' });
    expect(resolveServiceTier('flex', map, 'anthropic-speed')).toEqual({ value: 'standard' });
    expect(resolveServiceTier('auto', map, 'anthropic-speed')).toEqual({});
  });
});
