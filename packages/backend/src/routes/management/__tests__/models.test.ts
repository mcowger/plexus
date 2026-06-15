import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { registerSpy } from '../../../../test/test-utils';
import { registerModelRoutes } from '../models';
import { ModelMetadataManager } from '../../../services/model-metadata-manager';

describe('management model routes', () => {
  let fastify: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    ModelMetadataManager.resetForTesting();
    fastify = Fastify();
    await registerModelRoutes(fastify);
  });

  afterEach(async () => {
    await fastify.close();
    ModelMetadataManager.resetForTesting();
  });

  test('POST /v0/management/models/metadata/refresh triggers a metadata refresh', async () => {
    registerSpy(ModelMetadataManager.getInstance(), 'refreshAll').mockResolvedValue({
      success: true,
      message: 'Model metadata refresh completed successfully',
      trigger: 'manual',
      refreshedAt: '2026-06-10T12:00:00.000Z',
      durationMs: 42,
      intervalMinutes: 60,
      hadErrors: false,
      sources: {
        openrouter: { source: 'openrouter', initialized: true, count: 1 },
        modelsDev: { source: 'models.dev', initialized: true, count: 2 },
        catwalk: { source: 'catwalk', initialized: true, count: 3 },
      },
    });

    const response = await fastify.inject({
      method: 'POST',
      url: '/v0/management/models/metadata/refresh',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      success: true,
      trigger: 'manual',
      intervalMinutes: 60,
      hadErrors: false,
      sources: {
        openrouter: { count: 1 },
        modelsDev: { count: 2 },
        catwalk: { count: 3 },
      },
    });
  });
});
