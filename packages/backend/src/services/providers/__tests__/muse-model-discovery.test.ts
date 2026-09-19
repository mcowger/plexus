/**
 * Live Muse model discovery (`GET https://api.meta.ai/v1/models`).
 *
 * What must hold:
 *   - the request carries the subscription-minted key as Bearer plus
 *     `x-api-version: 1.0.0` (the generic fetcher cannot send that header,
 *     hence the dedicated path);
 *   - backend ids are returned sorted, and the minted key is resolved for
 *     the configured OAuth account;
 *   - every failure mode (no credentials, non-2xx, empty list) degrades to
 *     the static muse-spark catalog with a warning.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerSpy } from '../../../../test/test-utils';
import { OAuthAuthManager } from '../../oauth/oauth-auth-manager';
import {
  discoverProviderModels,
  listMuseOAuthModels,
  MUSE_STATIC_MODELS,
} from '../provider-model-discovery';
import type { ProviderConfig } from '../../../config';

const MINTED_KEY = 'mk_live_abc';

const MUSE_MODELS_BODY = {
  object: 'list',
  data: [
    { id: 'muse-spark-1.3', object: 'model', owned_by: 'meta' },
    { id: 'muse-spark-1.2', object: 'model', owned_by: 'meta' },
  ],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function museProvider(): ProviderConfig {
  return {
    oauth_provider: 'muse-code',
    oauth_account: 'work-account',
  } as unknown as ProviderConfig;
}

describe('listMuseOAuthModels', () => {
  let getApiKey: ReturnType<typeof registerSpy>;
  let fetchSpy: ReturnType<typeof registerSpy>;

  beforeEach(() => {
    OAuthAuthManager.resetForTesting();
    getApiKey = registerSpy(OAuthAuthManager.getInstance(), 'getApiKey').mockResolvedValue(
      MINTED_KEY
    );
    fetchSpy = registerSpy(globalThis, 'fetch').mockResolvedValue(jsonResponse(MUSE_MODELS_BODY));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    OAuthAuthManager.resetForTesting();
  });

  it('sends the minted key plus api version to the Meta model list', async () => {
    const { models, source } = await listMuseOAuthModels('work-account');
    expect(source).toBe('muse-backend');
    expect(getApiKey).toHaveBeenCalledWith('muse-code', 'work-account');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('https://api.meta.ai/v1/models');
    expect((init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${MINTED_KEY}`);
    expect((init?.headers as Record<string, string>)['x-api-version']).toBe('1.0.0');
    expect(models.map((m) => m.id)).toEqual(['muse-spark-1.2', 'muse-spark-1.3']);
  });

  it('falls back to the static catalog when logged out', async () => {
    getApiKey.mockRejectedValue(new Error("OAuth: Not authenticated for provider 'muse-code'."));
    const { models, source, warning } = await listMuseOAuthModels('work-account');
    expect(source).toBe('catalog');
    expect(models.map((m) => m.id)).toEqual(MUSE_STATIC_MODELS.map((m) => m.id));
    expect(warning).toContain('static catalog');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('falls back to the static catalog on non-2xx and empty lists', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ error: 'boom' }, 429));
    const rateLimited = await listMuseOAuthModels();
    expect(rateLimited.source).toBe('catalog');
    expect(rateLimited.warning).toContain('429');

    fetchSpy.mockResolvedValue(jsonResponse({ object: 'list', data: [] }));
    const empty = await listMuseOAuthModels();
    expect(empty.source).toBe('catalog');
    expect(empty.models.map((m) => m.id)).toContain('muse-spark-1.3-contributor');
  });
});

describe('discoverProviderModels — muse-code', () => {
  let getApiKey: ReturnType<typeof registerSpy>;
  let fetchSpy: ReturnType<typeof registerSpy>;

  beforeEach(() => {
    OAuthAuthManager.resetForTesting();
    getApiKey = registerSpy(OAuthAuthManager.getInstance(), 'getApiKey').mockResolvedValue(
      MINTED_KEY
    );
    fetchSpy = registerSpy(globalThis, 'fetch').mockResolvedValue(jsonResponse(MUSE_MODELS_BODY));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    OAuthAuthManager.resetForTesting();
  });

  it('discovers live models for a muse-code OAuth provider', async () => {
    const models = await discoverProviderModels(museProvider());
    expect(models.map((m) => m.id)).toEqual(['muse-spark-1.2', 'muse-spark-1.3']);
    expect(getApiKey).toHaveBeenCalledWith('muse-code', 'work-account');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
