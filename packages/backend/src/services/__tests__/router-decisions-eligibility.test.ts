import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { setConfigForTesting } from '../../config';
import { Router } from '../routing/router';
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

  test('a model declared type decisions serves decisions requests without access_via', async () => {
    setConfigForTesting({
      providers: {
        direct: {
          api_base_url: { systemone: 'https://systemone.example.com/v1' },
          api_key: 'direct-key',
          models: { 'jev-direct': { type: 'decisions' } },
        },
      },
      models: {
        decisions_alias: {
          selector: 'in_order',
          type: 'decisions',
          targets: [{ provider: 'direct', model: 'jev-direct' }],
        },
        chat_alias: {
          selector: 'in_order',
          type: 'text',
          targets: [{ provider: 'direct', model: 'jev-direct' }],
        },
      },
      keys: {},
      failover: { enabled: true, retryableStatusCodes: [], retryableErrors: [] },
      quotas: [],
    } as any);

    expect(await Router.resolveCandidates('decisions_alias', 'decisions')).toHaveLength(1);
    // `type: 'decisions'` is decisions-only even though access_via is empty.
    expect(await Router.resolveCandidates('chat_alias', 'chat')).toEqual([]);
  });

  test('a decisions-typed model without any decisions protocol is rejected', async () => {
    // `type: 'decisions'` alone must not admit a chat-only provider: the
    // Decisions payload would be mistranslated onto the chat base URL.
    setConfigForTesting({
      providers: {
        chatonly: {
          api_base_url: 'https://chat.example.com/v1',
          api_key: 'chat-key',
          models: { 'jev-no-url': { type: 'decisions' } },
        },
      },
      models: {
        text_alias: {
          selector: 'in_order',
          type: 'text',
          targets: [{ provider: 'chatonly', model: 'jev-no-url' }],
        },
      },
      keys: {},
      failover: { enabled: true, retryableStatusCodes: [], retryableErrors: [] },
      quotas: [],
    } as any);

    expect(await Router.resolveCandidates('text_alias', 'decisions')).toEqual([]);
  });

  test('a decisions-typed model with an explicit decisions access_via is admitted despite a chat-only provider URL', async () => {
    // The explicit `access_via` entry is the protocol advertisement when the
    // provider has no systemone base URL of its own.
    setConfigForTesting({
      providers: {
        chatonly: {
          api_base_url: 'https://systemone.example.com/v1',
          api_key: 'chat-key',
          models: { 'jev-entry': { type: 'decisions', access_via: ['systemone'] } },
        },
      },
      models: {
        text_alias: {
          selector: 'in_order',
          type: 'text',
          targets: [{ provider: 'chatonly', model: 'jev-entry' }],
        },
      },
      keys: {},
      failover: { enabled: true, retryableStatusCodes: [], retryableErrors: [] },
      quotas: [],
    } as any);

    expect(await Router.resolveCandidates('text_alias', 'decisions')).toHaveLength(1);
  });
});
