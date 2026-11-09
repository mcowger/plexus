import { FastifyReply, FastifyRequest } from 'fastify';

import { logger } from '../utils/logger';

export const requestLogger = async (request: FastifyRequest, reply: FastifyReply) => {
  const { method, url } = request;
  // Download URLs carry bearer credentials; never write their query strings to logs.
  const path = url.startsWith('/mcp/plexus/results/') ? url.split('?')[0] : url;

  if (method === 'GET' || method === 'POST') {
    logger.debug(`${method} ${path}`);
  } else {
    logger.debug(`${method} ${path}`);
  }
};
