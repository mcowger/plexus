/**
 * Tests for the logging level management routes.
 *
 * Reliability design (isolate: false):
 *   - No vi.mock for utils/logger in this file.  vitest.setup.ts owns that
 *     mock globally.  Per-file overrides race against the setup mock and lose
 *     intermittently because the route handler captures whichever binding was
 *     active at module-load time.
 *
 *   - All state is set and read exclusively through HTTP requests to the
 *     Fastify instance under test.  The test never calls setCurrentLogLevel()
 *     or getCurrentLogLevel() directly, so there is nothing shared to race on.
 *
 *   - beforeEach/afterEach both reset via the DELETE route so every test
 *     starts and leaves the level at 'info' (the startup default).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { registerLoggingRoutes } from '../logging';
import { SUPPORTED_LOG_LEVELS } from '../../../utils/logger';

describe('Logging management routes', () => {
  let fastify: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    fastify = Fastify();
    await registerLoggingRoutes(fastify);
    // Ensure we start from the startup default each test.
    await fastify.inject({ method: 'DELETE', url: '/v0/management/logging/level' });
  });

  afterEach(async () => {
    // Leave level clean for other tests in the shared module registry.
    await fastify.inject({ method: 'DELETE', url: '/v0/management/logging/level' });
    await fastify.close();
  });

  it('GET returns current level, startup level, supported levels, and ephemeral flag', async () => {
    const res = await fastify.inject({ method: 'GET', url: '/v0/management/logging/level' });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      level: string;
      startupLevel: string;
      supportedLevels: string[];
      ephemeral: boolean;
    };
    expect(body.startupLevel).toBe('info');
    expect(body.level).toBe('info');
    expect(body.supportedLevels).toEqual([...SUPPORTED_LOG_LEVELS]);
    expect(body.ephemeral).toBe(true);
  });

  it('PUT changes the level and the change is visible on subsequent GET', async () => {
    const putRes = await fastify.inject({
      method: 'PUT',
      url: '/v0/management/logging/level',
      payload: { level: 'debug' },
    });

    expect(putRes.statusCode).toBe(200);
    expect((putRes.json() as { level: string }).level).toBe('debug');

    // A subsequent GET must reflect the new level.
    const getRes = await fastify.inject({ method: 'GET', url: '/v0/management/logging/level' });
    expect((getRes.json() as { level: string }).level).toBe('debug');
  });

  it('PUT rejects unknown levels with 400 and leaves the level unchanged', async () => {
    const res = await fastify.inject({
      method: 'PUT',
      url: '/v0/management/logging/level',
      payload: { level: 'trace' },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: string; supportedLevels: string[] };
    expect(body.error).toContain('Invalid log level');
    expect(body.supportedLevels).toEqual([...SUPPORTED_LOG_LEVELS]);

    // Level must be unchanged after a rejected PUT.
    const getRes = await fastify.inject({ method: 'GET', url: '/v0/management/logging/level' });
    const getBody = getRes.json() as { level: string; startupLevel: string };
    expect(getBody.level).toBe(getBody.startupLevel);
  });

  it('DELETE resets a non-default level back to the startup default', async () => {
    // Use PUT to set a non-default level first (no direct logger calls).
    await fastify.inject({
      method: 'PUT',
      url: '/v0/management/logging/level',
      payload: { level: 'silly' },
    });
    expect(
      (
        (await fastify.inject({ method: 'GET', url: '/v0/management/logging/level' })).json() as {
          level: string;
        }
      ).level
    ).toBe('silly');

    const deleteRes = await fastify.inject({
      method: 'DELETE',
      url: '/v0/management/logging/level',
    });

    expect(deleteRes.statusCode).toBe(200);
    const body = deleteRes.json() as { level: string; startupLevel: string };
    expect(body.level).toBe('info');
    expect(body.startupLevel).toBe('info');
    expect(body.level).toBe(body.startupLevel);
  });
});
