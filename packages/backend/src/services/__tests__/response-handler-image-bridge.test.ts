/**
 * The bridged stream must survive the REAL response-handler pipeline.
 *
 * Bridged output is unusual in one specific way: its `stream` carries unified
 * chunk OBJECTS, not provider SSE bytes, because the auto-bridge synthesized
 * them itself (there is no provider wire). Two things in
 * services/responses/response-handler.ts have to cope with that, and both are
 * keyed off `plexus.apiType = 'images'`:
 *   - `TransformerFactory.getTransformer('images')` must resolve (it throws
 *     for anything it does not know) and must NOT define `transformStream`,
 *     so the unified chunks reach the client formatter untouched;
 *   - the raw debug/usage tap is a Node PassThrough, which THROWS when an
 *     object is written to a non-objectMode stream — that would tear down the
 *     client's response mid-flight.
 *
 * This drives the real handleResponse with a real client transformer to prove
 * the bytes a chat client actually receives.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { OpenAITransformer } from '../../transformers/openai';
import type { UnifiedChatRequest, UnifiedImageGenerationResponse } from '../../types/unified';
import type { UsageRecord } from '../../types/usage';
import { logger } from '../../utils/logger';
import { synthesizeChatStream } from '../dispatch/image-model-bridge';
import type { UsageStorageService } from '../observability/usage-storage';
import { handleResponse } from '../responses/response-handler';

const TINY_IMAGE_B64 = 'aGVsbG8=';

const mockStorage = {
  saveRequest: vi.fn(),
  saveError: vi.fn(),
  updatePerformanceMetrics: vi.fn(),
  registerInFlight: vi.fn(),
} as unknown as UsageStorageService;

const mockReply = {
  send: vi.fn(function (this: any) {
    return this;
  }),
  header: vi.fn(function (this: any) {
    return this;
  }),
  code: vi.fn(function (this: any) {
    return this;
  }),
} as unknown as FastifyReply;

const mockRequest = { id: 'image-bridge-req' } as unknown as FastifyRequest;

function drainNodeStream(stream: any): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    stream.on('data', (chunk: any) => {
      body += chunk.toString();
    });
    stream.once('end', () => resolve(body));
    stream.once('error', reject);
  });
}

describe('handleResponse with bridged image output', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('streams the bridged unified chunks through the real client formatter', async () => {
    const imageResponse: UnifiedImageGenerationResponse = {
      created: 1700000000,
      data: [{ b64_json: TINY_IMAGE_B64 }],
      usage: { input_tokens: 7, output_tokens: 3, total_tokens: 10 },
      plexus: { provider: 'codex', model: 'gpt-image-2', apiType: 'images' },
    };
    const unifiedResponse = await synthesizeChatStream(imageResponse, {
      model: 'image_alias',
      messages: [{ role: 'user', content: 'a watercolor fox' }],
      stream: true,
    } as UnifiedChatRequest);

    const usageRecord: Partial<UsageRecord> = { requestId: 'image-bridge-req' };

    await handleResponse(
      mockRequest,
      mockReply,
      unifiedResponse,
      new OpenAITransformer(),
      usageRecord,
      mockStorage,
      Date.now(),
      'chat'
    );

    const pipeline = (mockReply.send as any).mock.calls.at(-1)[0];
    const body = await drainNodeStream(pipeline);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(body).toContain(`![generated image](data:image/png;base64,${TINY_IMAGE_B64})`);
    expect(body).toContain('"finish_reason":"stop"');
    expect(body).toContain('data: [DONE]');
    expect(usageRecord.outgoingApiType).toBe('images');
    expect(usageRecord.responseStatus).not.toBe('error');
    expect(vi.mocked(logger.warn)).not.toHaveBeenCalledWith(
      expect.stringContaining('Unknown providerApiType')
    );
  });
});
