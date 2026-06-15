import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { registerSystemLogRoutes } from '../system-logs';

vi.mock('../../../utils/logger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/logger')>();
  return actual;
});

import { clearRecentLogsForTesting, logger } from '../../../utils/logger';

describe('system log routes', () => {
  let fastify: FastifyInstance;

  beforeAll(async () => {
    fastify = Fastify();
    await registerSystemLogRoutes(fastify);
    await fastify.ready();
  });

  afterEach(() => {
    clearRecentLogsForTesting();
  });

  test('returns recent system logs', async () => {
    logger.info('recent-system-log-test');
    await new Promise((resolve) => setTimeout(resolve, 20));

    const response = await fastify.inject({
      method: 'GET',
      url: '/v0/system/logs/recent?limit=10',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.total).toBeGreaterThanOrEqual(1);
    expect(body.data[0].message).toBe('recent-system-log-test');
  });
});
