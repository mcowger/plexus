/**
 * Dispatcher routing: genuine Claude Code → real Anthropic skips masking.
 *
 * End-to-end through the masking API-key route (`useClaudeMasking`): a
 * genuine client body must reach the upstream verbatim (client CC version,
 * system prompt, device/session metadata, no synthetic reminder) with only
 * the auth key swapped and the caller's UA/session preserved. A request
 * that fails `isGenuineClaudeCodeRequest` keeps the masking behavior.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { setConfigForTesting } from '../../config';
import type { UnifiedChatRequest } from '../../types/unified';

// @earendil-works/pi-ai is mocked globally in vitest.setup.ts — do not add a
// per-file vi.mock() call here.  With isolate: false all files share one
// module registry and competing registrations create last-writer-wins races.
const { Dispatcher } = await import('../dispatch/dispatcher');
import * as piAi from '@earendil-works/pi-ai/compat';

const fetchMock: any = vi.fn(async (): Promise<any> => {
  throw new Error('fetch should not be called without a mock implementation');
});
global.fetch = fetchMock as any;

const CLIENT_UA = 'claude-cli/2.1.278 (external, cli)';
const SESSION_ID = 'f30933dc-c43f-4e8f-82d2-8d87c3ef60e6';
const DEVICE_ID = '1563fdc89059aefd3317a1abf5adc964b98062c904c8f71ba5daacecc4a2cb0d';

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

function genuineBody() {
  return {
    model: 'test-model',
    max_tokens: 64,
    system: [
      {
        type: 'text',
        text: 'x-anthropic-billing-header: cc_version=2.1.278.452; cc_entrypoint=cli;',
      },
      { type: 'text', text: "You are Claude Code, Anthropic's official CLI for Claude." },
      { type: 'text', text: 'My custom output style instructions.' },
    ],
    metadata: {
      user_id: JSON.stringify({ device_id: DEVICE_ID, account_uuid: '', session_id: SESSION_ID }),
    },
    messages: [{ role: 'user', content: 'hello' }],
  };
}

function genuineRequest(): UnifiedChatRequest {
  return {
    model: 'test-model',
    messages: [{ role: 'user', content: 'hello' }],
    incomingApiType: 'messages',
    originalBody: genuineBody(),
    anthropicBeta: 'claude-code-20250219,interleaved-thinking-2025-05-14',
    userAgent: CLIENT_UA,
    claudeCodeSessionId: SESSION_ID,
    metadata: { plexus_metadata: { clientHeaders: { 'x-app': 'cli' } } },
  } as any;
}

function upstreamOk() {
  return new Response(
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
  );
}

describe('Dispatcher genuine Claude Code passthrough', () => {
  beforeEach(() => {
    fetchMock.mockClear();
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

  test('genuine client body reaches Anthropic verbatim (key swap only)', async () => {
    setConfigForTesting(maskedAnthropicConfig());
    fetchMock.mockImplementation(async () => upstreamOk());
    const dispatcher = new Dispatcher();

    const response = await dispatcher.dispatch(genuineRequest());

    expect(response).toBeDefined();
    expect(vi.mocked(piAi.complete)).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    const headers = init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('sk-ant-api03-masked-test-key');
    expect(headers.Authorization).toBeUndefined();
    // Caller identity preserved, not the gateway's generated one.
    expect(headers['user-agent']).toBe(CLIENT_UA);
    expect(headers['x-claude-code-session-id']).toBe(SESSION_ID);

    const body = JSON.parse(init.body as string);
    // Route model overwrite still applies.
    expect(body.model).toBe('claude-test');
    // Client identity intact: version, system prompt, device/session metadata.
    expect(body.system[0].text).toContain('cc_version=2.1.278.452');
    expect(body.system[0].text).not.toContain('cch=');
    expect(body.system[2].text).toBe('My custom output style instructions.');
    expect(JSON.parse(body.metadata.user_id).device_id).toBe(DEVICE_ID);
    expect(JSON.parse(body.metadata.user_id).session_id).toBe(SESSION_ID);
    // No synthetic reminder injected into the conversation.
    expect(body.messages).toHaveLength(1);
    expect(JSON.stringify(body.messages)).not.toContain('system-reminder');
  });

  test('genuine fingerprint on a transformer-rebuilt body still gets masked', async () => {
    setConfigForTesting(maskedAnthropicConfig());
    fetchMock.mockImplementation(async () => upstreamOk());
    const dispatcher = new Dispatcher();

    // Same genuine headers/body, but vision fallthrough forces the
    // transformer path — so the sent body is rebuilt, not verbatim, and the
    // fingerprint checked on `originalBody` must not skip masking for it.
    const request = genuineRequest();
    (request as any)._hasVisionFallthrough = true;

    await dispatcher.dispatch(request);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.system[0].text).toContain('cch=');
  });

  test('non-genuine client on the same route still gets masked', async () => {
    setConfigForTesting(maskedAnthropicConfig());
    fetchMock.mockImplementation(async () => upstreamOk());
    const dispatcher = new Dispatcher();

    const request = genuineRequest();
    delete (request as any).userAgent;

    await dispatcher.dispatch(request);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    // Masking ran: CCH hash signed, client version replaced.
    expect(body.system[0].text).toContain('cch=');
    expect(body.system[0].text).not.toContain('cc_version=2.1.278.452');
    expect(JSON.parse(body.metadata.user_id).device_id).not.toBe(DEVICE_ID);
  });
});
