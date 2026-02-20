import { FastifyInstance } from 'fastify';
import { getCurrentLogLevel, getStartupLogLevel, logger, resetCurrentLogLevel, setCurrentLogLevel, SUPPORTED_LOG_LEVELS } from '../../utils/logger';

export async function registerLoggingRoutes(fastify: FastifyInstance) {
  fastify.get('/v0/management/logging/level', async (_request, reply) => {
    return reply.send({
      level: getCurrentLogLevel(),
      startupLevel: getStartupLogLevel(),
      supportedLevels: SUPPORTED_LOG_LEVELS,
      ephemeral: true,
    });
  });

  fastify.post('/v0/management/logging/level', async (request, reply) => {
    const body = request.body as { level?: string } | undefined;
    const nextLevel = body?.level;

    if (typeof nextLevel !== 'string' || nextLevel.trim().length === 0) {
      return reply.code(400).send({
        error: 'Invalid request body. Expected: { level: string }',
        supportedLevels: SUPPORTED_LOG_LEVELS,
      });
    }

    const previousLevel = getCurrentLogLevel();

    try {
      const level = setCurrentLogLevel(nextLevel);
      logger.info(`Log level changed from '${previousLevel}' to '${level}' via management API`);

      return reply.send({
        level,
        startupLevel: getStartupLogLevel(),
        supportedLevels: SUPPORTED_LOG_LEVELS,
        ephemeral: true,
      });
    } catch (error: any) {
      return reply.code(400).send({
        error: error?.message || 'Invalid log level',
        supportedLevels: SUPPORTED_LOG_LEVELS,
      });
    }
  });

  fastify.delete('/v0/management/logging/level', async (_request, reply) => {
    const previousLevel = getCurrentLogLevel();
    const level = resetCurrentLogLevel();
    logger.info(`Log level reset from '${previousLevel}' to startup default '${level}' via management API`);

    return reply.send({
      level,
      startupLevel: getStartupLogLevel(),
      supportedLevels: SUPPORTED_LOG_LEVELS,
      ephemeral: true,
    });
  });
}
