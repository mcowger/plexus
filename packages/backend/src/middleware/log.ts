import { FastifyRequest, FastifyReply } from 'fastify';
import { logger } from '../utils/logger';

export const requestLogger = async (request: FastifyRequest, reply: FastifyReply) => {
  const { method, url: path } = request;

  if (method === 'GET' || method === 'POST') {
    logger.debug(`${method} ${path}`);
  } else {
    logger.info(`${method} ${path}`);
  }
};
