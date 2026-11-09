import { describe, expect, test } from 'bun:test';

import Fastify from 'fastify';

import { mockLogger } from '../../../test/mocks';
import { requestLogger } from '../log';

describe('request logging', () => {
  test('does not log temporary download credentials', async () => {
    const app = Fastify();
    app.addHook('onRequest', requestLogger);
    app.get('/mcp/plexus/results/:id', async () => 'ok');
    try {
      await app.inject({ method: 'GET', url: '/mcp/plexus/results/id?token=secret' });
      expect(mockLogger.debug).toHaveBeenCalledWith('GET /mcp/plexus/results/id');
      await app.inject({ method: 'GET', url: '/mcp/plexus/r%65sults/id?token=encoded-secret' });
      expect(mockLogger.debug).toHaveBeenCalledWith('GET /mcp/plexus/r%65sults/id');
      await app.inject({ method: 'GET', url: '/other?token=other-secret' });
      expect(mockLogger.debug).toHaveBeenCalledWith('GET /other');
      expect(
        mockLogger.debug.mock.calls.some((args) => JSON.stringify(args).includes('secret'))
      ).toBe(false);
    } finally {
      await app.close();
    }
  });
});
