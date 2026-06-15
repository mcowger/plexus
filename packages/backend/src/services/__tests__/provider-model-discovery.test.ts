import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  deriveModelsUrl,
  discoverProviderModels,
  normalizeModelsResponse,
  validateUrlSafety,
} from '../provider-model-discovery';
import type { ProviderConfig } from '../../config';

describe('provider model discovery', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('derives OpenAI-compatible /models URLs from chat completion URLs', () => {
    const provider: ProviderConfig = {
      api_base_url: 'https://api.example.com/v1/chat/completions',
      api_key: 'sk-test',
      disable_cooldown: false,
      stall_cooldown: false,
      estimateTokens: false,
      useClaudeMasking: false,
    };

    expect(deriveModelsUrl(provider)).toBe('https://api.example.com/v1/models');
  });

  it('uses the Ollama catalog endpoint for native Ollama providers', () => {
    const provider: ProviderConfig = {
      api_base_url: { ollama: 'https://ollama.example.com/api' },
      api_key: 'sk-test',
      disable_cooldown: false,
      stall_cooldown: false,
      estimateTokens: false,
      useClaudeMasking: false,
    };

    expect(deriveModelsUrl(provider)).toBe('https://ollama.com/api/tags');
  });

  it('normalizes OpenAI and Ollama model responses', () => {
    expect(normalizeModelsResponse({ data: [{ id: 'gpt-4o' }] })).toEqual({
      data: [{ id: 'gpt-4o' }],
    });

    expect(
      normalizeModelsResponse({
        models: [{ name: 'llama3.2', modified_at: '2026-01-01T00:00:00Z' }],
      }).data[0]?.id
    ).toBe('llama3.2');
  });

  it('keeps SSRF protections for autosync fetches', () => {
    expect(validateUrlSafety('https://api.example.com/v1/models')).toEqual({ valid: true });
    expect(validateUrlSafety('http://localhost:11434/v1/models')).toEqual({
      valid: false,
      error: 'Cannot fetch from localhost',
    });
  });

  it('does not forward provider API keys to the public Ollama catalog', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ models: ['llama3.2'] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const provider: ProviderConfig = {
      api_base_url: { ollama: 'https://ollama.example.com/api' },
      api_key: 'secret-local-ollama-key',
      disable_cooldown: false,
      stall_cooldown: false,
      estimateTokens: false,
      useClaudeMasking: false,
    };

    await discoverProviderModels(provider);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://ollama.com/api/tags',
      expect.objectContaining({
        headers: { Accept: 'application/json' },
      })
    );
  });
});
