import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';

import { registerSpy } from '../../../test/test-utils';
import { setConfigForTesting } from '../../config';
import type { UnifiedImageGenerationRequest } from '../../types/unified';
import { Dispatcher } from '../dispatch/dispatcher';
import { CodexVersionService } from '../oauth/codex-version-service';
import { OAuthAuthManager } from '../oauth/oauth-auth-manager';
import { DebugManager } from '../observability/debug-manager';
import { CooldownManager } from '../runtime/cooldown-manager';

const fetchMock = mock();
beforeEach(() => {
  spyOn(globalThis, 'fetch').mockImplementation(fetchMock as any);
});

function baseConfig(providerId: string, provider: any, model: string) {
  return {
    providers: { [providerId]: provider },
    models: {
      image_alias: {
        selector: 'in_order',
        type: 'image',
        targets: [{ provider: providerId, model }],
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

const request: UnifiedImageGenerationRequest = {
  model: 'image_alias',
  prompt: 'A watercolor fox',
  resolution: '2K',
  aspect_ratio: '16:9',
  input_references: [
    {
      type: 'image_url',
      image_url: { url: 'data:image/png;base64,AA==' },
    },
  ],
  incomingApiType: 'images',
  requestId: 'image-request',
};

/** A fake Codex OAuth JWT carrying the account claim the wire header uses. */
const CODEX_TOKEN = (() => {
  const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: 'acc_edits_1' } })
  ).toString('base64url');
  return `${header}.${payload}.sig`;
})();

function codexImagesConfig() {
  return {
    providers: {
      codex: {
        api_base_url: 'oauth://',
        api_key: 'oauth',
        oauth_provider: 'openai-codex',
        oauth_account: 'acct',
        models: {
          'gpt-image-2': { type: 'image', access_via: ['codex-images'] },
        },
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

describe('Dispatcher image translation', () => {
  beforeEach(async () => {
    fetchMock.mockReset();
    CodexVersionService.resetForTesting();
    OAuthAuthManager.resetForTesting();
    await CooldownManager.getInstance().clearCooldown();
  });

  afterEach(async () => {
    await CooldownManager.getInstance().clearCooldown();
    OAuthAuthManager.resetForTesting();
    CodexVersionService.resetForTesting();
  });

  test('translates the unified request to an OpenAI-compatible edit payload', async () => {
    setConfigForTesting(
      baseConfig(
        'openai',
        {
          api_base_url: 'https://api.example.com/v1',
          api_key: 'openai-key',
          models: {
            'gpt-image': {
              type: 'image',
              access_via: ['openai-images'],
            },
          },
        },
        'gpt-image'
      )
    );
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          created: 1,
          data: [{ b64_json: 'AA==' }],
          usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const response = await new Dispatcher().dispatchImageGenerations(request);

    expect(response.data).toEqual([{ b64_json: 'AA==' }]);
    expect(response.plexus?.targetApiType).toBe('openai-images');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.example.com/v1/images/edits');
    expect(options.headers.Authorization).toBe('Bearer openai-key');
    expect(options.body).toBeInstanceOf(FormData);
    expect(options.body.get('prompt')).toBe('A watercolor fox');
    expect(options.body.get('size')).toBe('1792x1024');
  });

  test('prefers the dedicated OpenAI Images base URL over chat', async () => {
    setConfigForTesting(
      baseConfig(
        'openai',
        {
          api_base_url: {
            chat: 'https://chat.example.com/v1',
            'openai-images': 'https://images.example.com/v1',
          },
          api_key: 'openai-key',
          models: {
            'gpt-image': {
              type: 'image',
              access_via: ['chat'],
            },
          },
        },
        'gpt-image'
      )
    );
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ created: 1, data: [{ b64_json: 'AA==' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    await new Dispatcher().dispatchImageGenerations({
      ...request,
      input_references: undefined,
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://images.example.com/v1/images/generations');
  });

  test('does not let client provider options override the routed model', async () => {
    setConfigForTesting(
      baseConfig(
        'openai',
        {
          api_base_url: 'https://api.example.com/v1',
          api_key: 'openai-key',
          models: {
            'gpt-image': {
              type: 'image',
              access_via: ['openai-images'],
            },
          },
        },
        'gpt-image'
      )
    );
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ created: 1, data: [{ b64_json: 'AA==' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    await new Dispatcher().dispatchImageGenerations({
      ...request,
      input_references: undefined,
      provider: {
        options: {
          openai: {
            model: 'attacker-model',
            prompt: 'attacker-prompt',
            response_format: 'url',
            provider_specific_option: 'preserved',
          },
        },
      },
    });

    const [, options] = fetchMock.mock.calls[0]!;
    expect(JSON.parse(options.body)).toEqual({
      model: 'gpt-image',
      prompt: 'A watercolor fox',
      size: '1792x1024',
      provider_specific_option: 'preserved',
    });
  });

  test('translates the unified request to the dedicated OpenRouter image endpoint', async () => {
    setConfigForTesting(
      baseConfig(
        'openrouter',
        {
          api_base_url: 'https://openrouter.ai/api/v1',
          api_key: 'openrouter-key',
          models: {
            'openrouter-image': {
              type: 'image',
              access_via: ['openrouter-images'],
            },
          },
        },
        'openrouter-image'
      )
    );
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          created: 1,
          data: [{ b64_json: 'AA==' }],
          usage: { prompt_tokens: 0, completion_tokens: 10, total_tokens: 10, cost: 0.04 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const response = await new Dispatcher().dispatchImageGenerations({
      ...request,
      input_references: undefined,
    });

    expect(response.data).toEqual([{ b64_json: 'AA==' }]);
    expect(response.plexus?.targetApiType).toBe('openrouter-images');
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://openrouter.ai/api/v1/images');
    expect(options.headers.Authorization).toBe('Bearer openrouter-key');
    expect(JSON.parse(options.body)).toEqual({
      model: 'openrouter-image',
      prompt: 'A watercolor fox',
      resolution: '2K',
      aspect_ratio: '16:9',
    });
  });

  test('translates the unified request to native Gemini generateContent', async () => {
    setConfigForTesting(
      baseConfig(
        'google',
        {
          api_base_url: 'https://generativelanguage.googleapis.com',
          api_key: 'google-key',
          models: {
            'gemini-image': {
              type: 'image',
              access_via: ['gemini'],
            },
          },
        },
        'gemini-image'
      )
    );
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ inlineData: { mimeType: 'image/png', data: 'AA==' } }],
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const response = await new Dispatcher().dispatchImageGenerations(request);

    expect(response.data).toEqual([{ b64_json: 'AA==', media_type: 'image/png' }]);
    expect(response.plexus?.targetApiType).toBe('gemini');
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-image:generateContent'
    );
    expect(options.headers['x-goog-api-key']).toBe('google-key');
    const payload = JSON.parse(options.body);
    expect(payload.generationConfig).toMatchObject({
      responseModalities: ['IMAGE'],
      imageConfig: { aspectRatio: '16:9', imageSize: '2K' },
    });
    expect(payload.contents[0].parts[1].inlineData).toEqual({
      mimeType: 'image/png',
      data: 'AA==',
    });
  });

  // A FormData has no enumerable own properties, so an unsummarized multipart
  // body serializes into the debug trace as `{}` — the whole request summary
  // is lost on every OpenAI-compatible edit.
  test('summarizes the multipart edit body for the debug trace', async () => {
    setConfigForTesting(
      baseConfig(
        'openai',
        {
          api_base_url: 'https://api.example.com/v1',
          api_key: 'openai-key',
          models: {
            'gpt-image': {
              type: 'image',
              access_via: ['openai-images'],
            },
          },
        },
        'gpt-image'
      )
    );
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ created: 1, data: [{ b64_json: 'AA==' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    const addTransformedRequest = registerSpy(DebugManager.getInstance(), 'addTransformedRequest');

    await new Dispatcher().dispatchImageGenerations({
      ...request,
      mask: {
        type: 'image_url',
        image_url: { url: 'data:image/png;base64,/w==' },
        media_type: 'image/png',
      },
    });

    expect(addTransformedRequest).toHaveBeenCalledTimes(1);
    const [requestId, debugPayload] = addTransformedRequest.mock.calls[0] as any[];
    expect(requestId).toBe('image-request');
    expect(debugPayload).toEqual({
      model: 'gpt-image',
      prompt: 'A watercolor fox',
      size: '1792x1024',
      image: 'image/png;[1 bytes]',
      mask: 'image/png;[1 bytes]',
    });

    // The wire body still carries the real bytes.
    const [, options] = fetchMock.mock.calls[0]!;
    expect(options.body).toBeInstanceOf(FormData);
    expect(options.body.get('image')).toBeInstanceOf(Blob);
  });

  test('sends the inpainting mask alongside the reference on the OpenAI edit path', async () => {
    setConfigForTesting(
      baseConfig(
        'openai',
        {
          api_base_url: 'https://api.example.com/v1',
          api_key: 'openai-key',
          models: {
            'gpt-image': {
              type: 'image',
              access_via: ['openai-images'],
            },
          },
        },
        'gpt-image'
      )
    );
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ created: 1, data: [{ b64_json: 'AA==' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    await new Dispatcher().dispatchImageGenerations({
      ...request,
      mask: {
        type: 'image_url',
        image_url: { url: 'data:image/png;base64,/w==' },
        media_type: 'image/png',
      },
    });

    const [url, options] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.example.com/v1/images/edits');
    expect(options.body).toBeInstanceOf(FormData);
    const mask = options.body.get('mask') as Blob;
    expect(mask).toBeInstanceOf(Blob);
    expect(new Uint8Array(await mask.arrayBuffer())).toEqual(new Uint8Array([0xff]));
  });

  test('routes a legacy multipart edit request to the Codex JSON edits endpoint', async () => {
    setConfigForTesting(codexImagesConfig());
    registerSpy(OAuthAuthManager.getInstance(), 'getApiKey').mockResolvedValue(CODEX_TOKEN);
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ created: 9, data: [{ b64_json: 'AA==' }], output_format: 'png' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const image = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const response = await new Dispatcher().dispatchImageEdits({
      model: 'image_alias',
      prompt: 'A watercolor fox',
      image,
      filename: 'input.png',
      mimeType: 'image/png',
      requestId: 'legacy-edit-request',
      incomingApiType: 'images',
    });

    expect(response.data).toEqual([{ b64_json: 'AA==', media_type: 'image/png' }]);
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://chatgpt.com/backend-api/codex/images/edits');
    expect(options.headers['Content-Type']).toBe('application/json');
    expect(options.headers['Authorization']).toBe(`Bearer ${CODEX_TOKEN}`);
    expect(JSON.parse(options.body)).toEqual({
      images: [{ image_url: `data:image/png;base64,${image.toString('base64')}` }],
      model: 'gpt-image-2',
      prompt: 'A watercolor fox',
      background: 'auto',
      quality: 'auto',
      size: 'auto',
    });
  });
});
