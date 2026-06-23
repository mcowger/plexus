import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import * as piAi from '@earendil-works/pi-ai/compat';
import * as piAiProvidersAll from '@earendil-works/pi-ai/providers/all';
import { registerPiAiCustomRoutes } from '../pi-ai-custom';

// ConfigService is only touched by the custom-provider/model CRUD routes, not
// by the registry-model clone endpoint. Stub it so route registration never
// constructs a real ConfigRepository (DB). The repo is a stable object so
// tests can override its vi.fn return values per-case.
const mockRepo = vi.hoisted(() => ({
  getAllPiAiCustomProviders: vi.fn(async () => ({})),
  getAllPiAiCustomModels: vi.fn(async () => ({})),
  savePiAiCustomProvider: vi.fn(),
  deletePiAiCustomProvider: vi.fn(),
  savePiAiCustomModel: vi.fn(),
  deletePiAiCustomModel: vi.fn(),
}));
const mockConfigService = vi.hoisted(() => ({
  getRepository: () => mockRepo,
  savePiAiCustomProvider: vi.fn(),
  deletePiAiCustomProvider: vi.fn(),
  savePiAiCustomModel: vi.fn(),
  deletePiAiCustomModel: vi.fn(),
}));

vi.mock('../../../services/config-service', () => ({
  ConfigService: {
    getInstance: vi.fn(() => mockConfigService),
  },
}));

describe('management pi-ai custom routes — registry-model clone', () => {
  let fastify: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    mockRepo.getAllPiAiCustomProviders.mockResolvedValue({});
    mockRepo.getAllPiAiCustomModels.mockResolvedValue({});
    fastify = Fastify();
    await registerPiAiCustomRoutes(fastify);
  });

  afterEach(async () => {
    await fastify.close();
    vi.restoreAllMocks();
  });

  test('GET /v0/management/pi/registry-model returns 400 without query params', async () => {
    const res = await fastify.inject({ method: 'GET', url: '/v0/management/pi/registry-model' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toMatch(/provider.*model_id/i);
  });

  test('GET /v0/management/pi/registry-model clones a registry model into a standalone spec', async () => {
    const res = await fastify.inject({
      method: 'GET',
      url: '/v0/management/pi/registry-model?provider=anthropic&model_id=claude-test',
    });
    expect(res.statusCode).toBe(200);
    // The global pi-ai mock's getModel returns { id, name, contextWindow, provider, api }.
    // The serializer keeps api/name/contextWindow and omits absent optional fields.
    expect(res.json()).toEqual({
      api: 'anthropic-messages',
      name: 'claude-test',
      contextWindow: 200000,
    });
  });

  test('GET /v0/management/pi/registry-model returns 404 when the base is unknown', async () => {
    // The global mock always returns a model; override it to simulate a miss.
    vi.spyOn(piAiProvidersAll, 'getBuiltinModel').mockReturnValue(undefined as any);
    const res = await fastify.inject({
      method: 'GET',
      url: '/v0/management/pi/registry-model?provider=unknown&model_id=ghost',
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.message).toMatch(/not found/i);
  });

  test('PUT custom-model with an unknown provider is rejected (400)', async () => {
    const res = await fastify.inject({
      method: 'PUT',
      url: '/v0/management/pi/custom-models/m1',
      payload: { provider: 'no-such-provider', api: 'openai-completions' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toMatch(/Unknown provider 'no-such-provider'/);
  });

  test('PUT custom-model with a known provider is accepted (200)', async () => {
    mockRepo.getAllPiAiCustomProviders.mockResolvedValue({
      'niche-host': { api: 'openai-completions' },
    });
    const res = await fastify.inject({
      method: 'PUT',
      url: '/v0/management/pi/custom-models/m1',
      payload: { provider: 'niche-host', api: 'openai-completions' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().definition.provider).toBe('niche-host');
  });

  test('DELETE custom-provider with dependent models is rejected (409)', async () => {
    mockRepo.getAllPiAiCustomProviders.mockResolvedValue({
      'niche-host': { api: 'openai-completions' },
    });
    mockRepo.getAllPiAiCustomModels.mockResolvedValue({
      m1: { provider: 'niche-host', api: 'openai-completions' },
    });
    const res = await fastify.inject({
      method: 'DELETE',
      url: '/v0/management/pi/custom-providers/niche-host',
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.message).toMatch(/Cannot delete provider 'niche-host'/);
    expect(mockConfigService.deletePiAiCustomProvider).not.toHaveBeenCalled();
  });

  test('DELETE custom-provider with no dependents succeeds (200)', async () => {
    mockRepo.getAllPiAiCustomProviders.mockResolvedValue({
      'niche-host': { api: 'openai-completions' },
    });
    mockRepo.getAllPiAiCustomModels.mockResolvedValue({});
    const res = await fastify.inject({
      method: 'DELETE',
      url: '/v0/management/pi/custom-providers/niche-host',
    });
    expect(res.statusCode).toBe(200);
    expect(mockConfigService.deletePiAiCustomProvider).toHaveBeenCalledWith('niche-host');
  });
});
