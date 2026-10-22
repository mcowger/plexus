import { describe, expect, test } from 'bun:test';

import {
  applyRequestedServiceTierFromError,
  extractActualServiceTier,
  extractActualServiceTierFromBody,
  extractActualServiceTierFromHeaders,
  extractRequestedServiceTier,
  normalizeServiceTier,
} from '../service-tier-metadata';

describe('normalizeServiceTier', () => {
  test('collapses all default aliases to default', () => {
    for (const value of ['on_demand', 'ON_DEMAND', 'ondemand', 'standard', 'standard_only']) {
      expect(normalizeServiceTier(value)).toBe('default');
    }
  });

  test('maps fast and priority spellings to priority', () => {
    for (const value of ['fast', 'priority', 'PRIORITY', 'ON_DEMAND_PRIORITY']) {
      expect(normalizeServiceTier(value)).toBe('priority');
    }
  });

  test('maps flex spellings to flex', () => {
    for (const value of ['flex', 'FLEX', 'ON_DEMAND_FLEX']) {
      expect(normalizeServiceTier(value)).toBe('flex');
    }
  });

  test('keeps recognized distinct tiers distinct', () => {
    for (const value of ['auto', 'performance', 'ultrafast', 'scale', 'reserved', 'deferred']) {
      expect(normalizeServiceTier(value)).toBe(value);
    }
  });

  test('preserves unknown values verbatim', () => {
    expect(normalizeServiceTier('turbo')).toBe('turbo');
  });

  test('returns null for nullish and empty values', () => {
    expect(normalizeServiceTier(null)).toBeNull();
    expect(normalizeServiceTier(undefined)).toBeNull();
    expect(normalizeServiceTier('')).toBeNull();
    expect(normalizeServiceTier('   ')).toBeNull();
  });
});

describe('extractRequestedServiceTier', () => {
  test('reads an OpenAI service_tier body field', () => {
    expect(extractRequestedServiceTier({ service_tier: 'flex' }, {}, 'chat')).toEqual({
      tier: 'flex',
      raw: 'flex',
    });
  });

  test('reads Anthropic messages fast-mode speed', () => {
    expect(extractRequestedServiceTier({ speed: 'fast' }, {}, 'messages')).toEqual({
      tier: 'priority',
      raw: 'fast',
    });
  });

  test('reads an Anthropic messages service_tier when speed is absent', () => {
    expect(extractRequestedServiceTier({ service_tier: 'auto' }, {}, 'messages')).toEqual({
      tier: 'auto',
      raw: 'auto',
    });
  });

  test('a non-fast speed does not mask a service_tier', () => {
    expect(
      extractRequestedServiceTier({ speed: 'standard', service_tier: 'priority' }, {}, 'messages')
    ).toEqual({ tier: 'priority', raw: 'priority' });
    expect(extractRequestedServiceTier({ speed: 'standard' }, {}, 'messages').raw).toBeNull();
  });

  test('resolves an api subtype to its base type before the messages speed check', () => {
    expect(extractRequestedServiceTier({ speed: 'fast' }, {}, 'messages:beta')).toEqual({
      tier: 'priority',
      raw: 'fast',
    });
  });

  test('ignores a numeric speed (TTS) even on messages', () => {
    expect(extractRequestedServiceTier({ speed: 1.5 }, {}, 'messages').raw).toBeNull();
  });

  test('reads Bedrock nested serviceTier.type', () => {
    expect(extractRequestedServiceTier({ serviceTier: { type: 'reserved' } }, {}, 'chat')).toEqual({
      tier: 'reserved',
      raw: 'reserved',
    });
  });

  test('an empty camelCase serviceTier falls through to service_tier and the Vertex header', () => {
    expect(
      extractRequestedServiceTier({ serviceTier: '', service_tier: 'flex' }, {}, 'chat')
    ).toEqual({ tier: 'flex', raw: 'flex' });
    expect(
      extractRequestedServiceTier(
        { serviceTier: '   ' },
        { 'X-Vertex-AI-LLM-Shared-Request-Type': 'priority' },
        'gemini'
      )
    ).toEqual({ tier: 'priority', raw: 'priority' });
  });

  test('reads a Gemini service_tier body field', () => {
    expect(extractRequestedServiceTier({ service_tier: 'priority' }, {}, 'gemini').tier).toBe(
      'priority'
    );
  });

  test('prefers the Vertex header over an ignored body service_tier', () => {
    expect(
      extractRequestedServiceTier(
        { service_tier: 'flex' },
        { 'X-Vertex-AI-LLM-Shared-Request-Type': 'priority' },
        'gemini'
      )
    ).toEqual({ tier: 'priority', raw: 'priority' });
  });

  test('reports null when no requested tier is present', () => {
    expect(extractRequestedServiceTier({}, {}, 'chat')).toEqual({
      tier: null,
      raw: null,
    });
  });
});

describe('extractActualServiceTier', () => {
  test('reads an OpenAI response service_tier', () => {
    expect(extractActualServiceTierFromBody({ service_tier: 'scale' })).toEqual({
      tier: 'scale',
      raw: 'scale',
    });
  });

  test('Anthropic fast-mode usage.speed wins over usage.service_tier standard', () => {
    expect(
      extractActualServiceTierFromBody({
        usage: { speed: 'fast', service_tier: 'standard' },
      })
    ).toEqual({ tier: 'priority', raw: 'fast' });
  });

  test('reads Anthropic usage.service_tier when speed is absent', () => {
    expect(extractActualServiceTierFromBody({ usage: { service_tier: 'priority' } })).toEqual({
      tier: 'priority',
      raw: 'priority',
    });
  });

  test('standard speed does not mask an actual priority service tier', () => {
    expect(
      extractActualServiceTierFromBody({
        usage: { speed: 'standard', service_tier: 'priority' },
      })
    ).toEqual({ tier: 'priority', raw: 'priority' });
    expect(extractActualServiceTierFromBody({ usage: { speed: 'standard' } })).toEqual({
      tier: 'default',
      raw: 'standard',
    });
  });

  test('reads Vertex usageMetadata.trafficType', () => {
    expect(
      extractActualServiceTierFromBody({
        usageMetadata: { trafficType: 'ON_DEMAND_FLEX' },
      })
    ).toEqual({ tier: 'flex', raw: 'ON_DEMAND_FLEX' });
  });

  test('an empty camelCase serviceTier permits later candidate and top-level fallback', () => {
    expect(extractActualServiceTierFromBody({ serviceTier: '', service_tier: 'flex' })).toEqual({
      tier: 'flex',
      raw: 'flex',
    });
    expect(
      extractActualServiceTierFromBody({
        serviceTier: '',
        metadata: { serviceTier: { type: 'priority' } },
      })
    ).toEqual({ tier: 'priority', raw: 'priority' });
    expect(
      extractActualServiceTierFromBody({
        serviceTier: '  ',
        usage: { serviceTier: { type: 'reserved' } },
      })
    ).toEqual({ tier: 'reserved', raw: 'reserved' });
  });

  test('reads Bedrock top-level serviceTier.type', () => {
    expect(extractActualServiceTierFromBody({ serviceTier: { type: 'default' } })).toEqual({
      tier: 'default',
      raw: 'default',
    });
  });

  test('reads Bedrock ConverseStream metadata.serviceTier.type', () => {
    expect(
      extractActualServiceTierFromBody({
        metadata: { serviceTier: { type: 'priority' } },
      })
    ).toEqual({ tier: 'priority', raw: 'priority' });
  });

  test('unwraps an Anthropic message_start event envelope', () => {
    expect(
      extractActualServiceTierFromBody({
        type: 'message_start',
        message: { usage: { speed: 'fast' } },
      })
    ).toEqual({ tier: 'priority', raw: 'fast' });
  });

  test('unwraps an OpenAI Responses response.completed event envelope', () => {
    expect(
      extractActualServiceTierFromBody({
        type: 'response.completed',
        response: { service_tier: 'flex' },
      })
    ).toEqual({ tier: 'flex', raw: 'flex' });
  });

  test('Gemini header is authoritative over a competing body field', () => {
    expect(
      extractActualServiceTier(
        { service_tier: 'flex' },
        { 'x-gemini-service-tier': 'standard' },
        'gemini'
      )
    ).toEqual({ tier: 'default', raw: 'standard' });
  });

  test('Gemini header is used when the body reports nothing', () => {
    expect(extractActualServiceTier({}, { 'x-gemini-service-tier': 'priority' }, 'gemini')).toEqual(
      { tier: 'priority', raw: 'priority' }
    );
  });

  test('Gemini header authority also applies under an api subtype', () => {
    expect(
      extractActualServiceTier(
        { service_tier: 'flex' },
        { 'x-gemini-service-tier': 'standard' },
        'gemini:interactions'
      )
    ).toEqual({ tier: 'default', raw: 'standard' });
  });

  test('Responses echoes are ignored until a terminal status', () => {
    for (const status of ['in_progress', 'queued', 'cancelled']) {
      expect(
        extractActualServiceTierFromBody(
          {
            type: 'response.in_progress',
            response: { status, service_tier: 'auto' },
          },
          'responses'
        ).raw
      ).toBeNull();
      expect(
        extractActualServiceTierFromBody({ status, service_tier: 'auto' }, 'responses').raw
      ).toBeNull();
    }
  });

  test('Responses terminal statuses report the actual tier', () => {
    for (const status of ['completed', 'failed', 'incomplete']) {
      expect(
        extractActualServiceTierFromBody(
          {
            type: 'response.completed',
            response: { status, service_tier: 'priority' },
          },
          'responses'
        )
      ).toEqual({ tier: 'priority', raw: 'priority' });
    }
  });

  test('a Responses body without a status is left alone', () => {
    expect(extractActualServiceTierFromBody({ service_tier: 'flex' }, 'responses')).toEqual({
      tier: 'flex',
      raw: 'flex',
    });
  });

  test('reads a Bedrock Converse actual tier under its observed api type', () => {
    expect(
      extractActualServiceTierFromBody({ serviceTier: { type: 'priority' } }, 'bedrock-converse')
    ).toEqual({ tier: 'priority', raw: 'priority' });
  });

  test('applyRequestedServiceTierFromError copies only a captured requested tier', () => {
    const record: {
      requestedServiceTier?: string | null;
      requestedServiceTierRaw?: string | null;
    } = {};
    applyRequestedServiceTierFromError(record, {
      routingContext: {
        requestedServiceTier: 'priority',
        requestedServiceTierRaw: 'fast',
      },
    });
    expect(record).toEqual({
      requestedServiceTier: 'priority',
      requestedServiceTierRaw: 'fast',
    });

    const untouched: {
      requestedServiceTier?: string | null;
      requestedServiceTierRaw?: string | null;
    } = { requestedServiceTier: 'flex', requestedServiceTierRaw: 'flex' };
    applyRequestedServiceTierFromError(untouched, {
      routingContext: { statusCode: 500 },
    });
    expect(untouched).toEqual({
      requestedServiceTier: 'flex',
      requestedServiceTierRaw: 'flex',
    });
  });

  test('header is ignored when no header helper is relevant', () => {
    expect(
      extractActualServiceTierFromHeaders({
        'x-gemini-service-tier': 'priority',
      })
    ).toEqual({
      tier: 'priority',
      raw: 'priority',
    });
  });

  test('never infers actual from the requested tier', () => {
    // A request with a tier but a response that reports none yields null actual.
    const requested = extractRequestedServiceTier({ service_tier: 'priority' }, {}, 'chat');
    expect(requested.tier).toBe('priority');
    expect(extractActualServiceTier({}, {})).toEqual({ tier: null, raw: null });
  });
});
