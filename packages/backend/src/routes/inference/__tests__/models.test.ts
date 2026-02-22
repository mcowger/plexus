import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import path from 'path';
import Fastify from 'fastify';
import { registerModelsRoute } from '../models';
import { setConfigForTesting, PlexusConfig } from '../../../config';
import { ModelMetadataManager } from '../../../services/model-metadata-manager';

const FIXTURES = path.join(__dirname, '../../../utils/__tests__/fixtures');
const openrouterMetadataFixture = path.join(FIXTURES, 'openrouter-metadata-sample.json');

afterEach(() => {
  ModelMetadataManager.resetForTesting();
});

// ─── Basic alias listing (backward-compat) ──────────────

describe('GET /v1/models', () => {
  it('should return primary and additional aliases', async () => {
    const fastify = Fastify();
    await registerModelsRoute(fastify);

    const mockConfig = {
      models: {
        'gpt-4': {
          targets: [],
          additional_aliases: ['gpt-4-alias', 'my-gpt'],
        },
        'claude-3': {
          targets: [],
          // No additional aliases
        },
      },
    } as unknown as PlexusConfig;

    setConfigForTesting(mockConfig);

    const response = await fastify.inject({
      method: 'GET',
      url: '/v1/models',
    });

    expect(response.statusCode).toBe(200);
    const json = response.json();
    expect(json.object).toBe('list');
    const modelIds = json.data.map((m: any) => m.id);
    expect(modelIds).toContain('gpt-4');
    expect(modelIds).toContain('gpt-4-alias');
    expect(modelIds).toContain('my-gpt');
    expect(modelIds).toContain('claude-3');
    expect(modelIds.length).toBe(4);
  });

  it('should handle models without additional aliases', async () => {
    const fastify = Fastify();
    await registerModelsRoute(fastify);

    const mockConfig = {
      models: {
        'simple-model': {
          targets: [],
        },
      },
    } as unknown as PlexusConfig;

    setConfigForTesting(mockConfig);

    const response = await fastify.inject({
      method: 'GET',
      url: '/v1/models',
    });

    expect(response.statusCode).toBe(200);
    const json = response.json();
    const modelIds = json.data.map((m: any) => m.id);
    expect(modelIds).toEqual(['simple-model']);
  });

  it('should return base fields for aliases without metadata config', async () => {
    const fastify = Fastify();
    await registerModelsRoute(fastify);

    setConfigForTesting({
      models: {
        'plain-model': { targets: [] },
      },
    } as unknown as PlexusConfig);

    const response = await fastify.inject({ method: 'GET', url: '/v1/models' });
    expect(response.statusCode).toBe(200);

    const model = response.json().data[0];
    expect(model.id).toBe('plain-model');
    expect(model.object).toBe('model');
    expect(model.owned_by).toBe('plexus');
    expect(typeof model.created).toBe('number');
    // Should NOT have enriched fields
    expect(model.name).toBeUndefined();
    expect(model.context_length).toBeUndefined();
    expect(model.pricing).toBeUndefined();
  });
});

// ─── Metadata enrichment ───────────────────────────────────

describe('GET /v1/models – with metadata', () => {
  it('should include enriched fields when metadata is configured and source is loaded', async () => {
    // Pre-load the openrouter metadata
    const mgr = ModelMetadataManager.getInstance();
    await mgr.loadAll({
      openrouter: openrouterMetadataFixture,
      modelsDev: '/nonexistent',
      catwalk: '/nonexistent',
    });

    const fastify = Fastify();
    await registerModelsRoute(fastify);

    setConfigForTesting({
      models: {
        'claude-alias': {
          targets: [],
          metadata: {
            source: 'openrouter',
            source_path: 'anthropic/claude-3.5-sonnet',
          },
        },
      },
    } as unknown as PlexusConfig);

    const response = await fastify.inject({ method: 'GET', url: '/v1/models' });
    expect(response.statusCode).toBe(200);

    const model = response.json().data[0];
    expect(model.id).toBe('claude-alias');
    expect(model.object).toBe('model');
    expect(model.owned_by).toBe('plexus');
    // Enriched fields
    expect(model.name).toBe('Anthropic: Claude 3.5 Sonnet');
    expect(model.description).toContain('Claude 3.5 Sonnet');
    expect(model.context_length).toBe(200000);
    expect(model.pricing.prompt).toBe('0.000003');
    expect(model.pricing.completion).toBe('0.000015');
    expect(model.architecture.input_modalities).toContain('text');
    expect(model.supported_parameters).toContain('temperature');
    expect(model.top_provider.max_completion_tokens).toBe(8192);
  });

  it('should return base fields when metadata source_path is not found in catalog', async () => {
    const mgr = ModelMetadataManager.getInstance();
    await mgr.loadAll({
      openrouter: openrouterMetadataFixture,
      modelsDev: '/nonexistent',
      catwalk: '/nonexistent',
    });

    const fastify = Fastify();
    await registerModelsRoute(fastify);

    setConfigForTesting({
      models: {
        'unknown-model': {
          targets: [],
          metadata: {
            source: 'openrouter',
            source_path: 'nonexistent/model-that-doesnt-exist',
          },
        },
      },
    } as unknown as PlexusConfig);

    const response = await fastify.inject({ method: 'GET', url: '/v1/models' });
    expect(response.statusCode).toBe(200);

    const model = response.json().data[0];
    expect(model.id).toBe('unknown-model');
    expect(model.name).toBeUndefined();
    expect(model.context_length).toBeUndefined();
  });

  it('additional_aliases inherit parent metadata', async () => {
    const mgr = ModelMetadataManager.getInstance();
    await mgr.loadAll({
      openrouter: openrouterMetadataFixture,
      modelsDev: '/nonexistent',
      catwalk: '/nonexistent',
    });

    const fastify = Fastify();
    await registerModelsRoute(fastify);

    setConfigForTesting({
      models: {
        'claude-alias': {
          targets: [],
          additional_aliases: ['claude-alias-v2'],
          metadata: {
            source: 'openrouter',
            source_path: 'anthropic/claude-3.5-sonnet',
          },
        },
      },
    } as unknown as PlexusConfig);

    const response = await fastify.inject({ method: 'GET', url: '/v1/models' });
    const data = response.json().data;
    expect(data.length).toBe(2);

    const additionalAlias = data.find((m: any) => m.id === 'claude-alias-v2');
    expect(additionalAlias).toBeDefined();
    // Should have the same enriched metadata as the parent
    expect(additionalAlias.name).toBe('Anthropic: Claude 3.5 Sonnet');
    expect(additionalAlias.context_length).toBe(200000);
  });

  it('should return base fields when metadata source is not yet initialized', async () => {
    // Manager not loaded for any source
    const fastify = Fastify();
    await registerModelsRoute(fastify);

    setConfigForTesting({
      models: {
        'some-model': {
          targets: [],
          metadata: {
            source: 'openrouter',
            source_path: 'anthropic/claude-3.5-sonnet',
          },
        },
      },
    } as unknown as PlexusConfig);

    const response = await fastify.inject({ method: 'GET', url: '/v1/models' });
    expect(response.statusCode).toBe(200);

    const model = response.json().data[0];
    // Falls back to base fields when metadata source not loaded
    expect(model.id).toBe('some-model');
    expect(model.name).toBeUndefined();
  });
});

// ─── GET /v1/metadata/search ──────────────────────────────

describe('GET /v1/metadata/search', () => {
  it('should return 400 when source param is missing', async () => {
    const fastify = Fastify();
    await registerModelsRoute(fastify);
    setConfigForTesting({ models: {} } as unknown as PlexusConfig);

    const response = await fastify.inject({
      method: 'GET',
      url: '/v1/metadata/search',
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain('source');
  });

  it('should return 400 when source param is invalid', async () => {
    const fastify = Fastify();
    await registerModelsRoute(fastify);
    setConfigForTesting({ models: {} } as unknown as PlexusConfig);

    const response = await fastify.inject({
      method: 'GET',
      url: '/v1/metadata/search?source=unknown-source',
    });
    expect(response.statusCode).toBe(400);
  });

  it('should return 503 when source is not yet initialized', async () => {
    const fastify = Fastify();
    await registerModelsRoute(fastify);
    setConfigForTesting({ models: {} } as unknown as PlexusConfig);

    const response = await fastify.inject({
      method: 'GET',
      url: '/v1/metadata/search?source=openrouter',
    });
    expect(response.statusCode).toBe(503);
    expect(response.json().error).toContain('not yet loaded');
  });

  it('should return search results when source is initialized', async () => {
    const mgr = ModelMetadataManager.getInstance();
    await mgr.loadAll({
      openrouter: openrouterMetadataFixture,
      modelsDev: '/nonexistent',
      catwalk: '/nonexistent',
    });

    const fastify = Fastify();
    await registerModelsRoute(fastify);
    setConfigForTesting({ models: {} } as unknown as PlexusConfig);

    const response = await fastify.inject({
      method: 'GET',
      url: '/v1/metadata/search?source=openrouter&q=claude',
    });
    expect(response.statusCode).toBe(200);

    const json = response.json();
    expect(Array.isArray(json.data)).toBe(true);
    expect(json.count).toBeGreaterThan(0);
    // All results should match "claude"
    expect(
      json.data.every(
        (r: any) => r.id.toLowerCase().includes('claude') || r.name.toLowerCase().includes('claude')
      )
    ).toBe(true);
    // Each result has id and name
    expect(json.data[0]).toHaveProperty('id');
    expect(json.data[0]).toHaveProperty('name');
  });

  it('should return all models when no q param given', async () => {
    const mgr = ModelMetadataManager.getInstance();
    await mgr.loadAll({
      openrouter: openrouterMetadataFixture,
      modelsDev: '/nonexistent',
      catwalk: '/nonexistent',
    });

    const fastify = Fastify();
    await registerModelsRoute(fastify);
    setConfigForTesting({ models: {} } as unknown as PlexusConfig);

    const response = await fastify.inject({
      method: 'GET',
      url: '/v1/metadata/search?source=openrouter',
    });
    expect(response.statusCode).toBe(200);

    const json = response.json();
    expect(json.count).toBe(mgr.getAllIds('openrouter').length);
  });

  it('should respect the limit query parameter', async () => {
    const mgr = ModelMetadataManager.getInstance();
    await mgr.loadAll({
      openrouter: openrouterMetadataFixture,
      modelsDev: '/nonexistent',
      catwalk: '/nonexistent',
    });

    const fastify = Fastify();
    await registerModelsRoute(fastify);
    setConfigForTesting({ models: {} } as unknown as PlexusConfig);

    const response = await fastify.inject({
      method: 'GET',
      url: '/v1/metadata/search?source=openrouter&limit=1',
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().count).toBe(1);
    expect(response.json().data.length).toBe(1);
  });
});
