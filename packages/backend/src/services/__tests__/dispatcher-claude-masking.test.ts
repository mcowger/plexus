import { describe, expect, test, beforeEach, afterEach, vi } from 'vitest';
import { setConfigForTesting } from '../../config';
import type { UnifiedChatRequest } from '../../types/unified';

// @earendil-works/pi-ai is mocked globally in vitest.setup.ts — do not add a
// per-file vi.mock() call here.  With isolate: false all files share one
// module registry and competing registrations create last-writer-wins races.
const { Dispatcher } = await import('../dispatch/dispatcher');
import * as piAi from '@earendil-works/pi-ai/compat';

const fetchMock: any = vi.fn(async (): Promise<any> => {
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
    // Re-apply mock implementation since mockReset: true clears vi.fn() state.
    // Note: we do NOT assert on piAi.complete call counts here because with
    // isolate: false + setupFiles re-running per file, the dispatcher holds a
    // different spy instance than the one in this file's piAi namespace.
    // We verify the pi-ai path was taken via response.plexus.apiType + fetch absence.
    vi.mocked(piAi.complete).mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
      stopReason: 'stop',
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
      provider: 'anthropic',
      model: 'claude-test',
    } as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('useClaudeMasking:true routes through the NATIVE path (real fetch, x-api-key, masked body, no pi-ai)', async () => {
    // The Claude-masking API-key route no longer uses the pi-ai
    // executor. It builds the native Anthropic body, applies CC masking, and
    // POSTs with x-api-key (the real Anthropic key) — same as OAuth, minus the
    // Bearer token.
    setConfigForTesting(maskedAnthropicConfig());
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
    // pi-ai executor must NOT have been used.
    expect(vi.mocked(piAi.complete)).not.toHaveBeenCalled();
    // Went native to the real Anthropic endpoint.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    const headers = init.headers as Record<string, string>;
    // Masking API-key auth: x-api-key with the real key, NOT Bearer.
    expect(headers['x-api-key']).toBe('sk-ant-api03-masked-test-key');
    expect(headers.Authorization).toBeUndefined();
    // CC masking applied (fingerprint headers + rebuilt system identity).
    expect(headers['anthropic-beta']).toBeTruthy();
    const body = JSON.parse(init.body as string);
    expect(Array.isArray(body.system)).toBe(true);
    expect(body.system[0].text).toContain('x-anthropic-billing-header');
  });

  test('useClaudeMasking:false routes through native HTTP fetch', async () => {
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
    expect(vi.mocked(piAi.complete)).not.toHaveBeenCalled();
  });
});
