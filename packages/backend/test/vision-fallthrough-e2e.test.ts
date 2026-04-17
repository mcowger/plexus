import { expect, test, describe, beforeEach, afterEach, vi } from 'vitest';
import { registerSpy } from './test-utils';
import { Dispatcher } from '../src/services/dispatcher';
import { VisionDescriptorService } from '../src/services/vision-descriptor-service';
import { Router } from '../src/services/router';
import * as configModule from '../src/config';

const BASE_TEST_CONFIG = {
  providers: {},
  models: {},
  keys: {},
  failover: {
    enabled: false,
    retryableStatusCodes: [429, 500, 502, 503, 504],
    retryableErrors: ['ECONNREFUSED', 'ETIMEDOUT'],
  },
  quotas: [],
  cooldown: { initialMinutes: 1, maxMinutes: 5 },
};

describe('Vision Fallthrough E2E', () => {
  // Store the original config to restore after tests
  let originalConfig: any;

  beforeEach(() => {
    // Ensure this worker always has a baseline config, even under parallel forks
    configModule.setConfigForTesting(BASE_TEST_CONFIG as any);
    originalConfig = BASE_TEST_CONFIG;
  });

  afterEach(() => {
    // Restore original config to prevent pollution of other tests
    configModule.setConfigForTesting(originalConfig);
  });

  test('Dispatcher triggers vision fallthrough when enabled', async () => {
    // 1. Mock the config to enable fallthrough for an alias
    const mockConfig = {
      providers: {
        'test-provider': {
          api_base_url: 'https://api.test.com',
          api_key: 'test-key',
          models: ['text-model', 'vision-model'],
          enabled: true,
        },
      },
      models: {
        'text-only-alias': {
          use_image_fallthrough: true,
          targets: [{ provider: 'test-provider', model: 'text-model', enabled: true }],
        },
      },
      vision_fallthrough: {
        descriptor_model: 'vision-model',
      },
      failover: { enabled: false },
      cooldown: { initialMinutes: 1, maxMinutes: 5 },
    };

    configModule.setConfigForTesting(mockConfig as any);

    // 2. Mock VisionDescriptorService.process to return a modified request
    const processSpy = registerSpy(VisionDescriptorService, 'process').mockImplementation(
      async (req: any) => {
        return {
          ...req,
          messages: [
            {
              role: 'user',
              content: [{ type: 'text', text: 'This is a description of an image.' }],
            },
          ],
        } as any;
      }
    );

    // 3. Mock Router.resolveCandidates to return a valid candidate with the modelConfig
    registerSpy(Router, 'resolveCandidates').mockResolvedValue([
      {
        provider: 'test-provider',
        model: 'text-model',
        config: mockConfig.providers['test-provider'] as any,
        modelConfig: mockConfig.models['text-only-alias'],
        incomingModelAlias: 'text-only-alias',
        canonicalModel: 'text-only-alias',
      },
    ]);

    // 4. Mock Dispatcher internal methods to prevent actual network calls
    const dispatcher = new Dispatcher();
    registerSpy(dispatcher as any, 'selectTargetApiType').mockReturnValue({
      targetApiType: 'chat',
      selectionReason: 'test',
    });

    // Mock the actual execution to return success
    registerSpy(dispatcher as any, 'executeProviderRequest').mockImplementation(async () => {
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'I see the description.' } }] }),
        text: async () => '{}',
        status: 200,
        headers: new Headers(),
      } as any;
    });

    // 4. Dispatch a request with an image
    const request = {
      model: 'text-only-alias',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'What is this?' },
            {
              type: 'image_url',
              image_url: {
                url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
              },
            },
          ],
        },
      ],
    };

    await dispatcher.dispatch(request as any);

    // 5. Verify the descriptor service was called
    expect(processSpy).toHaveBeenCalled();
  });
});
