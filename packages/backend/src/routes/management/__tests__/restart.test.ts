import { afterEach, describe, expect, test, vi } from 'vitest';
import Fastify from 'fastify';
import { registerSpy } from '../../../../test/test-utils';
import { registerRestartRoutes } from '../restart';

afterEach(() => vi.useRealTimers());

describe('management restart', () => {
  test.each([false, true])(
    'awaits application shutdown before exiting (failure=%s)',
    async (fails) => {
      const app = Fastify();
      const stopped = Promise.withResolvers<void>();
      const shutdown = vi.fn(() => stopped.promise);
      const exit = registerSpy(process, 'exit').mockImplementation((() => undefined) as never);
      await registerRestartRoutes(app, shutdown);
      await app.ready();
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      try {
        const response = await app.inject({ method: 'POST', url: '/v0/management/restart' });
        expect(response.statusCode).toBe(200);
        await vi.advanceTimersByTimeAsync(100);
        expect(shutdown).toHaveBeenCalledTimes(1);
        expect(exit).not.toHaveBeenCalled();
        if (fails) stopped.reject(new Error('cleanup failed'));
        else stopped.resolve();
        await vi.advanceTimersByTimeAsync(1);
        expect(exit).toHaveBeenCalledWith(1);
      } finally {
        vi.useRealTimers();
        await app.close();
      }
    }
  );
});
