/**
 * Integration test: reasoning_content adapter — the known Fireworks scenario.
 *
 * Scenario (from sample.json):
 *   A multi-turn conversation where previous assistant messages carry both
 *   `reasoning_content` (OpenAI style) and `reasoning` fields. Without the
 *   adapter Fireworks rejects the request with:
 *     "Extra inputs are not permitted, field: 'messages[N].reasoning'"
 *
 * This test verifies the full round-trip through the dispatcher:
 *   1. preDispatch: `reasoning` and `reasoning_content` on outbound assistant
 *      messages are both rewritten to `reasoning_content` before hitting the provider.
 *   2. postDispatch: `reasoning_content` on the provider response is remapped
 *      back to `reasoning` before transformResponse() consumes it.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { registerSpy } from '../test-utils';
import { Dispatcher } from '../../src/services/dispatcher';
import { Router } from '../../src/services/router';
import * as configModule from '../../src/config';

// ── Config ───────────────────────────────────────────────────────────────────

const BASE_CONFIG = {
  providers: {
    fireworks: {
      api_base_url: { chat: 'https://api.fireworks.ai/inference/v1' },
      api_key: 'fw_test',
      enabled: true,
      disable_cooldown: false,
      estimateTokens: false,
      useClaudeMasking: false,
      models: {
        'accounts/fireworks/models/kimi-k2p6': {
          pricing: { source: 'simple', input: 0, output: 0 },
          access_via: ['chat'],
          // adapter configured at model level — matches the real production setup
          adapter: ['reasoning_content'],
        },
      },
    },
  },
  models: {},
  keys: {},
  failover: { enabled: false, retryableStatusCodes: [], retryableErrors: [] },
  cooldown: { initialMinutes: 1, maxMinutes: 60 },
};

// The multi-turn request from sample.json (representative, not exhaustive)
const SAMPLE_REQUEST = {
  model: 'direct/fireworks/accounts/fireworks/models/kimi-k2p6',
  stream: false,
  messages: [
    { role: 'system', content: 'You are a professional greeter' },
    { role: 'user', content: [{ type: 'text', text: 'hello, plexus' }] },
    {
      role: 'assistant',
      content: 'Hello! How can I help?',
      // OpenAI-style field — should be renamed to reasoning_content before dispatch
      reasoning_content: 'The user said hello. I should respond in a friendly, helpful manner.',
    },
    { role: 'user', content: [{ type: 'text', text: 'hello again, plexus' }] },
    {
      role: 'assistant',
      content: 'Hello again!',
      // Fireworks / alternative field name — also should become reasoning_content
      reasoning: 'The user is greeting me again. Ask what they need.',
    },
    { role: 'user', content: [{ type: 'text', text: 'hello again and again' }] },
  ],
};

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Minimal well-formed OpenAI-chat JSON response from Fireworks */
function makeFireworksResponse(reasoning_content: string | null = null) {
  return {
    id: 'chatcmpl-test',
    object: 'chat.completion',
    created: 1234567890,
    model: 'accounts/fireworks/models/kimi-k2p6',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: 'Hello once more!',
          reasoning_content,
        },
        finish_reason: 'stop',
      },
    ],
    usage: { prompt_tokens: 91, completion_tokens: 40, total_tokens: 131 },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('reasoning_content adapter — Fireworks multi-turn scenario', () => {
  let dispatcher: Dispatcher;
  let capturedRequestBody: any = null;

  beforeEach(() => {
    configModule.setConfigForTesting(BASE_CONFIG as any);
    dispatcher = new Dispatcher();

    // Stub Router so we don't need a full DB
    registerSpy(Router, 'resolve').mockResolvedValue({
      provider: 'fireworks',
      model: 'accounts/fireworks/models/kimi-k2p6',
      config: BASE_CONFIG.providers.fireworks,
      modelConfig: BASE_CONFIG.providers.fireworks.models['accounts/fireworks/models/kimi-k2p6'],
      canonicalModel: undefined,
      incomingModelAlias: undefined,
    });

    registerSpy(Router, 'resolveCandidates').mockResolvedValue([
      {
        provider: 'fireworks',
        model: 'accounts/fireworks/models/kimi-k2p6',
        config: BASE_CONFIG.providers.fireworks,
        modelConfig: BASE_CONFIG.providers.fireworks.models['accounts/fireworks/models/kimi-k2p6'],
        canonicalModel: undefined,
        incomingModelAlias: undefined,
      },
    ]);

    // Capture what the dispatcher sends upstream
    registerSpy(dispatcher as any, 'executeProviderRequest').mockImplementation(
      async (_url: string, _headers: any, body: any) => {
        capturedRequestBody = body;
        const responseData = makeFireworksResponse('I thought about the greeting carefully.');
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => responseData,
          text: async () => JSON.stringify(responseData),
        } as any;
      }
    );
  });

  afterEach(() => {
    capturedRequestBody = null;
  });

  // ── preDispatch ─────────────────────────────────────────────────────────────

  it('rewrites reasoning_content → reasoning_content (passes through unchanged) on outbound assistant messages', async () => {
    await dispatcher.dispatch(SAMPLE_REQUEST as any);

    const messages: any[] = capturedRequestBody.messages;
    const assistantMessages = messages.filter((m: any) => m.role === 'assistant');

    // Both assistant messages should have reasoning_content, not reasoning
    for (const msg of assistantMessages) {
      expect(msg.reasoning_content).toBeDefined();
      expect(msg.reasoning).toBeUndefined();
    }
  });

  it('rewrites reasoning → reasoning_content on outbound assistant messages', async () => {
    await dispatcher.dispatch(SAMPLE_REQUEST as any);

    const messages: any[] = capturedRequestBody.messages;
    // The second assistant message originally had `reasoning` (not reasoning_content)
    const secondAssistant = messages.filter((m: any) => m.role === 'assistant')[1];

    expect(secondAssistant.reasoning_content).toBe(
      'The user is greeting me again. Ask what they need.'
    );
    expect(secondAssistant.reasoning).toBeUndefined();
  });

  it('does not add reasoning_content to non-assistant messages', async () => {
    await dispatcher.dispatch(SAMPLE_REQUEST as any);

    const messages: any[] = capturedRequestBody.messages;
    const nonAssistant = messages.filter((m: any) => m.role !== 'assistant');

    for (const msg of nonAssistant) {
      expect(msg.reasoning_content).toBeUndefined();
    }
  });

  // ── postDispatch ────────────────────────────────────────────────────────────

  it('preserves reasoning_content in the provider response so transformResponse() surfaces it', async () => {
    const result = await dispatcher.dispatch(SAMPLE_REQUEST as any);

    // postDispatch is intentionally a no-op for this adapter: the OpenAI
    // transformer's transformResponse() reads `message.reasoning_content`
    // natively, so the field must remain unchanged on the inbound path.
    expect(result.content).toBe('Hello once more!');
    expect(result.reasoning_content).toBe('I thought about the greeting carefully.');
  });

  it('handles null reasoning_content in provider response without error', async () => {
    // Override to return null reasoning (common when model produces no reasoning)
    registerSpy(dispatcher as any, 'executeProviderRequest').mockImplementation(
      async (_url: string, _headers: any, body: any) => {
        capturedRequestBody = body;
        const responseData = makeFireworksResponse(null);
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => responseData,
          text: async () => JSON.stringify(responseData),
        } as any;
      }
    );

    const result = await dispatcher.dispatch(SAMPLE_REQUEST as any);
    expect(result.content).toBe('Hello once more!');
  });

  // ── Pass-through suppression ────────────────────────────────────────────────

  it('suppresses pass-through when adapter is configured (forces full transformation)', async () => {
    // Send with incomingApiType = 'chat' so pass-through would normally activate
    const requestWithApiType = {
      ...SAMPLE_REQUEST,
      incomingApiType: 'chat',
      originalBody: SAMPLE_REQUEST,
    };

    await dispatcher.dispatch(requestWithApiType as any);

    // If pass-through were active, capturedRequestBody would equal originalBody verbatim
    // and the reasoning fields would NOT have been rewritten.
    // Adapter suppresses pass-through, so transformation must have run.
    const messages: any[] = capturedRequestBody.messages;
    const assistantMessages = messages.filter((m: any) => m.role === 'assistant');
    for (const msg of assistantMessages) {
      expect(msg.reasoning).toBeUndefined();
    }
  });
});
