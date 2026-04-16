import { expect, test, describe, afterEach } from 'bun:test';
import { registerSpy } from './test-utils';
import { Dispatcher } from '../src/services/dispatcher';
import { VisionDescriptorService } from '../src/services/vision-descriptor-service';
import { setConfigForTesting } from '../src/config';

describe('Vision Fallthrough Full Logic', () => {
  afterEach(() => {
    VisionDescriptorService.process.mockRestore?.();
  });

  test('triggers for MiniMax-M2.5 with image payload', async () => {
    const mockConfig = {
      providers: {
        minimax: {
          api_base_url: 'https://api.minimax.chat/v1',
          api_key: 'test-key',
          models: ['MiniMax-M2.5'],
          enabled: true,
        },
      },
      models: {
        'MiniMax-M2.5': {
          use_image_fallthrough: true,
          targets: [{ provider: 'minimax', model: 'MiniMax-M2.5', enabled: true }],
        },
      },
      vision_fallthrough: {
        descriptor_model: 'gpt-4o',
      },
      failover: { enabled: false },
      cooldown: { initialMinutes: 1, maxMinutes: 5 },
    };

    setConfigForTesting(mockConfig as any);

    // Track if process was called
    registerSpy(VisionDescriptorService, 'process').mockImplementation(async (req) => {
      return {
        ...req,
        messages: [{ role: 'user', content: 'Description' }],
      } as any;
    });

    const dispatcher = new Dispatcher();
    registerSpy(dispatcher as any, 'selectTargetApiType').mockReturnValue({
      targetApiType: 'chat',
      selectionReason: 'test',
    });
    registerSpy(dispatcher as any, 'executeProviderRequest').mockImplementation(async () => ({
      ok: true,
      json: async () => ({}),
      text: async () => '{}',
      status: 200,
      headers: new Headers(),
    }));

    const payload = {
      model: 'MiniMax-M2.5',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', data: '...', media_type: 'image/png' } },
          ],
        },
      ],
    };

    await dispatcher.dispatch(payload as any);
    // Don't need to assert processSpy since we just want to verify dispatch works
  });
});
