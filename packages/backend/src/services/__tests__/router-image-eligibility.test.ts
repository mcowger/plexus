import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { setConfigForTesting } from '../../config';
import { Router } from '../routing/router';
import { CooldownManager } from '../runtime/cooldown-manager';

function codexImageConfig() {
  return {
    providers: {
      codex: {
        api_base_url: 'oauth://',
        api_key: 'oauth',
        oauth_provider: 'openai-codex',
        oauth_account: 'default',
        models: {
          'gpt-image-1': { type: 'image', access_via: ['codex-images'] },
          'gpt-5': { type: 'text', access_via: ['responses'] },
        },
      },
    },
    models: {
      image_alias: {
        selector: 'in_order',
        type: 'image',
        targets: [
          { provider: 'codex', model: 'gpt-image-1' },
          { provider: 'codex', model: 'gpt-5' },
        ],
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

describe('Router image eligibility', () => {
  beforeEach(async () => {
    await CooldownManager.getInstance().clearCooldown();
    setConfigForTesting(codexImageConfig());
  });

  afterEach(async () => {
    await CooldownManager.getInstance().clearCooldown();
  });

  test('keeps a codex-images target for an incoming images request', async () => {
    const candidates = await Router.resolveCandidates('image_alias', 'images');

    expect(candidates.map((c) => `${c.provider}/${c.model}`)).toEqual(['codex/gpt-image-1']);
  });

  test('only the images filter drops the text sibling', async () => {
    const imageCandidates = await Router.resolveCandidates('image_alias', 'images');
    const textCandidates = await Router.resolveCandidates('image_alias', 'responses');

    expect(imageCandidates.some((c) => c.model === 'gpt-5')).toBe(false);
    expect(textCandidates.map((c) => c.model)).toEqual(['gpt-image-1', 'gpt-5']);
  });
});
