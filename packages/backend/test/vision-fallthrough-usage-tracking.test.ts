/**
 * Tests that would have caught:
 * 1. visionFallthroughModel not being stored in the parent request's usage record
 * 2. The child descriptor request never being saved to usage storage
 */
import { expect, test, describe, mock } from 'bun:test';
import { registerSpy } from './test-utils';
import { VisionDescriptorService } from '../src/services/vision-descriptor-service';
import { Dispatcher } from '../src/services/dispatcher';
import { UsageStorageService } from '../src/services/usage-storage';
import * as configModule from '../src/config';

// ---------------------------------------------------------------------------
// Bug 1: visionFallthroughModel not recorded on the parent request
// ---------------------------------------------------------------------------

describe('Dispatcher: visionFallthroughModel propagation', () => {
  test('recordAttemptMetric receives visionFallthroughModel after fallthrough triggers', async () => {
    const descriptorModel = 'gpt-4o-vision';

    const mockConfig = {
      providers: {
        testprovider: {
          api_base_url: 'https://api.test.com/v1',
          api_key: 'key',
          models: ['non-vision-model'],
          enabled: true,
        },
      },
      models: {
        'non-vision-model': {
          use_image_fallthrough: true,
          targets: [{ provider: 'testprovider', model: 'non-vision-model', enabled: true }],
        },
      },
      vision_fallthrough: {
        descriptor_model: descriptorModel,
      },
      failover: { enabled: false },
      cooldown: { initialMinutes: 1, maxMinutes: 5 },
    };

    registerSpy(configModule, 'getConfig').mockReturnValue(mockConfig as any);

    // Intercept VisionDescriptorService.process so we can check what it was called with
    // and tag the request the same way the real implementation does
    registerSpy(VisionDescriptorService, 'process').mockImplementation(async (req) => {
      return { ...req, messages: [{ role: 'user', content: 'described' }] } as any;
    });

    const dispatcher = new Dispatcher();

    // Capture what metadata recordAttemptMetric receives
    const capturedMetadata: any[] = [];
    registerSpy(dispatcher as any, 'recordAttemptMetric').mockImplementation(
      async (_route: any, _requestId: any, _success: any, metadata: any) => {
        capturedMetadata.push(metadata);
      }
    );

    registerSpy(dispatcher as any, 'selectTargetApiType').mockReturnValue({
      targetApiType: 'chat',
      selectionReason: 'test',
    });
    registerSpy(dispatcher as any, 'executeProviderRequest').mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        id: 'r1',
        object: 'chat.completion',
        choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
      text: async () => '{}',
    } as any);

    const request = {
      model: 'non-vision-model',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: 'data:image/png;base64,abc' } },
          ],
        },
      ],
    };

    await dispatcher.dispatch(request as any);

    expect(capturedMetadata.length).toBeGreaterThan(0);
    const meta = capturedMetadata[0];
    expect(meta).toBeDefined();
    expect(meta.isVisionFallthrough).toBe(true);
    // This is the key assertion: the descriptor model name must be present
    expect(meta.visionFallthroughModel).toBe(descriptorModel);
  });

  test('visionFallthroughModel is undefined when fallthrough did not trigger', async () => {
    const mockConfig = {
      providers: {
        testprovider: {
          api_base_url: 'https://api.test.com/v1',
          api_key: 'key',
          models: ['text-only-model'],
          enabled: true,
        },
      },
      models: {
        'text-only-model': {
          use_image_fallthrough: false,
          targets: [{ provider: 'testprovider', model: 'text-only-model', enabled: true }],
        },
      },
      failover: { enabled: false },
      cooldown: { initialMinutes: 1, maxMinutes: 5 },
    };

    registerSpy(configModule, 'getConfig').mockReturnValue(mockConfig as any);

    const dispatcher = new Dispatcher();
    const capturedMetadata: any[] = [];
    registerSpy(dispatcher as any, 'recordAttemptMetric').mockImplementation(
      async (_route: any, _requestId: any, _success: any, metadata: any) => {
        capturedMetadata.push(metadata);
      }
    );
    registerSpy(dispatcher as any, 'selectTargetApiType').mockReturnValue({
      targetApiType: 'chat',
      selectionReason: 'test',
    });
    registerSpy(dispatcher as any, 'executeProviderRequest').mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        id: 'r2',
        object: 'chat.completion',
        choices: [{ message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
      }),
      text: async () => '{}',
    } as any);

    await dispatcher.dispatch({
      model: 'text-only-model',
      messages: [{ role: 'user', content: 'hello' }],
    } as any);

    expect(capturedMetadata.length).toBeGreaterThan(0);
    expect(capturedMetadata[0].visionFallthroughModel).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Bug 2: Child descriptor request never saved to usage storage
// ---------------------------------------------------------------------------

describe('VisionDescriptorService: child request usage logging', () => {
  const imageUrl =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

  const makeRequest = () => ({
    model: 'descriptor-model',
    messages: [
      {
        role: 'user',
        content: [{ type: 'image_url', image_url: { url: imageUrl } }],
      },
    ],
    incomingApiType: 'chat' as const,
  });

  const mockResponse = {
    id: 'desc-resp-1',
    model: 'gpt-4o',
    content: 'A 1x1 pixel PNG image.',
    usage: {
      input_tokens: 20,
      output_tokens: 10,
      total_tokens: 30,
      reasoning_tokens: 0,
      cached_tokens: 0,
      cache_creation_tokens: 0,
    },
    plexus: {
      provider: 'openai',
      model: 'gpt-4o',
      apiType: 'chat',
      canonicalModel: 'gpt-4o',
      pricing: null,
    },
  };

  test('saveRequest is called for the descriptor child request on success', async () => {
    const savedRecords: any[] = [];
    const mockStorage = {
      saveRequest: mock(async (record: any) => {
        savedRecords.push(record);
      }),
    } as unknown as UsageStorageService;

    // Mock the internal Dispatcher so we don't need a live provider
    registerSpy(Dispatcher.prototype, 'dispatch').mockResolvedValue(mockResponse as any);

    const request = makeRequest();
    await VisionDescriptorService.process(
      request as any,
      'gpt-4o',
      'Describe this image.',
      mockStorage
    );

    // saveRequest must have been called for the descriptor child request
    expect(savedRecords.length).toBeGreaterThan(0);

    const record = savedRecords[0];
    expect(record.isDescriptorRequest).toBe(true);
    expect(record.responseStatus).toBe('success');
    expect(record.requestId).toMatch(/^desc-/);
  });

  test('saveRequest records correct provider and model from the response', async () => {
    const savedRecords: any[] = [];
    const mockStorage = {
      saveRequest: mock(async (record: any) => {
        savedRecords.push(record);
      }),
    } as unknown as UsageStorageService;

    registerSpy(Dispatcher.prototype, 'dispatch').mockResolvedValue(mockResponse as any);

    await VisionDescriptorService.process(
      makeRequest() as any,
      'gpt-4o',
      'Describe this.',
      mockStorage
    );

    const record = savedRecords[0];
    expect(record.provider).toBe('openai');
    expect(record.selectedModelName).toBe('gpt-4o');
  });

  test('saveRequest records token counts from the response', async () => {
    const savedRecords: any[] = [];
    const mockStorage = {
      saveRequest: mock(async (record: any) => {
        savedRecords.push(record);
      }),
    } as unknown as UsageStorageService;

    registerSpy(Dispatcher.prototype, 'dispatch').mockResolvedValue(mockResponse as any);

    await VisionDescriptorService.process(
      makeRequest() as any,
      'gpt-4o',
      'Describe this.',
      mockStorage
    );

    const record = savedRecords[0];
    expect(record.tokensInput).toBe(20);
    expect(record.tokensOutput).toBe(10);
  });

  test('saveRequest is called with error status when dispatch throws', async () => {
    const savedRecords: any[] = [];
    const mockStorage = {
      saveRequest: mock(async (record: any) => {
        savedRecords.push(record);
      }),
    } as unknown as UsageStorageService;

    registerSpy(Dispatcher.prototype, 'dispatch').mockRejectedValue(
      new Error('Provider unavailable')
    );

    await VisionDescriptorService.process(
      makeRequest() as any,
      'gpt-4o',
      'Describe this.',
      mockStorage
    );

    expect(savedRecords.length).toBeGreaterThan(0);
    const record = savedRecords[0];
    expect(record.isDescriptorRequest).toBe(true);
    expect(record.responseStatus).toBe('error');
    expect(record.requestId).toMatch(/^desc-/);
  });

  test('no saveRequest call when usageStorage is not provided', async () => {
    // Should complete without error and not attempt to save anything
    registerSpy(Dispatcher.prototype, 'dispatch').mockResolvedValue(mockResponse as any);

    // No usageStorage passed — process should not throw
    await expect(
      VisionDescriptorService.process(makeRequest() as any, 'gpt-4o', 'Describe this.')
    ).resolves.toBeDefined();
  });
});
