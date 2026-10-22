/**
 * Auto-bridge, end to end through the real Dispatcher.
 *
 * A chat-shaped request naming an image-type alias must be recognised right
 * after candidate resolution — before any wire API type is selected — and
 * served through the ordinary image pipeline
 * (`Dispatcher.dispatchImageGenerations`), so the image capability filter,
 * key policy, quota, cooldown, concurrency and failover all apply exactly as
 * they do on the REST `/v1/images/generations` surface. What must hold:
 *   - the chat body becomes an image request (prompt from the last user
 *     message, `n: 1`, `incomingApiType: 'images'`), and nothing is dispatched
 *     over the chat wire (`fetch` is never called);
 *   - the result is already-unified image output carrying
 *     `plexus.apiType === 'images'`, which is what makes the response handler
 *     pick the no-op images transformer;
 *   - `stream: true` yields unified chunk objects, not provider SSE bytes;
 *   - detection ignores `tools`: an `image_generation` tool on a chat-typed
 *     alias still routes down the normal chat path;
 *   - image-pipeline errors propagate with their routing context intact.
 */

import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test';

import { registerSpy } from '../../../test/test-utils';
import { setConfigForTesting } from '../../config';
import type { UnifiedChatRequest, UnifiedImageGenerationResponse } from '../../types/unified';
import { Dispatcher } from '../dispatch/dispatcher';
import { StickySessionManager } from '../routing/sticky-session-manager';
import { CooldownManager } from '../runtime/cooldown-manager';

const TINY_IMAGE_B64 = 'aGVsbG8=';

function bridgeConfig() {
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
      openai: {
        api_base_url: 'https://api.openai.com/v1',
        api_key: 'k',
        models: { 'gpt-4o': {} },
      },
    },
    models: {
      image_alias: {
        selector: 'in_order',
        type: 'image',
        targets: [{ provider: 'codex', model: 'gpt-image-2' }],
      },
      chat_alias: {
        selector: 'in_order',
        targets: [{ provider: 'openai', model: 'gpt-4o' }],
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

function imageGenerationResponse(): UnifiedImageGenerationResponse {
  return {
    created: 1700000000,
    data: [{ b64_json: TINY_IMAGE_B64 }],
    usage: { input_tokens: 7, output_tokens: 3, total_tokens: 10 },
    plexus: {
      provider: 'codex',
      model: 'gpt-image-2',
      apiType: 'images',
      targetApiType: 'codex-images',
      canonicalModel: 'image_alias',
      config: {},
    },
  };
}

function chatRequest(overrides: Partial<UnifiedChatRequest> = {}): UnifiedChatRequest {
  return {
    model: 'image_alias',
    messages: [{ role: 'user', content: 'a watercolor fox' }],
    incomingApiType: 'chat',
    requestId: 'bridge-req-1',
    ...overrides,
  } as UnifiedChatRequest;
}

async function collectChunks(stream: ReadableStream): Promise<any[]> {
  const reader = stream.getReader();
  const chunks: any[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return chunks;
}

describe('Dispatcher image-model auto-bridge', () => {
  let fetchSpy: ReturnType<typeof registerSpy>;

  beforeEach(async () => {
    StickySessionManager.getInstance().clear();
    await CooldownManager.getInstance().clearCooldown();
    setConfigForTesting(bridgeConfig());
    fetchSpy = registerSpy(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'chatcmpl-1',
          object: 'chat.completion',
          created: 1,
          model: 'gpt-4o',
          choices: [
            { index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      ) as any
    );
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await CooldownManager.getInstance().clearCooldown();
    StickySessionManager.getInstance().clear();
  });

  test('serves a chat request naming an image alias through the image pipeline', async () => {
    const imageSpy = registerSpy(
      Dispatcher.prototype,
      'dispatchImageGenerations'
    ).mockResolvedValue(imageGenerationResponse());

    const response = await new Dispatcher().dispatch(chatRequest());

    expect(imageSpy).toHaveBeenCalledTimes(1);
    expect(imageSpy.mock.calls[0]![0]).toMatchObject({
      model: 'image_alias',
      prompt: 'a watercolor fox',
      n: 1,
      incomingApiType: 'images',
      requestId: 'bridge-req-1',
    });

    expect(response.content).toBeNull();
    expect(response.finishReason).toBe('stop');
    expect(response.image_generation_calls).toEqual([
      { id: expect.stringMatching(/^ig_/), status: 'completed', result: TINY_IMAGE_B64 },
    ]);
    expect(response.plexus?.apiType).toBe('images');
    expect(response.usage).toEqual({
      input_tokens: 7,
      output_tokens: 3,
      total_tokens: 10,
      reasoning_tokens: 0,
      cached_tokens: 0,
      cache_creation_tokens: 0,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('streams unified chunks when the chat client asked for a stream', async () => {
    registerSpy(Dispatcher.prototype, 'dispatchImageGenerations').mockResolvedValue(
      imageGenerationResponse()
    );

    const response = await new Dispatcher().dispatch(chatRequest({ stream: true }));

    expect(response.bypassTransformation).toBe(false);
    expect(response.plexus?.apiType).toBe('images');

    const chunks = await collectChunks(response.stream as ReadableStream);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].delta.content).toBe(
      `![generated image](data:image/png;base64,${TINY_IMAGE_B64})`
    );
    expect(chunks[0].image_generation_calls[0].result).toBe(TINY_IMAGE_B64);
    expect(chunks[1].finish_reason).toBe('stop');
    expect(chunks[1].usage.total_tokens).toBe(10);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('does NOT bridge a chat-typed alias carrying an image_generation tool', async () => {
    const imageSpy = registerSpy(Dispatcher.prototype, 'dispatchImageGenerations');

    const response = await new Dispatcher().dispatch(
      chatRequest({ model: 'chat_alias', tools: [{ type: 'image_generation' } as any] })
    );

    expect(imageSpy).not.toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(response.content).toBe('ok');
  });

  test('propagates an image-pipeline caller error with its routing context', async () => {
    registerSpy(Dispatcher.prototype, 'dispatchImageGenerations').mockRejectedValue(
      Object.assign(new Error('Image reference URL is not allowed'), {
        routingContext: { statusCode: 400, code: 'invalid_request_error' },
      })
    );

    await expect(new Dispatcher().dispatch(chatRequest())).rejects.toMatchObject({
      message: 'Image reference URL is not allowed',
      routingContext: { statusCode: 400 },
    });
  });
});
