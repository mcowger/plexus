import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';

import { setConfigForTesting } from '../../config';
import { UnifiedSpeechRequest } from '../../types/unified';
import { Dispatcher } from '../dispatch/dispatcher';
import { CooldownManager } from '../runtime/cooldown-manager';

const fetchMock = mock(async (url: string, options: any) => {
  return new Response(Buffer.from([0x01, 0x02, 0x03, 0x04]), {
    status: 200,
    headers: { 'Content-Type': 'audio/mpeg' },
  });
});
beforeEach(() => {
  spyOn(globalThis, 'fetch').mockImplementation(fetchMock as any);
});

describe('Dispatcher Speech extra_body', () => {
  beforeEach(async () => {
    fetchMock.mockClear();
    await CooldownManager.getInstance().clearCooldown();
  });

  afterEach(async () => {
    await CooldownManager.getInstance().clearCooldown();
  });

  test('respects configured extra_body with speed and other params', async () => {
    const mockConfig = {
      providers: {
        'openai-s': {
          api_base_url: 'https://api.openai.com/v1',
          api_key: 'test-key-123',
          enabled: true,
          models: {
            'gpt-4o-mini-tts': {
              pricing: { source: 'simple', input: 0, output: 0 },
              type: 'speech',
              access_via: ['speech'],
              extraBody: {
                speed: 1.5,
                custom_param: 'hello-world',
              },
            },
          },
        },
      },
      models: {
        'gpt-4o-mini-tts': {
          target_groups: [
            {
              name: 'default',
              selector: 'random',
              targets: [
                {
                  provider: 'openai-s',
                  model: 'gpt-4o-mini-tts',
                  enabled: true,
                },
              ],
            },
          ],
          priority: 'selector',
          type: 'speech',
          additional_aliases: ['tts-1'],
        },
      },
      keys: {},
    };

    setConfigForTesting(mockConfig as any);

    const dispatcher = new Dispatcher();
    const request: UnifiedSpeechRequest = {
      model: 'gpt-4o-mini-tts',
      input: 'And that is how goats helped discover coffee!',
      voice: 'alloy',
      requestId: 'test-speech-request-id',
      incomingApiType: 'speech',
    };

    const response = await dispatcher.dispatchSpeech(request);

    expect(response).toBeDefined();
    expect(response.audio).toBeDefined();

    expect(fetchMock).toHaveBeenCalled();
    const fetchArgs = fetchMock.mock.calls[0]!;
    const url = fetchArgs[0] as string;
    const options = fetchArgs[1] as any;

    expect(url).toBe('https://api.openai.com/v1/audio/speech');
    const payload = JSON.parse(options.body);

    // Verify that the speed: 1.5 from model level extraBody is merged and overwrites the default 1.0
    expect(payload.speed).toBe(1.5);
    expect(payload.custom_param).toBe('hello-world');
    expect(payload.voice).toBe('alloy');
    expect(payload.input).toBe('And that is how goats helped discover coffee!');
  });
});
