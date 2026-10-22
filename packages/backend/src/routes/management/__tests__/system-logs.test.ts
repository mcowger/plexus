import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from 'bun:test';

import Fastify, { FastifyInstance } from 'fastify';

import { actualLogger, loggerMockModule } from '../../../../test/mocks';
import { registerSystemLogRoutes } from '../system-logs';

// This file exercises real log capture; the preload installs a mocked logger.
mock.module('../../../utils/logger', () => actualLogger);
const { clearRecentLogsForTesting, logger } = actualLogger;

afterAll(() => {
  mock.module('../../../utils/logger', () => loggerMockModule);
});

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
    expect(body.limit).toBe(10);
    expect(body.offset).toBe(0);
    expect(body.data[0].message).toBe('recent-system-log-test');
  });

  test('supports offset pagination', async () => {
    logger.info('older-log');
    logger.info('newer-log');
    await new Promise((resolve) => setTimeout(resolve, 20));

    const response = await fastify.inject({
      method: 'GET',
      url: '/v0/system/logs/recent?limit=1&offset=1',
    });

    expect(response.json()).toMatchObject({
      data: [expect.objectContaining({ message: 'older-log' })],
      limit: 1,
      offset: 1,
    });
  });
});
