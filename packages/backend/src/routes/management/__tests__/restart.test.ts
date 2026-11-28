import { afterEach, beforeEach, describe, expect, jest, spyOn, test } from 'bun:test';

import Fastify, { type FastifyInstance } from 'fastify';

import { advanceTimersByTimeAsync } from '../../../../test/test-utils';
import { gracefulShutdown } from '../../../services/runtime/graceful-shutdown';
import { registerRestartRoutes } from '../restart';

describe('POST /v0/management/restart', () => {
  let fastify: FastifyInstance;
  let request: ReturnType<typeof spyOn<typeof gracefulShutdown, 'request'>>;

  beforeEach(async () => {
    request = spyOn(gracefulShutdown, 'request').mockResolvedValue(undefined);
    fastify = Fastify();
    await registerRestartRoutes(fastify);
  });

  afterEach(async () => {
    jest.useRealTimers();
    await fastify.close();
  });

  test('drains in-flight requests by default', async () => {
    const res = await fastify.inject({ method: 'POST', url: '/v0/management/restart' });

    expect(res.statusCode).toBe(200);
    expect(request).toHaveBeenCalledWith(expect.any(String), 'drain', 1);
  });

  test('escalates to a forced close once the acknowledgement has flushed', async () => {
    jest.useFakeTimers();
    const res = await fastify.inject({
      method: 'POST',
      url: '/v0/management/restart',
      payload: { force: true },
    });

    expect(res.statusCode).toBe(200);
    expect(request).toHaveBeenCalledWith(expect.any(String), 'drain', 1);
    expect(request).not.toHaveBeenCalledWith(expect.any(String), 'force');

    await advanceTimersByTimeAsync(1_000);
    expect(request).toHaveBeenCalledWith(expect.any(String), 'force');
  });

  test('rejects a non-boolean force without restarting', async () => {
    const res = await fastify.inject({
      method: 'POST',
      url: '/v0/management/restart',
      payload: { force: 'yes' },
    });

    expect(res.statusCode).toBe(400);
    expect(request).not.toHaveBeenCalled();
  });
});
