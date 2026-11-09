import { FastifyReply, FastifyRequest } from 'fastify';

import { logger } from '../utils/logger';

export const requestLogger = async (request: FastifyRequest, reply: FastifyReply) => {
  const { method, url } = request;
  // Query strings can contain bearer credentials, regardless of route or encoding.
  const path = url.split('?')[0];

  if (method === 'GET' || method === 'POST') {
    logger.debug(`${method} ${path}`);
  } else {
    logger.debug(`${method} ${path}`);
  }
};
