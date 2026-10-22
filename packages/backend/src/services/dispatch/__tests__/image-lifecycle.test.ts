import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test';

import { advanceTimersByTimeAsync, registerSpy } from '../../../../test/test-utils';
import { setConfigForTesting } from '../../../config';
import type { UnifiedImageGenerationRequest } from '../../../types/unified';
import { OAuthAuthManager } from '../../oauth/oauth-auth-manager';
import { ConcurrencyTracker } from '../../runtime/concurrency-tracker';
import { CooldownManager } from '../../runtime/cooldown-manager';
import { Dispatcher } from '../dispatcher';

const request: UnifiedImageGenerationRequest = {
  model: 'images',
  prompt: 'A fox',
  incomingApiType: 'images',
};

function config() {
  const provider = (name: string) => ({
    api_base_url: `https://${name}.example/v1`,
    api_key: 'key',
    maxConcurrency: 1,
    models: { image: { type: 'image', access_via: ['openai-images'] } },
  });
  return {
    providers: { first: provider('first'), second: provider('second') },
    models: {
      images: {
        type: 'image',
        selector: 'in_order',
        targets: [
          { provider: 'first', model: 'image' },
          { provider: 'second', model: 'image' },
        ],
      },
    },
    keys: {},
    quotas: [],
    failover: { enabled: true, retryableStatusCodes: [500, 504], retryableErrors: ['ETIMEDOUT'] },
  } as any;
}

const success = () => Response.json({ created: 1, data: [{ b64_json: 'AA==' }] });

/** Models native fetch cancellation before headers or during the body read. */
function untilAborted(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) reject(signal.reason);
    else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
}

describe('image attempt lifecycle', () => {
  beforeEach(async () => {
    ConcurrencyTracker.resetForTesting();
    OAuthAuthManager.resetForTesting();
    setConfigForTesting(config());
    await CooldownManager.getInstance().clearCooldown();
  });
  afterEach(async () => {
    jest.useRealTimers();
    await CooldownManager.getInstance().clearCooldown();
  });

  test('releases each admitted provider once on HTTP failover and success', async () => {
    const fetch = registerSpy(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('failed', { status: 500 }))
      .mockResolvedValueOnce(success());
    const tracker = ConcurrencyTracker.getInstance();
    const release = registerSpy(tracker, 'release');
    const result = await new Dispatcher().dispatchImageGenerations(request);
    expect(result.data).toEqual([{ b64_json: 'AA==' }]);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(release.mock.calls).toEqual([
      ['first', 'image'],
      ['second', 'image'],
    ]);
    expect(tracker.getSnapshot()).toEqual({ providers: {}, targets: {} });
  });

  test('never admits or fetches for an already cancelled caller', async () => {
    const fetch = registerSpy(globalThis, 'fetch');
    const acquire = registerSpy(ConcurrencyTracker.getInstance(), 'acquire');
    const controller = new AbortController();
    controller.abort();
    await expect(
      new Dispatcher().dispatchImageGenerations(request, controller.signal)
    ).rejects.toMatchObject({ routingContext: { statusCode: 499 } });
    expect(fetch).not.toHaveBeenCalled();
    expect(acquire).not.toHaveBeenCalled();
  });

  test.each(['headers', 'body'] as const)(
    'caller cancellation during %s stops failover and releases the slot',
    async (phase) => {
      const controller = new AbortController();
      let started!: () => void;
      const ready = new Promise<void>((resolve) => {
        started = resolve;
      });
      const fetch = registerSpy(globalThis, 'fetch').mockImplementation(
        async (_url: string | URL | Request, init?: RequestInit) => {
          const signal = init!.signal!;
          started();
          if (phase === 'headers') return untilAborted(signal);
          const response = success();
          response.json = () => untilAborted(signal);
          return response;
        }
      );
      const failure = registerSpy(CooldownManager.getInstance(), 'markProviderFailure');
      const release = registerSpy(ConcurrencyTracker.getInstance(), 'release');
      const dispatched = new Dispatcher().dispatchImageGenerations(request, controller.signal);
      const outcome = dispatched.then(
        () => 'resolved',
        (e: any) => `rejected:${e?.routingContext?.statusCode}`
      );
      await ready;
      controller.abort();
      expect(await outcome).toBe('rejected:499');
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(release).toHaveBeenCalledTimes(1);
      expect(failure).not.toHaveBeenCalled();
    }
  );

  test('deadline covers body consumption, fails over, and clears every attempt timer', async () => {
    jest.useFakeTimers();
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const fetch = registerSpy(globalThis, 'fetch')
      .mockImplementationOnce(async (_url: string | URL | Request, init?: RequestInit) => {
        const response = success();
        response.json = () => {
          started();
          return untilAborted(init!.signal!);
        };
        return response;
      })
      .mockResolvedValueOnce(success());
    const result = new Dispatcher().dispatchImageGenerations(request, undefined, () => 20);
    await ready;
    await advanceTimersByTimeAsync(20);
    expect((await result).plexus?.provider).toBe('second');
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(ConcurrencyTracker.getInstance().getSnapshot()).toEqual({ providers: {}, targets: {} });
    // Cooldown has its own scheduling; attempt signals must not abort after successful cleanup.
    const secondSignal = fetch.mock.calls[1]![1]!.signal!;
    await advanceTimersByTimeAsync(100);
    expect(secondSignal.aborted).toBe(false);
  });

  test('deadline stops waiting for shared OAuth setup without cancelling that setup', async () => {
    jest.useFakeTimers();
    const cfg = config();
    cfg.providers.first = {
      api_base_url: 'oauth://',
      oauth_provider: 'openai-codex',
      oauth_account: 'account',
      models: { image: { type: 'image', access_via: ['codex-images'] } },
    };
    setConfigForTesting(cfg);
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    let finishRefresh!: (token: string) => void;
    const sharedRefresh = new Promise<string>((resolve) => {
      finishRefresh = resolve;
    });
    registerSpy(OAuthAuthManager.getInstance(), 'getApiKey').mockImplementation(() => {
      started();
      return sharedRefresh;
    });
    const fetch = registerSpy(globalThis, 'fetch').mockResolvedValue(success());
    const result = new Dispatcher().dispatchImageGenerations(request, undefined, () => 20);
    await ready;
    await advanceTimersByTimeAsync(20);
    expect((await result).plexus?.provider).toBe('second');
    expect(fetch).toHaveBeenCalledTimes(1);
    finishRefresh('refreshed-token');
    await expect(sharedRefresh).resolves.toBe('refreshed-token');
    expect(ConcurrencyTracker.getInstance().getSnapshot()).toEqual({ providers: {}, targets: {} });
  });

  test('caller cancellation aborts reference downloads before an edit is dispatched', async () => {
    const controller = new AbortController();
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const fetch = registerSpy(globalThis, 'fetch').mockImplementation(
      async (_url: string | URL | Request, init?: RequestInit) => {
        started();
        return untilAborted(init!.signal!);
      }
    );
    const result = new Dispatcher().dispatchImageGenerations(
      {
        ...request,
        input_references: [
          { type: 'image_url', image_url: { url: 'https://images.example/reference.png' } },
        ],
      },
      controller.signal
    );
    const outcome = result.then(
      () => 'resolved',
      (e: any) => `rejected:${e?.routingContext?.statusCode}`
    );
    await ready;
    controller.abort();
    expect(await outcome).toBe('rejected:499');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(ConcurrencyTracker.getInstance().getSnapshot()).toEqual({ providers: {}, targets: {} });
  });
});
