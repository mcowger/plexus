/**
 * Live Codex model discovery (`GET <oauth base>/codex/models?client_version=…`).
 *
 * The ChatGPT backend knows which models the signed-in account may actually
 * use; pi-ai's static catalog does not. Discovery therefore asks the backend
 * with the same OAuth identity the Responses/images calls use, maps the
 * upstream records onto `DiscoveredModel`, and appends the curated Codex image
 * models (the backend never lists them).
 *
 * What must hold:
 *   - the request targets `<base>/codex/models` carrying `client_version` and
 *     the shared Codex identity headers plus `Accept: application/json`;
 *   - records map slug/display_name/description/context_window/visibility,
 *     `visibility: 'none'` entries are dropped, `hide` entries are kept and
 *     flagged, and the list is ordered by priority (desc) then slug;
 *   - the curated image models are appended exactly once, never duplicating an
 *     id the backend already returned;
 *   - every failure mode (no credentials, non-2xx, thrown fetch, malformed
 *     body) degrades to the static catalog + image models with a warning.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerSpy } from '../../../../test/test-utils';
import type { ProviderConfig } from '../../../config';
import { CodexVersionService } from '../../oauth/codex-version-service';
import { OAuthAuthManager } from '../../oauth/oauth-auth-manager';
import {
  CODEX_IMAGE_MODELS,
  discoverProviderModelIds,
  discoverProviderModels,
  listCodexOAuthModels,
} from '../provider-model-discovery';

const ACCOUNT_ID = 'acc_models_4242';

/** A fake Codex OAuth JWT whose payload carries the given auth claims. */
function codexToken(auth: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': auth })).toString(
    'base64url'
  );
  return `${header}.${payload}.sig`;
}

const CODEX_TOKEN = codexToken({ chatgpt_account_id: ACCOUNT_ID });

const CODEX_MODELS_BODY = {
  models: [
    {
      slug: 'gpt-5.4-codex',
      display_name: 'GPT-5.4 Codex',
      description: 'Agentic coding model',
      visibility: 'list',
      supported_in_api: true,
      priority: 10,
      context_window: 272000,
    },
    {
      slug: 'gpt-5.4-codex-mini',
      display_name: 'GPT-5.4 Codex Mini',
      description: 'Smaller, faster',
      visibility: 'hide',
      supported_in_api: true,
      priority: 20,
      context_window: null,
    },
    {
      slug: 'codex-internal-preview',
      display_name: 'Internal Preview',
      description: 'Not for humans',
      visibility: 'none',
      supported_in_api: false,
      priority: 99,
      context_window: 100,
    },
    {
      slug: 'gpt-5.3-codex',
      display_name: 'GPT-5.3 Codex',
      description: 'Previous generation',
      visibility: 'list',
      supported_in_api: true,
      priority: 10,
      context_window: 200000,
    },
  ],
};

function jsonResponse(body: unknown, status = 200): any {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: new Headers({ 'content-type': 'application/json', etag: 'W/"abc"' }),
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

describe('listCodexOAuthModels', () => {
  let getApiKey: ReturnType<typeof registerSpy>;
  let fetchSpy: ReturnType<typeof registerSpy>;

  beforeEach(() => {
    CodexVersionService.resetForTesting();
    OAuthAuthManager.resetForTesting();
    getApiKey = registerSpy(OAuthAuthManager.getInstance(), 'getApiKey').mockResolvedValue(
      CODEX_TOKEN
    );
    fetchSpy = registerSpy(globalThis, 'fetch').mockResolvedValue(jsonResponse(CODEX_MODELS_BODY));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    OAuthAuthManager.resetForTesting();
    CodexVersionService.resetForTesting();
  });

  it('asks the Codex backend with the client version and the shared OAuth identity', async () => {
    const codex = CodexVersionService.getInstance();

    await listCodexOAuthModels('work-account');

    expect(getApiKey).toHaveBeenCalledWith('openai-codex', 'work-account');
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      `https://chatgpt.com/backend-api/codex/models?client_version=${codex.getVersion()}`
    );
    expect(init.method).toBe('GET');
    expect(init.headers).toEqual({
      Accept: 'application/json',
      Authorization: `Bearer ${CODEX_TOKEN}`,
      'chatgpt-account-id': ACCOUNT_ID,
      originator: 'codex_cli_rs',
      Version: codex.getVersion(),
      'User-Agent': codex.getUserAgent(),
    });
    expect(init.signal).toBeDefined();
  });

  it('maps the upstream records onto DiscoveredModel', async () => {
    const result = await listCodexOAuthModels(ACCOUNT_ID);

    expect(result.source).toBe('codex-backend');
    expect(result.warning).toBeUndefined();
    expect(result.models.find((model) => model.id === 'gpt-5.4-codex')).toEqual({
      id: 'gpt-5.4-codex',
      name: 'GPT-5.4 Codex',
      description: 'Agentic coding model',
      context_length: 272000,
      visibility: 'list',
    });
  });

  it('drops hidden-from-everyone models and keeps hide-flagged ones', async () => {
    const result = await listCodexOAuthModels(ACCOUNT_ID);

    expect(result.models.map((model) => model.id)).not.toContain('codex-internal-preview');
    const mini = result.models.find((model) => model.id === 'gpt-5.4-codex-mini');
    expect(mini?.visibility).toBe('hide');
    expect(mini?.context_length).toBeUndefined();
  });

  it('orders models by priority descending then slug', async () => {
    const result = await listCodexOAuthModels(ACCOUNT_ID);

    expect(result.models.slice(0, 3).map((model) => model.id)).toEqual([
      'gpt-5.4-codex-mini',
      'gpt-5.3-codex',
      'gpt-5.4-codex',
    ]);
  });

  it('appends the curated Codex image models', async () => {
    const result = await listCodexOAuthModels(ACCOUNT_ID);

    expect(CODEX_IMAGE_MODELS.map((model) => model.id)).toEqual([
      'gpt-image-2',
      'gpt-image-2.5-flare',
      'gpt-image-2.5-sunburst',
    ]);
    for (const image of CODEX_IMAGE_MODELS) {
      const found = result.models.find((model) => model.id === image.id);
      expect(found).toEqual({
        id: image.id,
        name: image.id,
        description: 'Codex Images (ChatGPT OAuth)',
        type: 'image',
        access_via: ['codex-images'],
      });
    }
    expect(result.models.slice(-3).map((model) => model.id)).toEqual(
      CODEX_IMAGE_MODELS.map((model) => model.id)
    );
  });

  it('never duplicates an image model the backend already listed', async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse({
        models: [
          {
            slug: 'gpt-image-2',
            display_name: 'Backend Image 2',
            visibility: 'list',
            priority: 1,
          },
        ],
      })
    );

    const result = await listCodexOAuthModels(ACCOUNT_ID);
    const ids = result.models.map((model) => model.id);

    expect(ids.filter((id) => id === 'gpt-image-2')).toHaveLength(1);
    expect(result.models.find((model) => model.id === 'gpt-image-2')?.name).toBe('Backend Image 2');
  });

  it.each([
    [
      'a non-2xx response',
      () => {
        fetchSpy.mockResolvedValue(jsonResponse({ error: 'unauthorized' }, 401));
      },
    ],
    [
      'a thrown fetch',
      () => {
        fetchSpy.mockRejectedValue(new Error('network down'));
      },
    ],
    [
      'a malformed body',
      () => {
        fetchSpy.mockResolvedValue(jsonResponse({ unexpected: true }));
      },
    ],
    [
      'missing credentials',
      () => {
        getApiKey.mockRejectedValue(new Error('OAuth: Not authenticated'));
      },
    ],
  ])('falls back to the static catalog on %s', async (_label, arrange) => {
    arrange();

    const result = await listCodexOAuthModels(ACCOUNT_ID);

    expect(result.source).toBe('catalog');
    expect(result.warning).toEqual(expect.stringContaining('static catalog'));
    const ids = result.models.map((model) => model.id);
    expect(ids).toContain('gpt-5.4');
    for (const image of CODEX_IMAGE_MODELS) {
      expect(ids).toContain(image.id);
    }
  });
});

describe('discoverProviderModels for OAuth providers', () => {
  let getApiKey: ReturnType<typeof registerSpy>;
  let fetchSpy: ReturnType<typeof registerSpy>;

  beforeEach(() => {
    CodexVersionService.resetForTesting();
    OAuthAuthManager.resetForTesting();
    getApiKey = registerSpy(OAuthAuthManager.getInstance(), 'getApiKey').mockResolvedValue(
      CODEX_TOKEN
    );
    fetchSpy = registerSpy(globalThis, 'fetch').mockResolvedValue(jsonResponse(CODEX_MODELS_BODY));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    OAuthAuthManager.resetForTesting();
    CodexVersionService.resetForTesting();
  });

  it('routes Codex OAuth providers through live discovery with their account', async () => {
    const provider = {
      api_base_url: 'oauth://',
      api_key: 'oauth',
      oauth_provider: 'openai-codex',
      oauth_account: 'work-account',
    } as unknown as ProviderConfig;

    const models = await discoverProviderModels(provider);

    expect(getApiKey).toHaveBeenCalledWith('openai-codex', 'work-account');
    expect(models.map((model) => model.id)).toContain('gpt-5.4-codex');
    expect(models.map((model) => model.id)).toContain('gpt-image-2');
  });

  it('keeps image models out of the bare-id list autosync consumes', async () => {
    // `discoverProviderModelIds` feeds model autosync, which inserts bare text
    // targets (no `modelType`, empty `accessVia`). An image id arriving that way
    // would be dispatched to /codex/responses as a chat model and claim the id
    // an admin needs for the correctly typed target.
    const provider = {
      api_base_url: 'oauth://',
      api_key: 'oauth',
      oauth_provider: 'openai-codex',
      oauth_account: 'work-account',
    } as unknown as ProviderConfig;

    const ids = await discoverProviderModelIds(provider);

    expect(ids).toContain('gpt-5.4-codex');
    expect(ids).toContain('gpt-5.4-codex-mini');
    for (const image of CODEX_IMAGE_MODELS) {
      expect(ids).not.toContain(image.id);
    }
  });

  it('leaves other OAuth providers on the static catalog', async () => {
    const provider = {
      api_base_url: 'oauth://',
      api_key: 'oauth',
      oauth_provider: 'anthropic',
      oauth_account: 'default',
    } as unknown as ProviderConfig;

    const models = await discoverProviderModels(provider);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(models.map((model) => model.id)).toContain('claude-opus-4');
    expect(models.map((model) => model.id)).not.toContain('gpt-image-2');
  });
});
