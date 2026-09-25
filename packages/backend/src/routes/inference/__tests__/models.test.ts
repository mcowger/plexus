import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import Fastify from 'fastify';
import { registerModelsRoute } from '../models';
import { setConfigForTesting, PlexusConfig } from '../../../config';
import { ModelMetadataManager } from '../../../services/models/model-metadata-manager';

const FIXTURES = path.join(__dirname, '../../../utils/__tests__/fixtures');
const openrouterMetadataFixture = path.join(FIXTURES, 'openrouter-metadata-sample.json');
const openrouterPricingFixture = path.join(FIXTURES, 'openrouter-models.json');

afterEach(() => {
  ModelMetadataManager.resetForTesting();
});

// ─── Basic alias listing (backward-compat) ──────────────

describe('GET /v1/models', () => {
  it('should return only primary aliases (not additional_aliases)', async () => {
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
    expect(modelIds).not.toContain('gpt-4-alias');
    expect(modelIds).not.toContain('my-gpt');
    expect(modelIds).toContain('claude-3');
    expect(modelIds.length).toBe(2);
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

  it('should infer preferred APIs from model families while preserving explicit values', async () => {
    const fastify = Fastify();
    await registerModelsRoute(fastify);

    setConfigForTesting({
      models: {
        'claude-sonnet-4-5': { targets: [] },
        'gpt-5.2': { targets: [] },
        'gemini-2.5-pro': { targets: [] },
        'gemini-embedding-001': { targets: [], type: 'embeddings' },
        'mistral-large': { targets: [] },
        'gpt-explicit': { targets: [], preferred_api: ['chat_completions'] },
      },
    } as unknown as PlexusConfig);

    const response = await fastify.inject({ method: 'GET', url: '/v1/models' });
    const models = new Map(response.json().data.map((model: any) => [model.id, model]));

    expect((models.get('claude-sonnet-4-5') as any).preferred_api).toEqual(['messages']);
    expect((models.get('gpt-5.2') as any).preferred_api).toEqual(['responses']);
    expect((models.get('gemini-2.5-pro') as any).preferred_api).toEqual(['gemini']);
    expect((models.get('gemini-embedding-001') as any).preferred_api).toBeUndefined();
    expect((models.get('mistral-large') as any).preferred_api).toEqual(['chat_completions']);
    expect((models.get('gpt-explicit') as any).preferred_api).toEqual(['chat_completions']);
  });

  it('should infer safe metadata defaults for aliases without metadata config', async () => {
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
    expect(model.name).toBe('Plain Model');
    expect(model.architecture.input_modalities).toEqual(['text']);
    expect(model.architecture.output_modalities).toEqual(['text']);
    expect(model.context_length).toBeUndefined();
    expect(model.pricing).toBeUndefined();
  });

  it('should return only base fields when metadata enrichment is disabled', async () => {
    const fastify = Fastify();
    await registerModelsRoute(fastify);

    setConfigForTesting({
      models: {
        'plain-model': { targets: [], metadata: { source: 'disabled' } },
      },
    } as unknown as PlexusConfig);

    const response = await fastify.inject({ method: 'GET', url: '/v1/models' });
    const model = response.json().data[0];
    expect(model.id).toBe('plain-model');
    expect(model.name).toBeUndefined();
    expect(model.architecture).toBeUndefined();
  });
});

// ─── Reasoning options from the pi-ai catalog ──────────────

describe('GET /v1/models – reasoning_options', () => {
  it('exposes canonical effort levels for auto-identified reasoning models', async () => {
    const fastify = Fastify();
    await registerModelsRoute(fastify);

    setConfigForTesting({
      models: {
        // Auto-identifies to the pi-ai catalog (openai / gpt-5.6-luna), which
        // is reasoning-capable with a gpt-5.6 thinkingLevelMap.
        'gpt-5.6-luna': { targets: [] },
      },
    } as unknown as PlexusConfig);

    const response = await fastify.inject({ method: 'GET', url: '/v1/models' });
    expect(response.statusCode).toBe(200);

    const model = response.json().data[0];
    expect(model.reasoning_options).toEqual([
      {
        type: 'effort',
        values: ['off', 'low', 'medium', 'high', 'xhigh', 'max'],
      },
    ]);
  });

  it('omits reasoning_options when the resolved pi model is not reasoning-capable', async () => {
    const fastify = Fastify();
    await registerModelsRoute(fastify);

    setConfigForTesting({
      models: {
        'claude-alias': {
          targets: [],
          pi_model: { provider: 'anthropic', model_id: 'claude-test' },
        },
      },
    } as unknown as PlexusConfig);

    const response = await fastify.inject({ method: 'GET', url: '/v1/models' });
    const model = response.json().data[0];
    expect(model.pi_model).toBe('claude-test');
    expect(model.reasoning_options).toBeUndefined();
  });

  it('omits reasoning_options when no pi model can be resolved', async () => {
    const fastify = Fastify();
    await registerModelsRoute(fastify);

    setConfigForTesting({
      models: {
        'plain-model': { targets: [] },
      },
    } as unknown as PlexusConfig);

    const response = await fastify.inject({ method: 'GET', url: '/v1/models' });
    const model = response.json().data[0];
    expect(model.reasoning_options).toBeUndefined();
  });
});

describe('GET /v1/models – inline compatibility metadata', () => {
  it('uses exact target model quirks without fabricating pi-ai identities', async () => {
    const fastify = Fastify();
    await registerModelsRoute(fastify);
    setConfigForTesting({
      providers: {
        proxy: {
          api_base_url: { chat: 'https://example.test/v1', responses: 'https://example.test/v1' },
          api_key: 'sk-test',
          pi_ai_quirks: {
            chat: {
              api: 'openai-completions',
              reasoning: true,
              thinkingLevelMap: { off: 'none', high: 'high' },
              compat: { supportsTemperature: false },
              models: {
                'upstream/special': {
                  reasoning: false,
                  compat: { maxTokensField: 'max_completion_tokens' },
                },
              },
            },
            responses: { api: 'openai-responses', maxTokens: 128 },
          },
        },
      },
      models: {
        'gpt-5.6-luna': {
          preferred_api: ['chat_completions'],
          target_groups: [
            {
              name: 'primary',
              selector: 'in_order',
              targets: [{ provider: 'proxy', model: 'upstream/special' }],
            },
          ],
        },
        'custom-reasoning': {
          preferred_api: ['chat_completions'],
          target_groups: [
            {
              name: 'primary',
              selector: 'in_order',
              targets: [{ provider: 'proxy', model: 'upstream/other' }],
            },
          ],
        },
        'ambiguous-api': {
          preferred_api: ['chat_completions', 'responses'],
          target_groups: [
            {
              name: 'primary',
              selector: 'in_order',
              targets: [{ provider: 'proxy', model: 'upstream/other' }],
            },
          ],
        },
        'explicit-link': {
          pi_model: { provider: 'anthropic', model_id: 'claude-test' },
          preferred_api: ['chat_completions'],
          target_groups: [
            {
              name: 'primary',
              selector: 'in_order',
              targets: [{ provider: 'proxy', model: 'upstream/other' }],
            },
          ],
        },
      },
    } as unknown as PlexusConfig);

    const response = await fastify.inject({ method: 'GET', url: '/v1/models' });
    expect(response.statusCode).toBe(200);
    const listed = new Map(response.json().data.map((model: { id: string }) => [model.id, model]));
    expect(listed.get('gpt-5.6-luna')).toMatchObject({
      pi_options: { supportsTemperature: false, maxTokensField: 'max_completion_tokens' },
    });
    expect(listed.get('gpt-5.6-luna')).not.toHaveProperty('pi_provider');
    expect(listed.get('gpt-5.6-luna')).not.toHaveProperty('pi_model');
    expect(listed.get('gpt-5.6-luna')).not.toHaveProperty('reasoning_options');
    expect(listed.get('custom-reasoning')).toMatchObject({
      reasoning_options: [{ type: 'effort', values: ['off', 'high'] }],
      pi_options: { supportsTemperature: false },
    });
    expect(listed.get('custom-reasoning')).not.toHaveProperty('pi_provider');
    expect(listed.get('ambiguous-api')).not.toHaveProperty('pi_options');
    expect(listed.get('ambiguous-api')).not.toHaveProperty('reasoning_options');
    expect(listed.get('explicit-link')).toMatchObject({
      pi_provider: 'anthropic',
      pi_model: 'claude-test',
    });
    await fastify.close();
  });
});

// ─── Vision fallthrough modality injection ──────────────

describe('GET /v1/models – vision fallthrough modalities', () => {
  it('should add image to input_modalities when use_image_fallthrough is true without metadata', async () => {
    const fastify = Fastify();
    await registerModelsRoute(fastify);

    setConfigForTesting({
      vision_fallthrough: { descriptor_model: 'test-descriptor', descriptor_provider: 'openai' },
      models: {
        'vf-model': { targets: [], use_image_fallthrough: true },
        'no-vf-model': { targets: [] },
      },
    } as unknown as PlexusConfig);

    const response = await fastify.inject({ method: 'GET', url: '/v1/models' });
    expect(response.statusCode).toBe(200);

    const data = response.json().data;
    const vfModel = data.find((m: any) => m.id === 'vf-model');
    const noVfModel = data.find((m: any) => m.id === 'no-vf-model');

    expect(vfModel.architecture.input_modalities).toEqual(['text', 'image']);
    expect(vfModel.architecture.output_modalities).toEqual(['text']);
    expect(noVfModel.architecture.input_modalities).toEqual(['text']);
    expect(noVfModel.architecture.output_modalities).toEqual(['text']);
  });

  it('should not add image when vision_fallthrough is not configured globally', async () => {
    const fastify = Fastify();
    await registerModelsRoute(fastify);

    setConfigForTesting({
      models: {
        'vf-model': { targets: [], use_image_fallthrough: true },
      },
    } as unknown as PlexusConfig);

    const response = await fastify.inject({ method: 'GET', url: '/v1/models' });
    expect(response.statusCode).toBe(200);

    const model = response.json().data[0];
    expect(model.architecture.input_modalities).toEqual(['text']);
    expect(model.architecture.output_modalities).toEqual(['text']);
  });

  it('should inject image into existing modalities when metadata is present', async () => {
    const mgr = ModelMetadataManager.getInstance();
    await mgr.loadAll({
      openrouter: openrouterMetadataFixture,
      modelsDev: '/nonexistent',
      catwalk: '/nonexistent',
    });

    const fastify = Fastify();
    await registerModelsRoute(fastify);

    setConfigForTesting({
      vision_fallthrough: { descriptor_model: 'test-descriptor', descriptor_provider: 'openai' },
      models: {
        'text-only-model': {
          targets: [],
          use_image_fallthrough: true,
          metadata: {
            source: 'custom',
            overrides: {
              name: 'Text Only Model',
              architecture: {
                input_modalities: ['text'],
                output_modalities: ['text'],
              },
            },
          },
        },
      },
    } as unknown as PlexusConfig);

    const response = await fastify.inject({ method: 'GET', url: '/v1/models' });
    expect(response.statusCode).toBe(200);

    const model = response.json().data[0];
    expect(model.architecture.input_modalities).toContain('image');
    expect(model.architecture.input_modalities).toContain('text');
    expect(model.architecture.output_modalities).toEqual(['text']);
  });

  it('should not duplicate image if already in input_modalities', async () => {
    const mgr = ModelMetadataManager.getInstance();
    await mgr.loadAll({
      openrouter: openrouterMetadataFixture,
      modelsDev: '/nonexistent',
      catwalk: '/nonexistent',
    });

    const fastify = Fastify();
    await registerModelsRoute(fastify);

    setConfigForTesting({
      vision_fallthrough: { descriptor_model: 'test-descriptor', descriptor_provider: 'openai' },
      models: {
        'vision-model': {
          targets: [],
          use_image_fallthrough: true,
          metadata: {
            source: 'custom',
            overrides: {
              name: 'Vision Model',
              architecture: {
                input_modalities: ['text', 'image'],
                output_modalities: ['text'],
              },
            },
          },
        },
      },
    } as unknown as PlexusConfig);

    const response = await fastify.inject({ method: 'GET', url: '/v1/models' });
    expect(response.statusCode).toBe(200);

    const model = response.json().data[0];
    const imageCount = model.architecture.input_modalities.filter(
      (m: string) => m === 'image'
    ).length;
    expect(imageCount).toBe(1);
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
    expect(model.pricing.tiers).toEqual([
      {
        input_tokens_above: 272000,
        prompt: '0.000010',
        completion: '0.000045',
        input_cache_read: '0.000001',
        input_cache_write: '0.0000125',
      },
    ]);
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

  it('additional_aliases are excluded from /v1/models', async () => {
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
    expect(data.length).toBe(1);

    const primaryAlias = data.find((m: any) => m.id === 'claude-alias');
    expect(primaryAlias).toBeDefined();
    expect(primaryAlias.name).toBe('Anthropic: Claude 3.5 Sonnet');
    expect(primaryAlias.context_length).toBe(200000);

    const additionalAlias = data.find((m: any) => m.id === 'claude-alias-v2');
    expect(additionalAlias).toBeUndefined();
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

describe('GET /v1/models - Caching', () => {
  it('should return ETag and Last-Modified headers and support 304 Not Modified', async () => {
    const fastify = Fastify();
    await registerModelsRoute(fastify);

    setConfigForTesting({
      models: {
        'cached-model': { targets: [] },
      },
    } as unknown as PlexusConfig);

    // Initial request
    const response1 = await fastify.inject({ method: 'GET', url: '/v1/models' });
    expect(response1.statusCode).toBe(200);
    const etag = response1.headers.etag;
    const lastModified = response1.headers['last-modified'];
    expect(etag).toBeDefined();
    expect(lastModified).toBeDefined();

    // Second request with If-None-Match
    const response2 = await fastify.inject({
      method: 'GET',
      url: '/v1/models',
      headers: {
        'if-none-match': etag as string,
      },
    });
    expect(response2.statusCode).toBe(304);

    // Third request with If-Modified-Since
    const response3 = await fastify.inject({
      method: 'GET',
      url: '/v1/models',
      headers: {
        'if-modified-since': lastModified as string,
      },
    });
    expect(response3.statusCode).toBe(304);
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

  it('should return OpenRouter non-chat models matched by modality or description', async () => {
    const mgr = ModelMetadataManager.getInstance();
    await mgr.loadAll({
      openrouter: openrouterMetadataFixture,
      modelsDev: '/nonexistent',
      catwalk: '/nonexistent',
    });

    const fastify = Fastify();
    await registerModelsRoute(fastify);
    setConfigForTesting({ models: {} } as unknown as PlexusConfig);

    const audioResponse = await fastify.inject({
      method: 'GET',
      url: '/v1/metadata/search?source=openrouter&q=audio',
    });
    expect(audioResponse.statusCode).toBe(200);
    expect(audioResponse.json().data.map((r: any) => r.id)).toContain('openai/gpt-audio');

    const transcriptionResponse = await fastify.inject({
      method: 'GET',
      url: '/v1/metadata/search?source=openrouter&q=transcribe',
    });
    expect(transcriptionResponse.statusCode).toBe(200);
    expect(transcriptionResponse.json().data.map((r: any) => r.id)).toContain(
      'mistralai/voxtral-small-24b-2507'
    );
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

// ─── GET /v1/metadata/lookup ──────────────────────────────

describe('GET /v1/metadata/lookup', () => {
  it('should return 400 when source param is missing', async () => {
    const fastify = Fastify();
    await registerModelsRoute(fastify);
    setConfigForTesting({ models: {} } as unknown as PlexusConfig);

    const response = await fastify.inject({
      method: 'GET',
      url: '/v1/metadata/lookup?source_path=anthropic/claude-3.5-sonnet',
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain('source');
  });

  it('should return 400 when source_path param is missing', async () => {
    const fastify = Fastify();
    await registerModelsRoute(fastify);
    setConfigForTesting({ models: {} } as unknown as PlexusConfig);

    const response = await fastify.inject({
      method: 'GET',
      url: '/v1/metadata/lookup?source=openrouter',
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain('source_path');
  });

  it('should return 503 when source is not yet initialized', async () => {
    const fastify = Fastify();
    await registerModelsRoute(fastify);
    setConfigForTesting({ models: {} } as unknown as PlexusConfig);

    const response = await fastify.inject({
      method: 'GET',
      url: '/v1/metadata/lookup?source=openrouter&source_path=anthropic/claude-3.5-sonnet',
    });
    expect(response.statusCode).toBe(503);
  });

  it('should return 404 when source_path is not found', async () => {
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
      url: '/v1/metadata/lookup?source=openrouter&source_path=does/not-exist',
    });
    expect(response.statusCode).toBe(404);
  });

  it('should return full normalized metadata for a known model', async () => {
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
      url: '/v1/metadata/lookup?source=openrouter&source_path=anthropic/claude-3.5-sonnet',
    });
    expect(response.statusCode).toBe(200);

    const meta = response.json().data;
    expect(meta.id).toBe('anthropic/claude-3.5-sonnet');
    expect(meta.name).toBe('Anthropic: Claude 3.5 Sonnet');
    expect(meta.context_length).toBe(200000);
    expect(meta.pricing.prompt).toBe('0.000003');
    expect(meta.pricing.completion).toBe('0.000015');
    expect(meta.architecture.input_modalities).toContain('image');
    expect(meta.supported_parameters).toContain('tools');
    expect(meta.top_provider.max_completion_tokens).toBe(8192);
  });
});

// ─── GET /v1/openrouter/models ──────────────────────────────

describe('GET /v1/openrouter/models', () => {
  it('should return 503 when the catalog is not yet initialized', async () => {
    const fastify = Fastify();
    await registerModelsRoute(fastify);
    setConfigForTesting({ models: {} } as unknown as PlexusConfig);

    const response = await fastify.inject({
      method: 'GET',
      url: '/v1/openrouter/models',
    });
    expect(response.statusCode).toBe(503);
  });

  it('should return slugs from the shared metadata catalog, filtered by q', async () => {
    const mgr = ModelMetadataManager.getInstance();
    await mgr.loadAll({
      openrouter: openrouterPricingFixture,
      modelsDev: '/nonexistent',
      catwalk: '/nonexistent',
    });

    const fastify = Fastify();
    await registerModelsRoute(fastify);
    setConfigForTesting({ models: {} } as unknown as PlexusConfig);

    const all = await fastify.inject({ method: 'GET', url: '/v1/openrouter/models' });
    expect(all.statusCode).toBe(200);
    expect(all.json().count).toBe(mgr.getAllIds('openrouter').length);

    const filtered = await fastify.inject({
      method: 'GET',
      url: '/v1/openrouter/models?q=claude',
    });
    expect(filtered.statusCode).toBe(200);
    const slugs = filtered.json().data;
    expect(slugs.length).toBeGreaterThan(0);
    expect(slugs.every((slug: string) => slug.toLowerCase().includes('claude'))).toBe(true);
  });

  it('should reflect catalog refreshes without a restart', async () => {
    const mgr = ModelMetadataManager.getInstance();
    await mgr.loadAll({
      openrouter: openrouterPricingFixture,
      modelsDev: '/nonexistent',
      catwalk: '/nonexistent',
    });

    const fastify = Fastify();
    await registerModelsRoute(fastify);
    setConfigForTesting({ models: {} } as unknown as PlexusConfig);

    // gpt-4.1-nano only exists in the metadata-sample fixture
    const before = await fastify.inject({
      method: 'GET',
      url: '/v1/openrouter/models?q=gpt-4.1-nano',
    });
    expect(before.json().data).toEqual([]);

    // Simulate a scheduled/manual catalog refresh swapping in new data
    await mgr.loadAll({
      openrouter: openrouterMetadataFixture,
      modelsDev: '/nonexistent',
      catwalk: '/nonexistent',
    });

    const after = await fastify.inject({
      method: 'GET',
      url: '/v1/openrouter/models?q=gpt-4.1-nano',
    });
    expect(after.json().data).toEqual(['openai/gpt-4.1-nano']);
  });
});

describe('GET /v1/openrouter/models - Caching', () => {
  it('should return ETag and Last-Modified headers and support 304 Not Modified', async () => {
    const mgr = ModelMetadataManager.getInstance();
    await mgr.loadAll({
      openrouter: openrouterPricingFixture,
      modelsDev: '/nonexistent',
      catwalk: '/nonexistent',
    });

    const fastify = Fastify();
    await registerModelsRoute(fastify);
    setConfigForTesting({ models: {} } as unknown as PlexusConfig);

    // Initial request
    const response1 = await fastify.inject({ method: 'GET', url: '/v1/openrouter/models' });
    expect(response1.statusCode).toBe(200);
    const etag = response1.headers.etag;
    const lastModified = response1.headers['last-modified'];
    expect(etag).toBeDefined();
    expect(lastModified).toBeDefined();

    // Second request with If-None-Match
    const response2 = await fastify.inject({
      method: 'GET',
      url: '/v1/openrouter/models',
      headers: {
        'if-none-match': etag as string,
      },
    });
    expect(response2.statusCode).toBe(304);

    // Third request with If-Modified-Since
    const response3 = await fastify.inject({
      method: 'GET',
      url: '/v1/openrouter/models',
      headers: {
        'if-modified-since': lastModified as string,
      },
    });
    expect(response3.statusCode).toBe(304);
  });
});

// ─── GET /v1/models?ui ────────────────────────────────────

describe('GET /v1/models?ui', () => {
  const extractEmbeddedJson = (html: string) => {
    const match = html.match(
      /<script id="models-data" type="application\/json">([\s\S]*?)<\/script>/
    );
    expect(match).not.toBeNull();
    const raw = match![1];
    expect(raw).toBeDefined();
    return JSON.parse(raw as string);
  };

  it('should return a Plexus-styled HTML viewer instead of JSON', async () => {
    const fastify = Fastify();
    await registerModelsRoute(fastify);

    setConfigForTesting({
      models: {
        'plain-model': { targets: [] },
      },
    } as unknown as PlexusConfig);

    const response = await fastify.inject({ method: 'GET', url: '/v1/models?ui' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');

    const html = response.body;
    // Uses the vanilla-jsoneditor npm library (not a hand-rolled viewer).
    expect(html).toContain('vanilla-jsoneditor');
    expect(html).toContain('id="models-tree"');
    // Plexus theme tokens, but no admin UI shell.
    expect(html).toContain('#f59e0b');
    expect(html).toContain('Space Grotesk');
    expect(html).not.toContain('/ui/');
    expect(html).not.toContain('id="root"');

    // Embeds the exact same payload the JSON endpoint returns.
    const uiPayload = extractEmbeddedJson(html);
    expect(uiPayload.object).toBe('list');
    expect(uiPayload.data.map((m: any) => m.id)).toEqual(['plain-model']);

    const jsonResponse = await fastify.inject({ method: 'GET', url: '/v1/models' });
    expect(jsonResponse.headers['content-type']).toContain('application/json');
    expect(uiPayload).toEqual(jsonResponse.json());
  });

  it('should return the viewer for any ui query value', async () => {
    const fastify = Fastify();
    await registerModelsRoute(fastify);

    setConfigForTesting({ models: {} } as unknown as PlexusConfig);

    for (const url of ['/v1/models?ui=true', '/v1/models?ui=0']) {
      const response = await fastify.inject({ method: 'GET', url });
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/html');
    }
  });

  it('should escape embedded script-breaking content without changing the payload', async () => {
    const fastify = Fastify();
    await registerModelsRoute(fastify);

    const description = 'x</script><script>alert(1)</script>';
    setConfigForTesting({
      models: {
        'tricky-model': {
          targets: [],
          metadata: {
            source: 'custom',
            overrides: { name: 'Tricky', description },
          },
        },
      },
    } as unknown as PlexusConfig);

    const response = await fastify.inject({ method: 'GET', url: '/v1/models?ui' });
    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain('</script><script>');

    const uiPayload = extractEmbeddedJson(response.body);
    expect(uiPayload.data[0].description).toBe(description);
  });
});
