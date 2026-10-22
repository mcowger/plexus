/**
 * Codex Images dispatch through the media dispatcher's auth seam.
 *
 * An `openai-codex` OAuth provider has no dispatchable `api_base_url` and no
 * usable `api_key` — its image calls must resolve a real base URL and a Bearer
 * token from `OAuthAuthManager` instead. What must hold end to end:
 *   - a `codex-images` OAuth route POSTs to `<backend>/codex/images/generations`
 *     (or `/images/edits`) with the Codex OAuth identity, never `Bearer oauth`;
 *   - `route.config.headers` still win, exactly as on the API-key path;
 *   - an OAuth route pointed at a non-Codex image target is a 400 caller error,
 *     not an upstream call;
 *   - an unauthenticated provider fails before any dispatch;
 *   - the debug trace gets data URLs redacted while the wire body keeps them;
 *   - a Codex usage-limit 429 keeps the existing status propagation + cooldown.
 */

import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test';

import { registerSpy } from '../../../test/test-utils';
import { setConfigForTesting } from '../../config';
import type { UnifiedImageGenerationRequest } from '../../types/unified';
import { logger } from '../../utils/logger';
import { Dispatcher } from '../dispatch/dispatcher';
import { CodexVersionService } from '../oauth/codex-version-service';
import { OAuthAuthManager } from '../oauth/oauth-auth-manager';
import { DebugManager } from '../observability/debug-manager';
import { CooldownManager } from '../runtime/cooldown-manager';

const ACCOUNT_ID = 'acc_images_4242';

/** A fake Codex OAuth JWT carrying the account claim the wire header uses. */
const CODEX_TOKEN = (() => {
  const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: ACCOUNT_ID } })
  ).toString('base64url');
  return `${header}.${payload}.sig`;
})();

function codexImagesConfig(overrides: Record<string, any> = {}, accessVia = ['codex-images']) {
  return {
    providers: {
      codex: {
        api_base_url: 'oauth://',
        api_key: 'oauth',
        oauth_provider: 'openai-codex',
        oauth_account: 'acct',
        models: {
          'gpt-image-2': { type: 'image', access_via: accessVia },
        },
        ...overrides,
      },
    },
    models: {
      image_alias: {
        selector: 'in_order',
        type: 'image',
        targets: [{ provider: 'codex', model: 'gpt-image-2' }],
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

const generationRequest: UnifiedImageGenerationRequest = {
  model: 'image_alias',
  prompt: 'A watercolor fox',
  size: '1024x1024',
  incomingApiType: 'images',
  requestId: 'codex-image-request',
};

const SMALL_DATA_URL = 'data:image/png;base64,AA==';
/** 400 base64 chars → 300 decoded bytes, standing in for a multi-MB reference. */
const LARGE_DATA_URL = `data:image/png;base64,${'A'.repeat(400)}`;

function editRequest(dataUrl = SMALL_DATA_URL): UnifiedImageGenerationRequest {
  return {
    ...generationRequest,
    input_references: [{ type: 'image_url', image_url: { url: dataUrl } }],
  };
}

function codexImageResponse(headers: Record<string, string> = {}) {
  return new Response(
    JSON.stringify({
      created: 17,
      data: [{ b64_json: 'AA==' }],
      output_format: 'png',
      usage: { input_tokens: 4, output_tokens: 6, total_tokens: 10 },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json', ...headers } }
  );
}

describe('Dispatcher Codex images OAuth dispatch', () => {
  let fetchSpy: ReturnType<typeof registerSpy>;

  beforeEach(async () => {
    CodexVersionService.resetForTesting();
    OAuthAuthManager.resetForTesting();
    await CooldownManager.getInstance().clearCooldown();
    registerSpy(OAuthAuthManager.getInstance(), 'getApiKey').mockResolvedValue(CODEX_TOKEN);
    fetchSpy = registerSpy(global, 'fetch').mockResolvedValue(codexImageResponse());
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await CooldownManager.getInstance().clearCooldown();
    OAuthAuthManager.resetForTesting();
    CodexVersionService.resetForTesting();
  });

  test('sends a generation to the Codex images endpoint with the OAuth identity', async () => {
    setConfigForTesting(codexImagesConfig());

    const response = await new Dispatcher().dispatchImageGenerations(generationRequest);

    expect(response.data).toEqual([{ b64_json: 'AA==', media_type: 'image/png' }]);
    expect(response.plexus?.targetApiType).toBe('codex-images');

    expect(OAuthAuthManager.getInstance().getApiKey).toHaveBeenCalledWith('openai-codex', 'acct');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as any[];
    expect(url).toBe('https://chatgpt.com/backend-api/codex/images/generations');
    expect(init.headers).toEqual({
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${CODEX_TOKEN}`,
      'chatgpt-account-id': ACCOUNT_ID,
      originator: 'codex_cli_rs',
      Version: CodexVersionService.getInstance().getVersion(),
      'User-Agent': CodexVersionService.getInstance().getUserAgent(),
    });
    expect(JSON.parse(init.body)).toEqual({
      model: 'gpt-image-2',
      prompt: 'A watercolor fox',
      size: '1024x1024',
    });
  });

  test('merges configured provider headers over the Codex OAuth headers', async () => {
    setConfigForTesting(
      codexImagesConfig({ headers: { 'x-plexus-tag': 'images', originator: 'override' } })
    );

    await new Dispatcher().dispatchImageGenerations(generationRequest);

    const [, init] = fetchSpy.mock.calls[0] as any[];
    expect(init.headers['x-plexus-tag']).toBe('images');
    expect(init.headers['originator']).toBe('override');
    expect(init.headers['Authorization']).toBe(`Bearer ${CODEX_TOKEN}`);
  });

  test('sends input references to the Codex edits endpoint as JSON', async () => {
    setConfigForTesting(codexImagesConfig());

    await new Dispatcher().dispatchImageGenerations(editRequest());

    const [url, init] = fetchSpy.mock.calls[0] as any[];
    expect(url).toBe('https://chatgpt.com/backend-api/codex/images/edits');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({
      images: [{ image_url: SMALL_DATA_URL }],
      model: 'gpt-image-2',
      prompt: 'A watercolor fox',
      background: 'auto',
      quality: 'auto',
      size: '1024x1024',
    });
  });

  test('rejects an OAuth route whose image target is not codex-images', async () => {
    setConfigForTesting(codexImagesConfig({}, ['openai-images']));

    await expect(
      new Dispatcher().dispatchImageGenerations(generationRequest)
    ).rejects.toMatchObject({
      message: expect.stringContaining(
        'OAuth provider openai-codex cannot serve image target openai-images'
      ),
      routingContext: expect.objectContaining({ statusCode: 400 }),
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('rejects an OAuth provider that is not Codex', async () => {
    setConfigForTesting(codexImagesConfig({ oauth_provider: 'anthropic' }, ['chat']));

    await expect(
      new Dispatcher().dispatchImageGenerations(generationRequest)
    ).rejects.toMatchObject({
      message: expect.stringContaining('OAuth provider anthropic cannot serve image target chat'),
      routingContext: expect.objectContaining({ statusCode: 400 }),
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('infers the Codex OAuth provider from the provider id', async () => {
    const config = codexImagesConfig();
    config.providers['openai-codex'] = { ...config.providers.codex, oauth_provider: undefined };
    delete config.providers.codex;
    config.models.image_alias.targets[0].provider = 'openai-codex';
    setConfigForTesting(config);

    await new Dispatcher().dispatchImageGenerations(generationRequest);

    const [url, init] = fetchSpy.mock.calls[0] as any[];
    expect(url).toBe('https://chatgpt.com/backend-api/codex/images/generations');
    expect(init.headers['Authorization']).toBe(`Bearer ${CODEX_TOKEN}`);
  });

  test('fails an unauthenticated Codex provider without dispatching', async () => {
    setConfigForTesting(codexImagesConfig());
    (OAuthAuthManager.getInstance().getApiKey as any).mockRejectedValue(
      new Error("OAuth: Not authenticated for provider 'openai-codex'.")
    );

    await expect(new Dispatcher().dispatchImageGenerations(generationRequest)).rejects.toThrow(
      'Not authenticated'
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('redacts data URLs in the debug payload but not on the wire', async () => {
    setConfigForTesting(codexImagesConfig());
    const addTransformedRequest = registerSpy(DebugManager.getInstance(), 'addTransformedRequest');

    await new Dispatcher().dispatchImageGenerations(editRequest(LARGE_DATA_URL));

    expect(addTransformedRequest).toHaveBeenCalledTimes(1);
    const [requestId, debugPayload] = addTransformedRequest.mock.calls[0] as any[];
    expect(requestId).toBe('codex-image-request');
    expect(debugPayload.images).toEqual([{ image_url: 'data:image/png;base64,[300 bytes]' }]);
    expect(debugPayload.prompt).toBe('A watercolor fox');

    const [, init] = fetchSpy.mock.calls[0] as any[];
    expect(JSON.parse(init.body).images).toEqual([{ image_url: LARGE_DATA_URL }]);
  });

  test('logs the Codex imagegen request id from the response', async () => {
    setConfigForTesting(codexImagesConfig());
    fetchSpy.mockResolvedValue(
      codexImageResponse({ 'x-codex-imagegen-request-id': 'imagegen_req_9' })
    );

    await new Dispatcher().dispatchImageGenerations(generationRequest);

    expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('imagegen_req_9'));
  });

  test('propagates a Codex usage-limit 429 and marks the provider cooldown', async () => {
    setConfigForTesting(codexImagesConfig());
    const markProviderFailure = registerSpy(CooldownManager.getInstance(), 'markProviderFailure');
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({
          detail: 'usage_limit_reached',
          rate_limits: { limit_id: 'image_gen' },
        }),
        { status: 429, headers: { 'Content-Type': 'application/json' } }
      )
    );

    await expect(
      new Dispatcher().dispatchImageGenerations(generationRequest)
    ).rejects.toMatchObject({
      routingContext: expect.objectContaining({ statusCode: 429 }),
    });
    expect(markProviderFailure).toHaveBeenCalledWith(
      'codex',
      'gpt-image-2',
      undefined,
      expect.stringContaining('usage_limit_reached')
    );
  });
});
