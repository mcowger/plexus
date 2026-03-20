import { describe, expect, test, beforeEach, afterEach, mock } from 'bun:test';
import { setConfigForTesting } from '../../config';
import type { UnifiedChatRequest } from '../../types/unified';

// Mock @mariozechner/pi-ai BEFORE importing anything that transitively imports it.
// This ensures the Dispatcher and OAuthTransformer pick up the mock.
const completeMock = mock(async (_model: any, _context: any, _options?: any) => ({
  content: [{ type: 'text', text: 'ok' }],
  stopReason: 'stop',
  usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
  provider: 'anthropic',
  model: 'claude-test',
}));

mock.module('@mariozechner/pi-ai', () => ({
  getModels: (_provider: string) => [{ id: 'claude-test', provider: 'anthropic' }],
  getModel: (_provider: string, modelId: string) => ({ id: modelId, provider: 'anthropic' }),
  complete: completeMock,
  stream: mock(async () => ({ ok: true })),
}));

const { Dispatcher } = await import('../dispatcher');

const fetchMock: any = mock(async (): Promise<any> => {
  throw new Error('fetch should not be called in pi-ai masking path');
});
global.fetch = fetchMock as any;

function maskedAnthropicConfig() {
  return {
    providers: {
      claude_masked: {
        type: 'messages',
        api_base_url: 'https://api.anthropic.com',
        api_key: 'sk-ant-api03-masked-test-key',
        useClaudeMasking: true,
        models: {
          'claude-test': {
            pricing: { source: 'simple', input: 0, output: 0 },
          },
        },
      },
    },
    models: {
      'test-model': {
        targets: [{ provider: 'claude_masked', model: 'claude-test' }],
      },
    },
    keys: {},
  } as any;
}

function normalAnthropicConfig() {
  return {
    providers: {
      claude_native: {
        type: 'messages',
        api_base_url: 'https://api.anthropic.com',
        api_key: 'sk-ant-api03-native-test-key',
        useClaudeMasking: false,
        models: {
          'claude-test': {
            pricing: { source: 'simple', input: 0, output: 0 },
          },
        },
      },
    },
    models: {
      'test-model': {
        targets: [{ provider: 'claude_native', model: 'claude-test' }],
      },
    },
    keys: {},
  } as any;
}

function makeRequest(): UnifiedChatRequest {
  return {
    model: 'test-model',
    messages: [{ role: 'user', content: 'hello' }],
    incomingApiType: 'messages',
  };
}

describe('Dispatcher Claude Masking routing', () => {
  beforeEach(() => {
    fetchMock.mockClear();
    completeMock.mockClear();
  });

  afterEach(() => {
    mock.restore();
  });

  test('useClaudeMasking:true routes through pi-ai (complete called, fetch not called)', async () => {
    setConfigForTesting(maskedAnthropicConfig());
    const dispatcher = new Dispatcher();

    const response = await dispatcher.dispatch(makeRequest());

    expect(response).toBeDefined();
    expect(response.plexus?.apiType).toBe('oauth');
    // pi-ai complete() must have been called
    expect(completeMock).toHaveBeenCalledTimes(1);
    // native fetch must NOT have been called
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('useClaudeMasking:false routes through native HTTP fetch (fetch called, pi-ai not called)', async () => {
    setConfigForTesting(normalAnthropicConfig());
    fetchMock.mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            id: 'msg-1',
            type: 'message',
            role: 'assistant',
            content: [{ type: 'text', text: 'ok' }],
            model: 'claude-test',
            stop_reason: 'end_turn',
            usage: { input_tokens: 1, output_tokens: 1 },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
    );

    const dispatcher = new Dispatcher();
    const response = await dispatcher.dispatch(makeRequest());

    expect(response).toBeDefined();
    // native fetch must have been called
    expect(fetchMock).toHaveBeenCalled();
    // pi-ai complete() must NOT have been called
    expect(completeMock).not.toHaveBeenCalled();
  });
});
