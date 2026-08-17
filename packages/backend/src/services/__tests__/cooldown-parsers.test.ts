import { describe, expect, test } from 'vitest';
import { CooldownParserRegistry } from '../runtime/cooldown-parsers';
import {
  resolveCooldownProviderType,
  parseCooldownDurationForProvider,
} from '../providers/provider-cooldown';

describe('CooldownParserRegistry', () => {
  test('Returns null for unregistered provider type', () => {
    const result = CooldownParserRegistry.parseCooldown('unknown-provider', 'reset after 20s');
    expect(result).toBe(null);
  });

  describe('openai-codex parser', () => {
    test('parses minute duration correctly', () => {
      const errorText = 'Usage limit reached. Try again in ~45 min.';
      const result = CooldownParserRegistry.parseCooldown('openai-codex', errorText);
      expect(result).toBe(45 * 60 * 1000);
    });
  });

  describe('openrouter parser', () => {
    test('parses metadata.retry_after_seconds', () => {
      const payload = JSON.stringify({
        message: 'Provider returned error',
        code: 429,
        metadata: {
          raw: 'openai/gpt-5.6-luna is temporarily rate-limited upstream. Please retry shortly, or add your own key to accumulate your rate limits: https://openrouter.ai/settings/integrations',
          provider_name: 'OpenInference',
          is_byok: false,
          retry_after_seconds: 29,
        },
      });
      const result = CooldownParserRegistry.parseCooldown('openrouter', payload);
      expect(result).toBe(29 * 1000);
    });

    test('parses error.metadata.retry_after_seconds_raw', () => {
      const payload = JSON.stringify({
        error: {
          message: 'Provider returned error',
          code: 429,
          metadata: {
            raw: 'google/gemma-4-26b-a4b-it:free is temporarily rate-limited upstream.',
            retry_after_seconds_raw: 28.5,
          },
        },
      });
      const result = CooldownParserRegistry.parseCooldown('openrouter', payload);
      expect(result).toBe(28500);
    });

    test('parses Retry-After header inside metadata', () => {
      const payload = JSON.stringify({
        error: {
          code: 429,
          metadata: {
            headers: {
              'Retry-After': '15',
            },
          },
        },
      });
      const result = CooldownParserRegistry.parseCooldown('openrouter', payload);
      expect(result).toBe(15 * 1000);
    });

    test('parses regex fallback for text format', () => {
      const errorText = 'Rate limited. Retry after 30s';
      const result = CooldownParserRegistry.parseCooldown('openrouter', errorText);
      expect(result).toBe(30 * 1000);
    });
  });
});

describe('provider-cooldown resolution', () => {
  test('resolves openrouter type when provider name contains openrouter', () => {
    const route: any = {
      provider: 'openrouter-s',
      model: 'openai/gpt-5.6-luna',
      config: { api_base_url: 'https://openrouter.ai/api/v1' },
    };
    expect(resolveCooldownProviderType(route)).toBe('openrouter');
  });

  test('resolves openrouter type when api_base_url is openrouter.ai', () => {
    const route: any = {
      provider: 'custom-proxy',
      model: 'openai/gpt-5.6-luna',
      config: { api_base_url: 'https://openrouter.ai/api/v1' },
    };
    expect(resolveCooldownProviderType(route)).toBe('openrouter');
  });

  test('parseCooldownDurationForProvider parses OpenRouter error payload fallback', () => {
    const payload = JSON.stringify({
      error: {
        message: 'Provider returned error',
        code: 429,
        metadata: {
          raw: 'openai/gpt-5.6-luna is temporarily rate-limited upstream. https://openrouter.ai/settings/integrations',
          retry_after_seconds: 20,
        },
      },
    });
    const result = parseCooldownDurationForProvider('chat', payload, 'HTTP');
    expect(result).toBe(20 * 1000);
  });
});
