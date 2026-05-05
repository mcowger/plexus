import { FastifyInstance } from 'fastify';
import { logger } from '../../utils/logger';

export async function registerRestartRoutes(fastify: FastifyInstance) {
  /**
   * POST /v0/management/restart
   * Gracefully restart the application by closing the server and exiting.
   * The process manager (e.g., systemd, Docker, PM2) will restart the process.
   */
  fastify.post('/v0/management/restart', async (_request, reply) => {
    try {
      logger.info('[RESTART] Restart requested via management API');

      // Send success response before shutting down
      await reply.send({
        success: true,
        message: 'Server is restarting',
      });

      // Give the response time to be sent before closing
      setTimeout(async () => {
        logger.info('[RESTART] Closing server gracefully');
        await fastify.close();
        logger.info('[RESTART] Server closed, exiting process');
        process.exit(1);
      }, 100);
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
