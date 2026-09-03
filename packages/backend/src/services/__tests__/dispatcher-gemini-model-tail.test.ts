import { describe, expect, test, beforeEach, afterEach, vi } from 'vitest';
import { Dispatcher } from '../dispatch/dispatcher';
import { setConfigForTesting } from '../../config';
import type { UnifiedChatRequest } from '../../types/unified';

const fetchMock: any = vi.fn(async (): Promise<any> => {
  throw new Error('fetch mock not configured for test');
});

global.fetch = fetchMock as any;

function makeGeminiConfig() {
  return {
    providers: {
      g1: {
        type: 'gemini',
        api_base_url: 'https://generativelanguage.googleapis.com',
        api_key: 'test-key-g1',
        models: { 'gemini-3.8-flash': {} },
      },
    },
    models: {
      'test-alias': {
        targets: [{ provider: 'g1', model: 'gemini-3.8-flash' }],
      },
    },
    keys: {},
  } as any;
}

function geminiSuccessResponse(model: string) {
  return new Response(
    JSON.stringify({
      candidates: [
        {
          content: { role: 'model', parts: [{ text: 'ok' }] },
          finishReason: 'STOP',
          index: 0,
        },
      ],
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
      modelVersion: model,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}

describe('Dispatcher Gemini model-tail normalization', () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('native gemini->gemini pass-through appends a user turn after a text-only model tail', async () => {
    setConfigForTesting(makeGeminiConfig());
    fetchMock.mockResolvedValue(geminiSuccessResponse('gemini-3.8-flash'));
    const dispatcher = new Dispatcher();

    const request: UnifiedChatRequest = {
      model: 'test-alias',
      messages: [
        { role: 'user', content: 'Remember cobalt' },
        { role: 'assistant', content: 'stored' },
      ],
      incomingApiType: 'gemini',
      stream: false,
      originalBody: {
        contents: [
          { role: 'user', parts: [{ text: 'Remember cobalt' }] },
          { role: 'model', parts: [{ text: 'stored' }] },
        ],
      },
    } as any;

    await dispatcher.dispatch(request);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.contents).toHaveLength(3);
    expect(body.contents[2]).toEqual({ role: 'user', parts: [{ text: '.' }] });
  });

  test('native gemini->gemini pass-through leaves tool-call tails alone', async () => {
    setConfigForTesting(makeGeminiConfig());
    fetchMock.mockResolvedValue(geminiSuccessResponse('gemini-3.8-flash'));
    const dispatcher = new Dispatcher();

    const request: UnifiedChatRequest = {
      model: 'test-alias',
      messages: [{ role: 'user', content: 'Look up cobalt' }],
      incomingApiType: 'gemini',
      stream: false,
      originalBody: {
        contents: [
          { role: 'user', parts: [{ text: 'Look up cobalt' }] },
          { role: 'model', parts: [{ functionCall: { name: 'lookup', args: {} } }] },
        ],
      },
    } as any;

    await dispatcher.dispatch(request);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.contents).toHaveLength(2);
    expect(body.contents[1].role).toBe('model');
  });

  test('cross-format (chat->gemini) transform appends a user turn after an assistant tail', async () => {
    setConfigForTesting(makeGeminiConfig());
    fetchMock.mockResolvedValue(geminiSuccessResponse('gemini-3.8-flash'));
    const dispatcher = new Dispatcher();

    const request: UnifiedChatRequest = {
      model: 'test-alias',
      messages: [
        { role: 'user', content: 'Remember cobalt' },
        { role: 'assistant', content: 'stored' },
      ],
      incomingApiType: 'chat',
      stream: false,
    };

    await dispatcher.dispatch(request);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.contents).toHaveLength(3);
    expect(body.contents[2]).toEqual({ role: 'user', parts: [{ text: '.' }] });
  });
});
