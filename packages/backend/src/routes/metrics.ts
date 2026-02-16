import { FastifyInstance } from 'fastify';
import { MetricsService } from '../services/metrics-service';
import { logger } from '../utils/logger';

export async function registerMetricsRoutes(fastify: FastifyInstance, metricsService: MetricsService) {
  fastify.get('/metrics', async (_request, reply) => {
    try {
      const metrics = await metricsService.collectMetrics();
      const contentType = metricsService.getMetricsContentType();

      return reply
        .header('Content-Type', contentType)
        .send(metrics);
    } catch (error) {
      logger.error('Failed to serve metrics', error);
      return reply
        .code(500)
        .header('Content-Type', 'text/plain')
        .send('Internal Server Error');
    }
  });
}
