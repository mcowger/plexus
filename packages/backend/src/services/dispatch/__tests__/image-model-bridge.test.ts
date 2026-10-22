/**
 * Auto-bridge unit contract: a CHAT-SHAPED request that names an image-type
 * model becomes an image generation through the existing image pipeline, and
 * comes back as unified output every client formatter already renders.
 *
 * Covered here (module level, no dispatcher):
 *   - detection reads the resolved candidates (alias `type`, then every
 *     candidate's `modelConfig.type`), NEVER `request.tools`, and never
 *     bridges an internal vision-descriptor request;
 *   - the image request built from the chat body (last user message wins,
 *     text parts joined, `image_url` parts become `input_references`,
 *     `n: 1`, no size/quality/background so alias `extraBody` and target
 *     defaults still apply, `requestId`/`metadata` copied verbatim);
 *   - unary synthesis into typed `image_generation_calls` (including
 *     materializing a URL-only item), with all six UnifiedUsage fields;
 *   - stream synthesis: one chunk per image pairing the chat-format markdown
 *     on `delta.content` with the chunk-level typed carry, then a finish
 *     chunk carrying `usage`.
 */

import { beforeEach, describe, expect, test, vi } from 'vitest';

import { registerSpy } from '../../../../test/test-utils';
import type { PlexusConfig } from '../../../config';
import { ImageRequestValidationError } from '../../../transformers/image';
import { MAX_INLINE_IMAGE_BASE64_CHARS } from '../../../transformers/image-rendering';
import type { UnifiedChatRequest, UnifiedImageGenerationResponse } from '../../../types/unified';
import { logger } from '../../../utils/logger';
import type { RouteResult } from '../../routing/router';
import type { ImageBridgeHost } from '../image-model-bridge';
import {
  bridgeChatToImageGeneration,
  buildImageRequestFromChat,
  isImageModelRoute,
  resetImageBridgeWarningsForTesting,
  synthesizeChatResponse,
  synthesizeChatStream,
} from '../image-model-bridge';

/** base64 for "hello" — small enough to inline, sniffs to the png default. */
const TINY_IMAGE_B64 = 'aGVsbG8=';

function candidate(overrides: Partial<RouteResult> = {}): RouteResult {
  return {
    provider: 'codex',
    model: 'gpt-image-2',
    config: {} as any,
    canonicalModel: 'image_alias',
    ...overrides,
  } as RouteResult;
}

function configWithModels(models: Record<string, any>): PlexusConfig {
  return { models } as unknown as PlexusConfig;
}

function chatRequest(overrides: Partial<UnifiedChatRequest> = {}): UnifiedChatRequest {
  return {
    model: 'image_alias',
    messages: [{ role: 'user', content: 'a watercolor fox' }],
    ...overrides,
  } as UnifiedChatRequest;
}

function imageResponse(
  overrides: Partial<UnifiedImageGenerationResponse> = {}
): UnifiedImageGenerationResponse {
  return {
    created: 1700000000,
    data: [{ b64_json: TINY_IMAGE_B64 }],
    usage: { input_tokens: 7, output_tokens: 3, total_tokens: 10 },
    plexus: { provider: 'codex', model: 'gpt-image-2', apiType: 'images' },
    ...overrides,
  };
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

describe('isImageModelRoute', () => {
  beforeEach(() => {
    resetImageBridgeWarningsForTesting();
  });

  test('bridges when the resolved alias declares type: image', () => {
    const candidates = [candidate({ modelConfig: undefined })];
    const config = configWithModels({ image_alias: { type: 'image' } });

    expect(isImageModelRoute(chatRequest(), candidates, config)).toBe(true);
  });

  test('bridges when every candidate model is typed image without an alias type', () => {
    const candidates = [
      candidate({ modelConfig: { type: 'image' } as any }),
      candidate({
        provider: 'openai',
        model: 'gpt-image-1',
        modelConfig: { type: 'image' } as any,
      }),
    ];
    const config = configWithModels({ image_alias: {} });

    expect(isImageModelRoute(chatRequest(), candidates, config)).toBe(true);
  });

  test('does NOT bridge a mixed candidate set with no alias-level type, and warns naming the alias', () => {
    const candidates = [
      candidate({ modelConfig: { type: 'image' } as any }),
      candidate({ provider: 'openai', model: 'gpt-4o', modelConfig: {} as any }),
    ];
    const config = configWithModels({ image_alias: {} });

    expect(isImageModelRoute(chatRequest(), candidates, config)).toBe(false);
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(expect.stringContaining('image_alias'));
  });

  test('warns once per alias, not once per request', () => {
    const mixed = (canonicalModel: string) => [
      candidate({ canonicalModel, modelConfig: { type: 'image' } as any }),
      candidate({ canonicalModel, provider: 'openai', model: 'gpt-4o', modelConfig: {} as any }),
    ];
    const config = configWithModels({ image_alias: {}, other_alias: {} });

    for (let i = 0; i < 5; i++) {
      expect(isImageModelRoute(chatRequest(), mixed('image_alias'), config)).toBe(false);
    }
    expect(vi.mocked(logger.warn)).toHaveBeenCalledTimes(1);

    // A different alias is still worth warning about once.
    expect(
      isImageModelRoute(chatRequest({ model: 'other_alias' }), mixed('other_alias'), config)
    ).toBe(false);
    expect(vi.mocked(logger.warn)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(logger.warn)).toHaveBeenLastCalledWith(expect.stringContaining('other_alias'));
  });

  test('does NOT bridge an ordinary chat alias', () => {
    const candidates = [candidate({ canonicalModel: 'chat_alias', modelConfig: {} as any })];
    const config = configWithModels({ chat_alias: {} });

    expect(isImageModelRoute(chatRequest({ model: 'chat_alias' }), candidates, config)).toBe(false);
    expect(vi.mocked(logger.warn)).not.toHaveBeenCalled();
  });

  test('ignores request.tools entirely: an image_generation tool on a chat alias does not bridge', () => {
    const candidates = [candidate({ canonicalModel: 'chat_alias', modelConfig: {} as any })];
    const config = configWithModels({ chat_alias: {} });
    const request = chatRequest({
      model: 'chat_alias',
      tools: [{ type: 'image_generation' } as any],
    });

    expect(isImageModelRoute(request, candidates, config)).toBe(false);
  });

  test('ignores request.tools entirely: an image alias bridges even with tools present', () => {
    const candidates = [candidate()];
    const config = configWithModels({ image_alias: { type: 'image' } });
    const request = chatRequest({ tools: [{ type: 'image_generation' } as any] });

    expect(isImageModelRoute(request, candidates, config)).toBe(true);
  });

  test('never bridges an internal vision-descriptor request', () => {
    const candidates = [candidate()];
    const config = configWithModels({ image_alias: { type: 'image' } });
    const request = chatRequest();
    (request as any)._isVisionDescriptorRequest = true;

    expect(isImageModelRoute(request, candidates, config)).toBe(false);
  });

  test('does not bridge an empty candidate list', () => {
    expect(isImageModelRoute(chatRequest(), [], configWithModels({}))).toBe(false);
  });
});

describe('buildImageRequestFromChat', () => {
  test('takes the LAST user message as the prompt and defaults n to 1', () => {
    const request = chatRequest({
      messages: [
        { role: 'user', content: 'first idea' },
        { role: 'assistant', content: 'sure' },
        { role: 'user', content: 'a watercolor fox' },
      ],
    });

    const imageRequest = buildImageRequestFromChat(request);

    expect(imageRequest.prompt).toBe('a watercolor fox');
    expect(imageRequest.n).toBe(1);
    expect(imageRequest.model).toBe('image_alias');
    expect(imageRequest.incomingApiType).toBe('images');
  });

  test('joins text parts and turns image_url parts into input_references (media_type preserved)', () => {
    const request = chatRequest({
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'make this' },
            {
              type: 'image_url',
              image_url: { url: 'https://cdn.example.com/ref.png' },
              media_type: 'image/png',
            },
            { type: 'text', text: 'look like a watercolor' },
          ],
        },
      ],
    });

    const imageRequest = buildImageRequestFromChat(request);

    expect(imageRequest.prompt).toBe('make this\nlook like a watercolor');
    expect(imageRequest.input_references).toEqual([
      {
        type: 'image_url',
        image_url: { url: 'https://cdn.example.com/ref.png' },
        media_type: 'image/png',
      },
    ]);
  });

  test('leaves size/quality/background/output_format unset so alias extraBody and target defaults apply', () => {
    const imageRequest = buildImageRequestFromChat(chatRequest());

    expect(imageRequest.size).toBeUndefined();
    expect(imageRequest.quality).toBeUndefined();
    expect(imageRequest.background).toBeUndefined();
    expect(imageRequest.output_format).toBeUndefined();
    expect(imageRequest.response_format).toBeUndefined();
  });

  test('copies requestId and metadata verbatim so key policy and quota context still apply', () => {
    const metadata = {
      plexus_metadata: {
        plexus_key_policy: { mode: 'allow' } as any,
        plexus_quota_context: { keyName: 'k' } as any,
      },
    };
    const request = chatRequest({ requestId: 'req-1', metadata });

    const imageRequest = buildImageRequestFromChat(request);

    expect(imageRequest.requestId).toBe('req-1');
    expect(imageRequest.metadata).toBe(metadata);
  });

  test('summarizes originalBody instead of copying the chat body (already logged by the route)', () => {
    const request = chatRequest({ originalBody: { messages: [{ huge: 'payload' }] } });

    const imageRequest = buildImageRequestFromChat(request);

    expect(imageRequest.originalBody).not.toEqual(request.originalBody);
    expect(imageRequest.originalBody).toMatchObject({ bridged_from: 'chat', model: 'image_alias' });
  });

  test('uses the legacy completions `prompt` field when the client is a completions client', () => {
    const request = chatRequest({
      incomingApiType: 'completions',
      prompt: 'a watercolor fox',
      messages: [
        { role: 'system', content: 'You are an inline code completion assistant.' },
        { role: 'user', content: 'a watercolor fox' },
      ],
    });

    expect(buildImageRequestFromChat(request).prompt).toBe('a watercolor fox');
  });

  test('rejects a request with no usable prompt as a 400', () => {
    const request = chatRequest({ messages: [{ role: 'assistant', content: 'nothing to draw' }] });

    expect(() => buildImageRequestFromChat(request)).toThrow(ImageRequestValidationError);
    try {
      buildImageRequestFromChat(request);
    } catch (error) {
      expect((error as ImageRequestValidationError).routingContext.statusCode).toBe(400);
    }
  });

  test('rejects a last user message whose parts carry no text', () => {
    const request = chatRequest({
      messages: [
        {
          role: 'user',
          content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,AA==' } }],
        },
      ],
    });

    expect(() => buildImageRequestFromChat(request)).toThrow(ImageRequestValidationError);
  });
});

describe('synthesizeChatResponse', () => {
  test('returns typed image items, a stop finish and all six usage fields', async () => {
    const source = imageResponse();

    const response = await synthesizeChatResponse(source, chatRequest());

    expect(response.id).toMatch(/^imgbridge_/);
    expect(response.model).toBe('image_alias');
    expect(response.content).toBeNull();
    expect(response.finishReason).toBe('stop');
    expect(response.image_generation_calls).toHaveLength(1);
    expect(response.image_generation_calls![0]).toMatchObject({
      status: 'completed',
      result: TINY_IMAGE_B64,
    });
    expect(response.image_generation_calls![0]!.id).toMatch(/^ig_/);
    expect(response.usage).toEqual({
      input_tokens: 7,
      output_tokens: 3,
      total_tokens: 10,
      reasoning_tokens: 0,
      cached_tokens: 0,
      cache_creation_tokens: 0,
    });
    expect(response.plexus).toBe(source.plexus);
  });

  test('normalizes prompt_tokens/completion_tokens image usage into unified usage', async () => {
    const response = await synthesizeChatResponse(
      imageResponse({ usage: { prompt_tokens: 4, completion_tokens: 6 } }),
      chatRequest()
    );

    expect(response.usage).toEqual({
      input_tokens: 4,
      output_tokens: 6,
      total_tokens: 10,
      reasoning_tokens: 0,
      cached_tokens: 0,
      cache_creation_tokens: 0,
    });
  });

  test('materializes a URL-only image item into base64', async () => {
    const fetchSpy = registerSpy(global, 'fetch').mockResolvedValue(
      new Response(Buffer.from('hello'), {
        status: 200,
        headers: { 'content-type': 'image/png' },
      }) as any
    );

    const response = await synthesizeChatResponse(
      imageResponse({ data: [{ url: 'https://cdn.example.com/out.png' }] }),
      chatRequest()
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(response.image_generation_calls![0]!.result).toBe(TINY_IMAGE_B64);
  });
});

describe('synthesizeChatStream', () => {
  test('pairs the chat-format markdown delta with the chunk-level typed carry, then finishes with usage', async () => {
    const streamed = await synthesizeChatStream(imageResponse(), chatRequest());

    expect(streamed.content).toBeNull();
    expect(streamed.bypassTransformation).toBe(false);
    expect(streamed.stream).toBeInstanceOf(ReadableStream);

    const chunks = await collectChunks(streamed.stream as ReadableStream);
    expect(chunks).toHaveLength(2);

    const [imageChunk, finishChunk] = chunks;
    expect(imageChunk.delta).toEqual({
      role: 'assistant',
      content: `![generated image](data:image/png;base64,${TINY_IMAGE_B64})`,
    });
    expect(imageChunk.image_generation_calls).toHaveLength(1);
    expect(imageChunk.image_generation_calls[0].result).toBe(TINY_IMAGE_B64);
    // Chunk-level, never inside `delta`: chat formatters forward `delta` by
    // reference and would leak the base64 onto the wire.
    expect(imageChunk.delta.image_generation_calls).toBeUndefined();
    expect(imageChunk.finish_reason).toBeNull();
    expect(imageChunk.id).toBe(streamed.id);
    expect(imageChunk.model).toBe('image_alias');

    expect(finishChunk.delta).toEqual({});
    expect(finishChunk.finish_reason).toBe('stop');
    expect(finishChunk.usage).toEqual({
      input_tokens: 7,
      output_tokens: 3,
      total_tokens: 10,
      reasoning_tokens: 0,
      cached_tokens: 0,
      cache_creation_tokens: 0,
    });
  });

  test('emits one paired chunk per image', async () => {
    const streamed = await synthesizeChatStream(
      imageResponse({ data: [{ b64_json: TINY_IMAGE_B64 }, { b64_json: TINY_IMAGE_B64 }] }),
      chatRequest()
    );

    const chunks = await collectChunks(streamed.stream as ReadableStream);
    expect(chunks).toHaveLength(3);
    expect(chunks.slice(0, 2).every((chunk) => chunk.image_generation_calls.length === 1)).toBe(
      true
    );
  });

  test('renders the oversized-image placeholder on content while the typed carry stays byte-intact', async () => {
    const oversized = 'A'.repeat(MAX_INLINE_IMAGE_BASE64_CHARS + 1);

    const streamed = await synthesizeChatStream(
      imageResponse({ data: [{ b64_json: oversized }] }),
      chatRequest()
    );

    const [imageChunk] = await collectChunks(streamed.stream as ReadableStream);
    expect(imageChunk.delta.content).toMatch(
      /^\[generated image omitted: .* exceeds inline limit\]$/
    );
    expect(imageChunk.image_generation_calls[0].result).toBe(oversized);
  });
});

describe('bridgeChatToImageGeneration', () => {
  let dispatchImageGenerations: ReturnType<typeof vi.fn>;
  let host: ImageBridgeHost;

  beforeEach(() => {
    dispatchImageGenerations = vi.fn(async () => imageResponse());
    host = { dispatchImageGenerations } as unknown as ImageBridgeHost;
  });

  test('dispatches the built image request and synthesizes a unary response', async () => {
    const response = await bridgeChatToImageGeneration(
      chatRequest({ requestId: 'req-9' }),
      [candidate()],
      host
    );

    expect(dispatchImageGenerations).toHaveBeenCalledTimes(1);
    expect(dispatchImageGenerations.mock.calls[0]![0]).toMatchObject({
      model: 'image_alias',
      prompt: 'a watercolor fox',
      n: 1,
      incomingApiType: 'images',
      requestId: 'req-9',
    });
    expect(response.stream).toBeUndefined();
    expect(response.image_generation_calls).toHaveLength(1);
  });

  test('forwards caller cancellation and provider deadline resolution', async () => {
    const signal = new AbortController().signal;
    const resolveTimeoutMs = () => 1234;
    await bridgeChatToImageGeneration(chatRequest(), [candidate()], host, signal, resolveTimeoutMs);
    expect(dispatchImageGenerations).toHaveBeenCalledWith(
      expect.any(Object),
      signal,
      resolveTimeoutMs
    );
  });

  test('synthesizes a stream when the chat request asked for one', async () => {
    const response = await bridgeChatToImageGeneration(
      chatRequest({ stream: true }),
      [candidate()],
      host
    );

    expect(response.stream).toBeInstanceOf(ReadableStream);
    expect(await collectChunks(response.stream as ReadableStream)).toHaveLength(2);
  });

  test('propagates image-pipeline errors unchanged', async () => {
    const failure = Object.assign(new Error('nope'), { routingContext: { statusCode: 429 } });
    dispatchImageGenerations.mockRejectedValue(failure);

    await expect(bridgeChatToImageGeneration(chatRequest(), [candidate()], host)).rejects.toBe(
      failure
    );
  });
});
