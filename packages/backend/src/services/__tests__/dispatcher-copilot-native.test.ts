import { describe, expect, test, beforeEach, afterEach, vi } from 'vitest';
import { setConfigForTesting } from '../../config';
import { OAuthAuthManager } from '../oauth/oauth-auth-manager';
import { copilotWireApiType, isNativeOAuthProvider } from '../oauth/oauth-native-request';
import { registerSpy } from '../../../test/test-utils';
import type { UnifiedChatRequest } from '../../types/unified';

// Native GitHub Copilot OAuth.
//
// Copilot is the last OAuth provider retired from the pi-ai executor. Unlike
// Anthropic/Codex it is MULTI-API: each model picks its own wire API, so the
// endpoint + transformer are resolved per-model:
//   gpt-4.1 / gpt-5-mini … → openai-completions → /chat/completions  (plexus 'chat')
//   claude-*              → anthropic-messages  → /v1/messages       (plexus 'messages')
//   gpt-5.4 (responses)   → openai-responses    → /responses         (plexus 'responses')
// It needs NO masking and NO tool renames — just the Copilot editor headers,
// the dynamic X-Initiator/Openai-Intent (+ Copilot-Vision-Request), a Bearer
// token, and a baseURL derived from the token's proxy-ep claim.

const { Dispatcher } = await import('../dispatch/dispatcher');

// Minimal chat.completion SSE — used to prove raw-byte pass-through (same-format).
const CHAT_SSE = [
  'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","model":"gpt-4.1","choices":[{"index":0,"delta":{"content":"NATIVE"}}]}',
  '',
  'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","model":"gpt-4.1","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":2,"total_tokens":7}}',
  '',
  'data: [DONE]',
  '',
  '',
].join('\n');

// Copilot access tokens carry the API endpoint in a `proxy-ep` claim.
const COPILOT_TOKEN = 'tid=abc;exp=9999999999;proxy-ep=proxy.individual.githubcopilot.com;ssc=1';
const COPILOT_BUSINESS_TOKEN = 'tid=abc;exp=9999999999;proxy-ep=proxy.business.githubcopilot.com';

function copilotConfig() {
  return {
    providers: {
      Copilot: {
        type: 'oauth',
        api_base_url: 'oauth://github-copilot',
        oauth_provider: 'github-copilot',
        oauth_account: 'test-account',
        models: {
          // Empty access_via → API type inferred as the synthetic 'oauth' type
          // (mirrors real deployments). The native path resolves the real wire
          // API per-model via the registry.
          'gpt-4.1': { pricing: { source: 'simple', input: 0, output: 0 }, access_via: [] },
          'claude-sonnet-4': { pricing: { source: 'simple', input: 0, output: 0 }, access_via: [] },
          'gpt-5.4': { pricing: { source: 'simple', input: 0, output: 0 }, access_via: [] },
        },
      },
    },
    models: {
      'cop-chat': { targets: [{ provider: 'Copilot', model: 'gpt-4.1' }] },
      'cop-messages': { targets: [{ provider: 'Copilot', model: 'claude-sonnet-4' }] },
      'cop-responses': { targets: [{ provider: 'Copilot', model: 'gpt-5.4' }] },
    },
    keys: {},
  } as any;
}

/** A same-format OpenAI chat request (client speaks chat, target is a chat model). */
function chatRequest(alias = 'cop-chat', withImage = false): UnifiedChatRequest {
  const content = withImage
    ? [
        { type: 'text', text: 'describe' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
      ]
    : 'hi';
  const body = {
    model: alias,
    stream: true,
    messages: [{ role: 'user', content }],
  };
  return {
    model: alias,
    messages: [{ role: 'user', content }],
    stream: true,
    incomingApiType: 'chat',
    originalBody: body,
  } as any;
}

async function drain(stream: ReadableStream): Promise<string> {
  const reader = stream.getReader();
  const dec = new TextDecoder();
  let out = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    out += typeof value === 'string' ? value : dec.decode(value);
  }
  return out;
}

describe('copilotWireApiType', () => {
  test('maps Copilot models to their plexus wire API type', () => {
    expect(copilotWireApiType('gpt-4.1')).toBe('chat'); // openai-completions
    expect(copilotWireApiType('claude-sonnet-4')).toBe('messages'); // anthropic-messages
    expect(copilotWireApiType('gpt-5.4')).toBe('responses'); // openai-responses
  });
  test('defaults unknown/custom model ids to chat completions', () => {
    expect(copilotWireApiType(undefined)).toBe('chat');
  });
  test('github-copilot is a native OAuth provider', () => {
    expect(isNativeOAuthProvider('github-copilot')).toBe(true);
  });
});

describe('Native GitHub Copilot OAuth', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    OAuthAuthManager.resetForTesting();
    registerSpy(OAuthAuthManager.getInstance(), 'getApiKey').mockResolvedValue(COPILOT_TOKEN);
    fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(CHAT_SSE, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      })
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    OAuthAuthManager.resetForTesting();
  });

  test('chat model: posts to /chat/completions with Copilot fingerprint + Bearer auth', async () => {
    setConfigForTesting(copilotConfig());
    const response = await new Dispatcher().dispatch(chatRequest('cop-chat'));

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as any[];
    expect(url).toBe('https://api.individual.githubcopilot.com/chat/completions');

    // Auth + static Copilot editor headers.
    expect(init.headers['Authorization']).toBe(`Bearer ${COPILOT_TOKEN}`);
    expect(init.headers['Copilot-Integration-Id']).toBe('vscode-chat');
    expect(init.headers['Editor-Version']).toBe('vscode/1.107.0');
    expect(init.headers['User-Agent']).toBe('GitHubCopilotChat/0.35.0');
    // Dynamic headers: last turn is user-authored, no images.
    expect(init.headers['X-Initiator']).toBe('user');
    expect(init.headers['Openai-Intent']).toBe('conversation-edits');
    expect(init.headers['Copilot-Vision-Request']).toBeUndefined();

    const sent = JSON.parse(init.body);
    expect(sent.model).toBe('gpt-4.1'); // resolved target model, not the alias
    // Usage forced on for streaming completions so token accounting works.
    expect(sent.stream_options).toEqual({ include_usage: true });

    // Same-format chat → raw pass-through (no cross-format translation).
    expect(response.bypassTransformation).toBe(true);
  });

  test('chat model: streams RAW completions SSE to the client, byte-preserved', async () => {
    setConfigForTesting(copilotConfig());
    const response = await new Dispatcher().dispatch(chatRequest('cop-chat'));
    expect(response.stream).toBeDefined();

    const clientBytes = await drain(response.stream!);
    expect(clientBytes).toContain('"delta":{"content":"NATIVE"}');
    expect(clientBytes).toContain('data: [DONE]');
  });

  test('vision input adds Copilot-Vision-Request', async () => {
    setConfigForTesting(copilotConfig());
    await new Dispatcher().dispatch(chatRequest('cop-chat', /* withImage */ true));

    const [, init] = fetchSpy.mock.calls[0] as any[];
    expect(init.headers['Copilot-Vision-Request']).toBe('true');
  });

  test('claude model: chat→messages is cross-format (posts /v1/messages, translates response)', async () => {
    setConfigForTesting(copilotConfig());
    const response = await new Dispatcher().dispatch(chatRequest('cop-messages'));

    const [url, init] = fetchSpy.mock.calls[0] as any[];
    expect(url).toBe('https://api.individual.githubcopilot.com/v1/messages');
    // Anthropic wire type carries the version header + Copilot fingerprint.
    expect(init.headers['anthropic-version']).toBe('2023-06-01');
    expect(init.headers['Copilot-Integration-Id']).toBe('vscode-chat');
    expect(init.headers['Authorization']).toBe(`Bearer ${COPILOT_TOKEN}`);

    const sent = JSON.parse(init.body);
    expect(sent.model).toBe('claude-sonnet-4');
    // chat (incoming) != messages (wire) → response must be translated back.
    expect(response.bypassTransformation).toBe(false);
  });

  test('responses model: posts to /responses', async () => {
    setConfigForTesting(copilotConfig());
    await new Dispatcher().dispatch({
      ...chatRequest('cop-responses'),
      incomingApiType: 'responses',
      originalBody: {
        model: 'cop-responses',
        stream: true,
        input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] }],
      },
    } as any);

    const [url, init] = fetchSpy.mock.calls[0] as any[];
    expect(url).toBe('https://api.individual.githubcopilot.com/responses');
    expect(init.headers['Copilot-Integration-Id']).toBe('vscode-chat');
    expect(init.headers['Authorization']).toBe(`Bearer ${COPILOT_TOKEN}`);
  });

  test('Business account token forces the standard api.githubcopilot.com endpoint', async () => {
    OAuthAuthManager.resetForTesting();
    registerSpy(OAuthAuthManager.getInstance(), 'getApiKey').mockResolvedValue(
      COPILOT_BUSINESS_TOKEN
    );
    setConfigForTesting(copilotConfig());
    await new Dispatcher().dispatch(chatRequest('cop-chat'));

    const [url] = fetchSpy.mock.calls[0] as any[];
    // proxy.business.* → api.githubcopilot.com (NOT api.business.*, which only
    // serves NES/autocomplete).
    expect(url).toBe('https://api.githubcopilot.com/chat/completions');
  });
});
