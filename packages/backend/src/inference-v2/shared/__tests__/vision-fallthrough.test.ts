import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as piAi from '@earendil-works/pi-ai/compat';
import { setConfigForTesting } from '../../../config';
import {
  applyVisionFallthrough,
  clearVisionFallthroughCacheForTesting,
  contextHasImages,
} from '../vision-fallthrough';
import type { UsageStorageService } from '../../../services/usage-storage';
import type { Context } from '@earendil-works/pi-ai';

function createUsageStorage(): UsageStorageService {
  return {
    saveRequest: vi.fn(async () => undefined),
  } as unknown as UsageStorageService;
}

const IMAGE_DATA_A =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const IMAGE_DATA_B =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJgg1';

describe('contextHasImages', () => {
  it('detects images in user message content', () => {
    const context: Context = {
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'what is this?' },
            { type: 'image', mimeType: 'image/png', data: IMAGE_DATA_A },
          ],
          timestamp: Date.now(),
        },
      ],
    };
    expect(contextHasImages(context)).toBe(true);
  });

  it('returns false when there are no images', () => {
    const context: Context = {
      messages: [{ role: 'user', content: 'hello', timestamp: Date.now() }],
    };
    expect(contextHasImages(context)).toBe(false);
  });

  it('returns false for string content', () => {
    const context: Context = {
      messages: [{ role: 'user', content: 'plain text', timestamp: Date.now() }],
    };
    expect(contextHasImages(context)).toBe(false);
  });
});

describe('applyVisionFallthrough', () => {
  beforeEach(() => {
    clearVisionFallthroughCacheForTesting();
    setConfigForTesting({
      providers: {
        descriptor: {
          api_base_url: 'https://api.openai.com/v1',
          api_key: 'sk-test',
          pi_ai_provider: 'openai-codex',
          models: {
            'gpt-4o': {
              pricing: { source: 'simple', input: 0, output: 0 },
              pi_ai_model_id: 'gpt-4o',
            },
          },
        },
      },
      models: {
        'gpt-4o': {
          priority: 'selector',
          targets: [{ provider: 'descriptor', model: 'gpt-4o' }],
        },
      },
      keys: {},
      failover: { enabled: false, retryableStatusCodes: [], retryableErrors: [] },
      quotas: [],
    } as any);
  });

  it('returns the same context reference when there are no images', async () => {
    const context: Context = {
      messages: [{ role: 'user', content: 'hello', timestamp: Date.now() }],
    };
    const result = await applyVisionFallthrough(context, 'gpt-4o', 'Describe this image.');
    expect(result).toBe(context);
  });

  it('replaces image blocks with text descriptions from the descriptor model', async () => {
    vi.mocked(piAi.complete).mockResolvedValueOnce({
      role: 'assistant',
      content: [{ type: 'text', text: 'A red square.' }],
      api: 'openai-codex-responses',
      provider: 'openai-codex',
      model: 'gpt-4o',
      usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0 },
      stopReason: 'stop',
      timestamp: Date.now(),
    } as any);

    const context: Context = {
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'What is this?' },
            { type: 'image', mimeType: 'image/png', data: IMAGE_DATA_A },
          ],
          timestamp: Date.now(),
        },
      ],
    };

    const usageStorage = createUsageStorage();
    const result = await applyVisionFallthrough(
      context,
      'gpt-4o',
      'Describe this image.',
      usageStorage
    );

    expect(contextHasImages(result)).toBe(false);
    const userMsg = result.messages[0] as any;
    expect(userMsg.content).toEqual([
      { type: 'text', text: 'What is this?' },
      { type: 'text', text: '[Image Description: A red square.]' },
    ]);
    // Original context must be untouched.
    expect(contextHasImages(context)).toBe(true);
    expect(usageStorage.saveRequest).toHaveBeenCalledWith(
      expect.objectContaining({ isDescriptorRequest: true, isVisionFallthrough: false })
    );
  });

  it('describes multiple images concurrently, preserving order', async () => {
    vi.mocked(piAi.complete)
      .mockResolvedValueOnce({
        role: 'assistant',
        content: [{ type: 'text', text: 'First image.' }],
        api: 'openai-codex-responses',
        provider: 'openai-codex',
        model: 'gpt-4o',
        usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0 },
        stopReason: 'stop',
        timestamp: Date.now(),
      } as any)
      .mockResolvedValueOnce({
        role: 'assistant',
        content: [{ type: 'text', text: 'Second image.' }],
        api: 'openai-codex-responses',
        provider: 'openai-codex',
        model: 'gpt-4o',
        usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0 },
        stopReason: 'stop',
        timestamp: Date.now(),
      } as any);

    const context: Context = {
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', mimeType: 'image/png', data: IMAGE_DATA_A },
            { type: 'text', text: 'and' },
            { type: 'image', mimeType: 'image/png', data: IMAGE_DATA_B },
          ],
          timestamp: Date.now(),
        },
      ],
    };

    const result = await applyVisionFallthrough(context, 'gpt-4o', 'Describe this image.');
    const userMsg = result.messages[0] as any;
    expect(userMsg.content).toEqual([
      { type: 'text', text: '[Image Description: First image.]' },
      { type: 'text', text: 'and' },
      { type: 'text', text: '[Image Description: Second image.]' },
    ]);
  });

  it('caches descriptions by (model, image hash) across calls', async () => {
    vi.mocked(piAi.complete).mockResolvedValueOnce({
      role: 'assistant',
      content: [{ type: 'text', text: 'Cached description.' }],
      api: 'openai-codex-responses',
      provider: 'openai-codex',
      model: 'gpt-4o',
      usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0 },
      stopReason: 'stop',
      timestamp: Date.now(),
    } as any);

    const makeContext = (): Context => ({
      messages: [
        {
          role: 'user',
          content: [{ type: 'image', mimeType: 'image/png', data: IMAGE_DATA_A }],
          timestamp: Date.now(),
        },
      ],
    });

    const callsBefore = vi.mocked(piAi.complete).mock.calls.length;
    const first = await applyVisionFallthrough(makeContext(), 'gpt-4o', 'Describe this image.');
    const second = await applyVisionFallthrough(makeContext(), 'gpt-4o', 'Describe this image.');

    expect(vi.mocked(piAi.complete).mock.calls.length).toBe(callsBefore + 1);
    expect((first.messages[0] as any).content[0].text).toBe(
      '[Image Description: Cached description.]'
    );
    expect((second.messages[0] as any).content[0].text).toBe(
      '[Image Description: Cached description.]'
    );
  });

  it('falls back to an error placeholder when the descriptor model has no route', async () => {
    const context: Context = {
      messages: [
        {
          role: 'user',
          content: [{ type: 'image', mimeType: 'image/png', data: IMAGE_DATA_B }],
          timestamp: Date.now(),
        },
      ],
    };

    const result = await applyVisionFallthrough(context, 'nonexistent-model', 'Describe.');
    expect((result.messages[0] as any).content[0].text).toBe(
      '[Image Description: Error generating image description.]'
    );
  });

  it('caches an empty descriptor response to avoid repeated wasted calls', async () => {
    vi.mocked(piAi.complete).mockResolvedValueOnce({
      role: 'assistant',
      content: [{ type: 'text', text: '' }],
      api: 'openai-codex-responses',
      provider: 'openai-codex',
      model: 'gpt-4o',
      usage: { input: 10, output: 0, cacheRead: 0, cacheWrite: 0 },
      stopReason: 'stop',
      timestamp: Date.now(),
    } as any);

    const makeContext = (): Context => ({
      messages: [
        {
          role: 'user',
          content: [{ type: 'image', mimeType: 'image/png', data: IMAGE_DATA_A }],
          timestamp: Date.now(),
        },
      ],
    });

    const callsBefore = vi.mocked(piAi.complete).mock.calls.length;
    const first = await applyVisionFallthrough(makeContext(), 'gpt-4o', 'Describe this image.');
    const second = await applyVisionFallthrough(makeContext(), 'gpt-4o', 'Describe this image.');

    // Only one descriptor call — the empty result is cached, not re-fetched.
    expect(vi.mocked(piAi.complete).mock.calls.length).toBe(callsBefore + 1);
    expect((first.messages[0] as any).content[0].text).toBe(
      '[Image Description: No description available.]'
    );
    expect((second.messages[0] as any).content[0].text).toBe(
      '[Image Description: No description available.]'
    );
  });
});
