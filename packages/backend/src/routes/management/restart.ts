import { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { gracefulShutdown } from '../../services/runtime/graceful-shutdown';
import { logger } from '../../utils/logger';

const restartBodySchema = z.object({ force: z.boolean().optional() }).optional();
// A forced restart still has to deliver its own acknowledgement (and, when
// called through the management MCP tool, the outer MCP response). Draining
// first stops new requests and lets those responses flush before connections
// are destroyed.
const FORCED_RESTART_FLUSH_MS = 250;

export async function registerRestartRoutes(fastify: FastifyInstance) {
  /**
   * POST /v0/management/restart
   * Restart the application by draining in-flight requests (or, with
   * `{ "force": true }`, closing them immediately) and exiting.
   * The process manager (e.g., systemd, Docker, PM2) will restart the process.
   */
  fastify.post('/v0/management/restart', async (request, reply) => {
    const parsed = restartBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid request body', details: parsed.error.issues });
    }
    const force = parsed.data?.force === true;

    try {
      logger.info(`[RESTART] ${force ? 'Forced restart' : 'Restart'} requested via management API`);

      await reply.send({
        success: true,
        message: 'Server is restarting',
      });

      // Non-zero exit so `Restart=on-failure` style process managers respawn us.
      void gracefulShutdown.request('Restart via management API', 'drain', 1);
      if (force) {
        setTimeout(
          () => void gracefulShutdown.request('Forced restart via management API', 'force'),
          FORCED_RESTART_FLUSH_MS
        );
      }
    } catch (error: any) {
      logger.error('[RESTART] Error during restart:', error);
      return reply.code(500).send({
        error: {
          message: error.message || 'Failed to restart server',
          type: 'server_error',
        },
      });
    }
  });
}
