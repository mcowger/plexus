import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { Router } from '../routing/router';
import { setConfigForTesting } from '../../config';
import { CooldownManager } from '../runtime/cooldown-manager';

function decisionsConfig() {
  return {
    providers: {
      openrouter: {
        api_base_url: {
          chat: 'https://openrouter.ai/api/v1',
          systemone: 'https://openrouter.ai/api/v1',
        },
        api_key: 'openrouter-key',
        models: {
          'typesafe/jev-1.13': { access_via: ['systemone'] },
          'some-chat-model': { access_via: ['chat'] },
        },
      },
      typesafe: {
        api_base_url: 'https://api.typesafe.ai/v1',
        api_key: 'typesafe-key',
        models: {
          'jev-latest': { access_via: ['systemone'] },
        },
      },
    },
    models: {
      decisions_alias: {
        selector: 'in_order',
        type: 'decisions',
        targets: [
          { provider: 'openrouter', model: 'typesafe/jev-1.13' },
          { provider: 'openrouter', model: 'some-chat-model' },
          { provider: 'typesafe', model: 'jev-latest' },
        ],
      },
      chat_alias: {
        selector: 'in_order',
        type: 'text',
        targets: [
          { provider: 'openrouter', model: 'typesafe/jev-1.13' },
          { provider: 'openrouter', model: 'some-chat-model' },
        ],
      },
      chat_only_alias: {
        selector: 'in_order',
        type: 'text',
        targets: [{ provider: 'openrouter', model: 'some-chat-model' }],
      },
    },
    keys: {},
    failover: {
      enabled: true,
      retryableStatusCodes: [429, 500, 502, 503, 504],
      retryableErrors: ['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND'],
    },
    quotas: [],
  } as any;
}

describe('Router decisions eligibility', () => {
  beforeEach(async () => {
    await CooldownManager.getInstance().clearCooldown();
    setConfigForTesting(decisionsConfig());
  });

  afterEach(async () => {
    await CooldownManager.getInstance().clearCooldown();
  });

  test('keeps only decisions-capable targets for an incoming decisions request', async () => {
    const candidates = await Router.resolveCandidates('decisions_alias', 'decisions');

    expect(candidates.map((c) => `${c.provider}/${c.model}`).sort()).toEqual([
      'openrouter/typesafe/jev-1.13',
      'typesafe/jev-latest',
    ]);
  });

  test('decisions requests narrow a mixed alias to decisions targets only', async () => {
    const candidates = await Router.resolveCandidates('chat_alias', 'decisions');

    expect(candidates.map((c) => `${c.provider}/${c.model}`)).toEqual([
      'openrouter/typesafe/jev-1.13',
    ]);
  });

  test('decisions requests never fall back to chat-only providers', async () => {
    const candidates = await Router.resolveCandidates('chat_only_alias', 'decisions');

    expect(candidates).toEqual([]);
  });

  test('chat requests exclude decisions-only targets but keep chat targets', async () => {
    const candidates = await Router.resolveCandidates('chat_alias', 'chat');

    expect(candidates.map((c) => `${c.provider}/${c.model}`)).toEqual([
      'openrouter/some-chat-model',
    ]);
  });

  test('non-decisions requests never resolve a decisions alias', async () => {
    for (const apiType of ['chat', 'images', 'embeddings']) {
      const candidates = await Router.resolveCandidates('decisions_alias', apiType);
      expect(candidates).toEqual([]);
    }
  });

  test('unconstrained targets keep the generic cross-format fallback', async () => {
    setConfigForTesting({
      providers: {
        generic: {
          api_base_url: 'https://chat.example.com/v1',
          api_key: 'chat-key',
          models: { 'generic-model': {} },
        },
      },
      models: {
        generic_alias: {
          selector: 'in_order',
          type: 'text',
          targets: [{ provider: 'generic', model: 'generic-model' }],
        },
      },
      keys: {},
      failover: { enabled: true, retryableStatusCodes: [], retryableErrors: [] },
      quotas: [],
    } as any);

    // No capability metadata: existing generic routing behavior is unchanged.
    expect(await Router.resolveCandidates('generic_alias', 'chat')).toHaveLength(1);
    expect(await Router.resolveCandidates('generic_alias', 'decisions')).toEqual([]);
  });
});
