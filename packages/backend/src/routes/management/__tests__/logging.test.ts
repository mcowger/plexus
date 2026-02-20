import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import Fastify from 'fastify';
import { registerLoggingRoutes } from '../logging';
import { getCurrentLogLevel, getStartupLogLevel, resetCurrentLogLevel, setCurrentLogLevel, SUPPORTED_LOG_LEVELS } from '../../../utils/logger';

describe('Logging management routes', () => {
  let fastify: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    fastify = Fastify();
    await registerLoggingRoutes(fastify);
    resetCurrentLogLevel();
  });

  afterEach(async () => {
    resetCurrentLogLevel();
    await fastify.close();
  });

  it('returns current logging level state', async () => {
    const response = await fastify.inject({
      method: 'GET',
      url: '/v0/management/logging/level'
    });

    expect(response.statusCode).toBe(200);
    const json = response.json() as {
      level: string;
      startupLevel: string;
      supportedLevels: string[];
      ephemeral: boolean;
    };

    expect(json.level).toBe(getCurrentLogLevel());
    expect(json.startupLevel).toBe(getStartupLogLevel());
    expect(json.supportedLevels).toEqual([...SUPPORTED_LOG_LEVELS]);
    expect(json.ephemeral).toBe(true);
  });

  it('updates logging level via POST', async () => {
    const response = await fastify.inject({
      method: 'POST',
      url: '/v0/management/logging/level',
      payload: { level: 'debug' }
    });

    expect(response.statusCode).toBe(200);
    const json = response.json() as { level: string };
    expect(json.level).toBe('debug');
    expect(getCurrentLogLevel()).toBe('debug');
  });

  it('rejects invalid logging levels', async () => {
    const response = await fastify.inject({
      method: 'POST',
      url: '/v0/management/logging/level',
      payload: { level: 'trace' }
    });

    expect(response.statusCode).toBe(400);
    const json = response.json() as { error: string; supportedLevels: string[] };
    expect(json.error).toContain('Invalid log level');
    expect(json.supportedLevels).toEqual([...SUPPORTED_LOG_LEVELS]);
    expect(getCurrentLogLevel()).toBe(getStartupLogLevel());
  });

  it('resets logging level to startup default via DELETE', async () => {
    setCurrentLogLevel('silly');
    expect(getCurrentLogLevel()).toBe('silly');

    const response = await fastify.inject({
      method: 'DELETE',
      url: '/v0/management/logging/level'
    });

    expect(response.statusCode).toBe(200);
    const json = response.json() as { level: string; startupLevel: string };
    expect(json.level).toBe(getStartupLogLevel());
    expect(json.startupLevel).toBe(getStartupLogLevel());
    expect(getCurrentLogLevel()).toBe(getStartupLogLevel());
  });
});
