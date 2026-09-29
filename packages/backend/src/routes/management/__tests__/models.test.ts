import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { registerSpy } from '../../../../test/test-utils';
import { registerModelRoutes } from '../models';
import { ModelMetadataManager } from '../../../services/models/model-metadata-manager';
import { getModelCatalog, resetModelCatalogForTesting } from '../../../services/pi-ai/catalog';
import { CodexVersionService } from '../../../services/oauth/codex-version-service';
import { ClaudeCodeVersionService } from '../../../services/oauth/claude-code-version-service';
import { setConfigForTesting, type PlexusConfig } from '../../../config';

describe('management model routes', () => {
  let fastify: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    ModelMetadataManager.resetForTesting();
    resetModelCatalogForTesting();
    CodexVersionService.resetForTesting();
    ClaudeCodeVersionService.resetForTesting();
    fastify = Fastify();
    await registerModelRoutes(fastify);
  });

  afterEach(async () => {
    await fastify.close();
    ModelMetadataManager.resetForTesting();
    resetModelCatalogForTesting();
    CodexVersionService.resetForTesting();
    ClaudeCodeVersionService.resetForTesting();
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

  test('POST /v0/management/models/metadata/resolve previews automatic selections', async () => {
    setConfigForTesting({ providers: {}, models: {}, keys: {} } as PlexusConfig);

    const response = await fastify.inject({
      method: 'POST',
      url: '/v0/management/models/metadata/resolve',
      payload: {
        alias_id: 'company-assistant',
        model: {
          target_groups: [
            {
              name: 'default',
              selector: 'random',
              targets: [{ provider: 'company-proxy', model: 'gpt-5.2' }],
            },
          ],
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      canonical_model: { provider: 'openai', model: 'gpt-5.2', basis: 'target' },
      pi_model: { provider: 'openai', model_id: 'gpt-5.2', name: 'gpt-5.2' },
      metadata: { source: 'heuristic', name: 'GPT 5 2' },
      preferred_api: ['responses'],
    });
  });

  test('does not infer a preferred API for non-text models', async () => {
    setConfigForTesting({ providers: {}, models: {}, keys: {} } as PlexusConfig);

    const response = await fastify.inject({
      method: 'POST',
      url: '/v0/management/models/metadata/resolve',
      payload: {
        alias_id: 'embeddings',
        model: {
          type: 'embeddings',
          target_groups: [
            {
              name: 'default',
              selector: 'random',
              targets: [{ provider: 'google', model: 'gemini-embedding-001' }],
            },
          ],
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().preferred_api).toBeNull();
  });

  test('GET /v0/management/catalog/status reports intervals and versions', async () => {
    const response = await fastify.inject({
      method: 'GET',
      url: '/v0/management/catalog/status',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.intervals).toMatchObject({ metadataMinutes: 60, versionMinutes: 60 });
    expect(typeof body.intervals.piCatalogMs).toBe('number');
    expect(body.versions).toHaveProperty('codex');
    expect(body.versions).toHaveProperty('claudeCode');
    expect(body.metadata.openrouter).toHaveProperty('count');
    expect(body.metadata.modelsDev).toHaveProperty('count');
    expect(body.metadata.catwalk).toHaveProperty('count');
    expect(body.piCatalog).toHaveProperty('modelCount');
  });

  test('POST /v0/management/catalog/refresh-all refreshes every source', async () => {
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
    registerSpy(getModelCatalog(), 'refresh').mockResolvedValue({ refreshed: 5, errors: {} });
    registerSpy(CodexVersionService.getInstance(), 'fetchVersion').mockResolvedValue(undefined);
    registerSpy(ClaudeCodeVersionService.getInstance(), 'fetchVersion').mockResolvedValue(
      undefined
    );

    const response = await fastify.inject({
      method: 'POST',
      url: '/v0/management/catalog/refresh-all',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toMatchObject({
      success: true,
      trigger: 'manual',
      hadErrors: false,
    });
    expect(body.metadata.sources).toMatchObject({
      openrouter: { count: 1 },
      modelsDev: { count: 2 },
      catwalk: { count: 3 },
    });
    expect(body.piCatalog).toEqual({ refreshed: 5, errors: {} });
    expect(body.versions.codex).toHaveProperty('current');
    expect(body.versions.codex).not.toHaveProperty('error');
    expect(body.versions.claudeCode).toHaveProperty('current');
    expect(body.versions.claudeCode).not.toHaveProperty('error');
    expect(typeof body.durationMs).toBe('number');
  });

  test('POST /v0/management/catalog/refresh-all surfaces partial failures', async () => {
    registerSpy(ModelMetadataManager.getInstance(), 'refreshAll').mockResolvedValue({
      success: false,
      message: 'Model metadata refresh completed with errors',
      trigger: 'manual',
      refreshedAt: '2026-06-10T12:00:00.000Z',
      durationMs: 42,
      intervalMinutes: 60,
      hadErrors: true,
      sources: {
        openrouter: { source: 'openrouter', initialized: true, count: 1 },
        modelsDev: { source: 'models.dev', initialized: true, count: 2 },
        catwalk: { source: 'catwalk', initialized: false, count: 0, error: 'boom' },
      },
    });
    registerSpy(getModelCatalog(), 'refresh').mockResolvedValue({
      refreshed: 4,
      errors: { openai: 'boom' },
    });
    registerSpy(CodexVersionService.getInstance(), 'fetchVersion').mockResolvedValue(undefined);
    registerSpy(ClaudeCodeVersionService.getInstance(), 'fetchVersion').mockResolvedValue(
      undefined
    );

    const response = await fastify.inject({
      method: 'POST',
      url: '/v0/management/catalog/refresh-all',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toMatchObject({ success: false, hadErrors: true });
    expect(body.metadata.sources.catwalk.error).toBe('boom');
    expect(body.piCatalog.errors).toEqual({ openai: 'boom' });
  });

  test('POST /v0/management/catalog/refresh-all surfaces version failures', async () => {
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
    registerSpy(getModelCatalog(), 'refresh').mockResolvedValue({ refreshed: 5, errors: {} });
    registerSpy(CodexVersionService.getInstance(), 'fetchVersion').mockResolvedValue(
      'GitHub API returned status 403'
    );
    registerSpy(ClaudeCodeVersionService.getInstance(), 'fetchVersion').mockResolvedValue(
      undefined
    );

    const response = await fastify.inject({
      method: 'POST',
      url: '/v0/management/catalog/refresh-all',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toMatchObject({ success: false, hadErrors: true });
    expect(body.versions.codex.error).toBe('GitHub API returned status 403');
    expect(body.versions.claudeCode).not.toHaveProperty('error');
  });

  test('POST /v0/management/catalog/refresh-all respects the catalog opt-out', async () => {
    const previous = process.env.PLEXUS_MODEL_CATALOG_REFRESH;
    process.env.PLEXUS_MODEL_CATALOG_REFRESH = 'false';
    try {
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
      const refreshSpy = registerSpy(getModelCatalog(), 'refresh').mockResolvedValue({
        refreshed: 5,
        errors: {},
      });
      registerSpy(CodexVersionService.getInstance(), 'fetchVersion').mockResolvedValue(undefined);
      registerSpy(ClaudeCodeVersionService.getInstance(), 'fetchVersion').mockResolvedValue(
        undefined
      );

      const response = await fastify.inject({
        method: 'POST',
        url: '/v0/management/catalog/refresh-all',
      });

      expect(response.statusCode).toBe(200);
      expect(refreshSpy).toHaveBeenCalledWith({ force: true, allowNetwork: false });
    } finally {
      if (previous === undefined) {
        delete process.env.PLEXUS_MODEL_CATALOG_REFRESH;
      } else {
        process.env.PLEXUS_MODEL_CATALOG_REFRESH = previous;
      }
    }
  });
});
