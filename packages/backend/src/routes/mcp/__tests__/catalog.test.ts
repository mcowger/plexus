import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, jest, test } from 'bun:test';

import { getConfig, type PlexusConfig, setConfigForTesting } from '../../../config';
import { createPlexusMcpTestFixture } from './plexus-mcp-test-fixtures';

describe('Plexus management MCP routes - pi-ai catalog', () => {
  const fixture = createPlexusMcpTestFixture();

  beforeAll(async () => {
    await fixture.start();
  });

  beforeEach(() => {
    fixture.reset();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await fixture.close();
  });

  test('lists pi-ai providers and models', async () => {
    const providersResponse = await fixture.postPlexusMcp(
      {
        method: 'tools/call',
        id: 1,
        params: {
          name: 'plexus_pi_catalog',
          arguments: { operation: 'providers' },
        },
      },
      fixture.adminHeaders()
    );
    const providers = fixture.parseJsonRpcResponse(providersResponse);
    expect(providers.result.structuredContent.data.data).toEqual(['anthropic', 'openai']);

    const modelsResponse = await fixture.postPlexusMcp(
      {
        method: 'tools/call',
        id: 2,
        params: {
          name: 'plexus_pi_catalog',
          arguments: { operation: 'models', id: 'openai', query: { q: '4.1' } },
        },
      },
      fixture.adminHeaders()
    );
    const models = fixture.parseJsonRpcResponse(modelsResponse);
    expect(models.result.structuredContent.data.data).toEqual([
      { id: 'gpt-4.1', name: 'GPT-4.1', api: 'openai-responses', custom: false },
    ]);
    expect(fixture.fastify.inject).toHaveBeenCalledWith(
      expect.objectContaining({
        url: '/v0/management/pi/models?provider=openai&q=4.1',
      })
    );
  });

  test('requires a pi-ai provider ID when listing models', async () => {
    const response = await fixture.postPlexusMcp(
      {
        method: 'tools/call',
        id: 1,
        params: {
          name: 'plexus_pi_catalog',
          arguments: { operation: 'models' },
        },
      },
      fixture.adminHeaders()
    );
    const body = fixture.parseJsonRpcResponse(response);

    expect(body.result.structuredContent).toMatchObject({
      ok: false,
      error: {
        message: 'Missing id for pi-ai provider operation.',
        type: 'invalid_request',
        code: 400,
      },
    });
  });

  test('validates configured pi-ai provider and model IDs against the catalog', async () => {
    const config = structuredClone(getConfig());
    setConfigForTesting({
      ...config,
      providers: {
        ...config.providers,
        openrouter: {
          ...config.providers.openrouter,
          pi_ai_provider: 'openai',
          models: {
            'gpt-5': { pi_ai_model_id: 'gpt-4.1' },
            'missing-model': { pi_ai_model_id: 'unknown-model' },
          },
        },
        'without-provider-mapping': {
          ...config.providers.openrouter,
          models: { model: { pi_ai_model_id: 'gpt-4.1' } },
        },
        'unknown-pi-provider': {
          ...config.providers.openrouter,
          pi_ai_provider: 'not-in-catalog',
          models: { model: { pi_ai_model_id: 'gpt-4.1' } },
        },
      },
    } as unknown as PlexusConfig);

    const response = await fixture.postPlexusMcp(
      {
        method: 'tools/call',
        id: 1,
        params: {
          name: 'plexus_pi_catalog',
          arguments: { operation: 'validate_config' },
        },
      },
      fixture.adminHeaders()
    );
    const body = fixture.parseJsonRpcResponse(response);

    expect(body.result.structuredContent.data).toMatchObject({
      valid: false,
      checkedProviders: 3,
      checkedModels: 4,
      invalidProviders: 2,
      invalidModels: 3,
      results: [
        {
          provider: 'openrouter',
          pi_ai_provider: 'openai',
          validProvider: true,
          models: [
            { id: 'gpt-5', pi_ai_model_id: 'gpt-4.1', valid: true },
            { id: 'missing-model', pi_ai_model_id: 'unknown-model', valid: false },
          ],
          valid: false,
        },
        {
          provider: 'without-provider-mapping',
          pi_ai_provider: null,
          validProvider: false,
          models: [{ id: 'model', pi_ai_model_id: 'gpt-4.1', valid: false }],
          valid: false,
        },
        {
          provider: 'unknown-pi-provider',
          pi_ai_provider: 'not-in-catalog',
          validProvider: false,
          models: [{ id: 'model', pi_ai_model_id: 'gpt-4.1', valid: false }],
          valid: false,
        },
      ],
    });
    const injectCalls = (fixture.fastify.inject as unknown as { mock: { calls: Array<[unknown]> } })
      .mock.calls;
    const managementRequests = injectCalls.flatMap(([request]) => {
      if (
        request &&
        typeof request === 'object' &&
        'url' in request &&
        typeof request.url === 'string' &&
        request.url.startsWith('/v0/management/')
      ) {
        return [request as { method?: string }];
      }
      return [];
    });
    expect(managementRequests.every(({ method }) => method === 'GET')).toBe(true);
    expect(fixture.fastify.inject).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'GET', url: '/v0/management/providers' })
    );
    expect(fixture.fastify.inject).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'GET', url: '/v0/management/pi/providers' })
    );
    expect(fixture.fastify.inject).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'GET', url: '/v0/management/pi/models?provider=openai' })
    );
  });
});
