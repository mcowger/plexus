import { describe, expect, test, beforeEach, afterEach, vi } from 'vitest';
import { Dispatcher } from '../dispatcher';
import { setConfigForTesting } from '../../config';
import type { UnifiedChatRequest } from '../../types/unified';
import { CooldownManager } from '../cooldown-manager';
import { StickySessionManager } from '../sticky-session-manager';

const fetchMock: any = vi.fn(async (): Promise<any> => {
  throw new Error('fetch mock not configured for test');
});
global.fetch = fetchMock as any;

function successChatResponse(model: string) {
  return new Response(
    JSON.stringify({
      id: `chatcmpl-${model}`,
      object: 'chat.completion',
      created: 1,
      model,
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'ok' },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}

function errorResponse(status: number, message: string) {
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function configFor(opts: { sticky: boolean }) {
  return {
    providers: {
      p1: {
        type: 'chat',
        api_base_url: 'https://p1.example.com/v1',
        api_key: 'k1',
        models: { 'model-1': {} },
      },
      p2: {
        type: 'chat',
        api_base_url: 'https://p2.example.com/v1',
        api_key: 'k2',
        models: { 'model-2': {} },
      },
    },
    models: {
      'test-alias': {
        selector: 'in_order',
        sticky_session: opts.sticky,
        targets: [
          { provider: 'p1', model: 'model-1' },
          { provider: 'p2', model: 'model-2' },
        ],
      },
    },
    keys: {},
    failover: {
      enabled: true,
      retryableStatusCodes: [500, 502, 503, 504, 429],
      retryableErrors: ['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND'],
    },
    quotas: [],
  } as any;
}

function multiTurnRequest(): UnifiedChatRequest {
  return {
    model: 'test-alias',
    messages: [
      { role: 'system', content: 'you are helpful' },
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi there' },
      { role: 'user', content: 'follow up' },
    ],
    incomingApiType: 'chat',
    stream: false,
  };
}

describe('Dispatcher sticky_session write-back', () => {
  beforeEach(async () => {
    fetchMock.mockClear();
    StickySessionManager.getInstance().clear();
    await CooldownManager.getInstance().clearCooldown();
  });

  afterEach(async () => {
    await CooldownManager.getInstance().clearCooldown();
  });

  test('records the successful (provider, model) after dispatch when sticky_session is enabled', async () => {
    setConfigForTesting(configFor({ sticky: true }));
    fetchMock.mockImplementation(async () => successChatResponse('model-1'));

    const req = multiTurnRequest();
    const sessionKey = StickySessionManager.computeSessionKey(req)!;
    expect(sessionKey).not.toBeNull();

    expect(StickySessionManager.getInstance().get('test-alias', sessionKey)).toBeNull();

    await new Dispatcher().dispatch(req);

    expect(StickySessionManager.getInstance().get('test-alias', sessionKey)).toEqual({
      provider: 'p1',
      model: 'model-1',
    });
  });

  test('does NOT record when sticky_session is disabled on the alias', async () => {
    setConfigForTesting(configFor({ sticky: false }));
    fetchMock.mockImplementation(async () => successChatResponse('model-1'));

    const req = multiTurnRequest();
    const sessionKey = StickySessionManager.computeSessionKey(req)!;

    await new Dispatcher().dispatch(req);

    expect(StickySessionManager.getInstance().get('test-alias', sessionKey)).toBeNull();
  });

  test('does NOT record for single-turn requests (no session key)', async () => {
    setConfigForTesting(configFor({ sticky: true }));
    fetchMock.mockImplementation(async () => successChatResponse('model-1'));

    const req: UnifiedChatRequest = {
      model: 'test-alias',
      messages: [{ role: 'user', content: 'hello' }],
      incomingApiType: 'chat',
      stream: false,
    };

    await new Dispatcher().dispatch(req);

    expect(StickySessionManager.getInstance().size()).toBe(0);
  });

  test('when sticky pick is filtered out pre-dispatch (disabled target), rewrites sticky to the new winner', async () => {
    // Simulates the live test where the previously-sticky provider was
    // disabled on the alias — the sticky entry should be bypassed (not even
    // reach the fetch layer) and then overwritten with whatever succeeds.
    const cfg = configFor({ sticky: true });
    // Disable p1 on the alias, so the only healthy candidate is p2.
    cfg.models['test-alias'].targets[0].enabled = false;
    setConfigForTesting(cfg);

    const req = multiTurnRequest();
    const sessionKey = StickySessionManager.computeSessionKey(req)!;

    // Seed sticky with the now-disabled target.
    StickySessionManager.getInstance().set('test-alias', sessionKey, 'p1', 'model-1');

    fetchMock.mockImplementation(async (url: any) => {
      // p1 should never be called — it's filtered before dispatch.
      if (String(url).includes('p1.example.com')) {
        throw new Error('p1 should not be reached');
      }
      return successChatResponse('model-2');
    });

    await new Dispatcher().dispatch(req);

    // Only p2 was contacted.
    const urls = fetchMock.mock.calls.map((c: any[]) => String(c[0]));
    expect(urls.some((u: string) => u.includes('p2.example.com'))).toBe(true);
    expect(urls.some((u: string) => u.includes('p1.example.com'))).toBe(false);

    // Sticky entry was overwritten with the new winner.
    expect(StickySessionManager.getInstance().get('test-alias', sessionKey)).toEqual({
      provider: 'p2',
      model: 'model-2',
    });
  });

  test('on failover, records the target that actually succeeded (not the original sticky pick)', async () => {
    setConfigForTesting(configFor({ sticky: true }));

    const req = multiTurnRequest();
    const sessionKey = StickySessionManager.computeSessionKey(req)!;

    // Seed sticky with p1 — but p1 will fail (retryable 500), failover goes to p2.
    StickySessionManager.getInstance().set('test-alias', sessionKey, 'p1', 'model-1');

    fetchMock
      .mockImplementationOnce(async () => errorResponse(500, 'p1 boom'))
      .mockImplementationOnce(async () => successChatResponse('model-2'));

    await new Dispatcher().dispatch(req);

    expect(StickySessionManager.getInstance().get('test-alias', sessionKey)).toEqual({
      provider: 'p2',
      model: 'model-2',
    });
  });
});
