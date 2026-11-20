import { afterEach, beforeEach, describe, expect, jest, mock, spyOn, test } from 'bun:test';

import { advanceTimersByTimeAsync, asFetch } from '../../../../test/test-utils';
import { setConfigForTesting, validateConfig } from '../../../config';
import { ConcurrencyTracker } from '../../runtime/concurrency-tracker';
import { CooldownManager } from '../../runtime/cooldown-manager';
import { Dispatcher } from '../dispatcher';

const model = 'media-timeout';
const upstreamModel = 'upstream-model';

const media = {
  embeddings: {
    dispatch: (dispatcher: Dispatcher) => dispatcher.dispatchEmbeddings({ model, input: 'hello' }),
    success: () => Response.json({ model: upstreamModel, data: [{ embedding: [0.1], index: 0 }] }),
  },
  transcriptions: {
    dispatch: (dispatcher: Dispatcher) =>
      dispatcher.dispatchTranscription({
        model,
        file: Buffer.from('audio'),
        filename: 'audio.wav',
        mimeType: 'audio/wav',
      }),
    success: () => Response.json({ text: 'hello' }),
  },
  speech: {
    dispatch: (dispatcher: Dispatcher) =>
      dispatcher.dispatchSpeech({ model, input: 'hello', voice: 'alloy' }),
    success: () => new Response('audio', { headers: { 'content-type': 'audio/mpeg' } }),
  },
};

function configure(type: keyof typeof media, timeoutMs?: number, failover = true) {
  const provider = (name: string) => ({
    api_base_url: `https://${name}.example/v1`,
    api_key: 'key',
    maxConcurrency: 1,
    models: { [upstreamModel]: { type, access_via: [type] } },
  });
  setConfigForTesting(
    validateConfig(
      JSON.stringify({
        providers: { first: { ...provider('first'), timeoutMs }, second: provider('second') },
        models: {
          [model]: {
            type,
            target_groups: [
              {
                name: 'default',
                selector: 'in_order',
                targets: ['first', 'second'].map((provider) => ({
                  provider,
                  model: upstreamModel,
                })),
              },
            ],
          },
        },
        keys: {},
        timeout: { defaultSeconds: 1 },
        failover: { enabled: failover },
      })
    )
  );
}

const fetch = mock<(url: string | URL | Request, init?: RequestInit) => Promise<Response>>();
beforeEach(() => {
  fetch.mockReset();
  spyOn(globalThis, 'fetch').mockImplementation(asFetch(fetch));
});

describe('media provider timeouts', () => {
  beforeEach(async () => {
    ConcurrencyTracker.resetForTesting();
    await CooldownManager.getInstance().clearCooldown();
    jest.useFakeTimers();
  });

  afterEach(async () => {
    jest.useRealTimers();
    await CooldownManager.getInstance().clearCooldown();
  });

  test.each(['embeddings', 'transcriptions', 'speech'] as const)(
    '%s aborts a stalled response body at the provider deadline and fails over',
    async (type) => {
      const timeoutMs = 50;
      configure(type, timeoutMs);
      const { dispatch, success } = media[type];
      const started = Promise.withResolvers<AbortSignal | null | undefined>();
      fetch.mockImplementation(async (url, init) => {
        if (String(url).startsWith('https://second.example/')) return success();

        const signal = init?.signal;
        return new Response(
          new ReadableStream({
            start(controller) {
              signal?.addEventListener('abort', () => controller.error(signal.reason), {
                once: true,
              });
              started.resolve(signal);
            },
          })
        );
      });

      const result = dispatch(new Dispatcher());
      const firstSignal = await started.promise;
      await advanceTimersByTimeAsync(timeoutMs - 1);
      expect(firstSignal?.aborted).toBe(false);
      await advanceTimersByTimeAsync(1);
      expect(firstSignal?.aborted).toBe(true);
      expect(await result).toMatchObject({ plexus: { provider: 'second', attemptCount: 2 } });
      expect(ConcurrencyTracker.getInstance().getSnapshot()).toEqual({
        providers: {},
        targets: {},
      });

      await advanceTimersByTimeAsync(1000);
      expect(fetch.mock.calls[1]?.[1]?.signal?.aborted).toBe(false);
    }
  );

  test('uses the global deadline without an override and returns 504 when failover is disabled', async () => {
    configure('embeddings', undefined, false);
    const started = Promise.withResolvers<AbortSignal | null | undefined>();
    fetch.mockImplementation(async (_url, init) => {
      const signal = init?.signal;
      started.resolve(signal);
      const pending = Promise.withResolvers<Response>();
      signal?.addEventListener('abort', () => pending.reject(signal.reason), { once: true });
      return pending.promise;
    });

    const outcome = media.embeddings.dispatch(new Dispatcher()).catch((error: unknown) => error);
    const signal = await started.promise;
    await advanceTimersByTimeAsync(999);
    expect(signal?.aborted).toBe(false);
    await advanceTimersByTimeAsync(1);
    expect(signal?.aborted).toBe(true);
    expect(await outcome).toMatchObject({
      routingContext: { statusCode: 504, code: 'upstream_timeout' },
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
