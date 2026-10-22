import { describe, expect, test } from 'bun:test';

import type { RouteResult } from '../../routing/router';
import {
  applyGeminiThinkingConfig,
  resolveProviderBaseUrl,
  selectTargetApiType,
} from '../provider-api-selection';

function route(config: any, modelConfig?: any): RouteResult {
  return {
    provider: 'codex',
    model: 'gpt-image-1',
    config,
    modelConfig,
  } as RouteResult;
}

describe('selectTargetApiType', () => {
  test('matches an incoming images request to a codex-images target', () => {
    const result = selectTargetApiType(
      route(
        { api_base_url: 'oauth://', api_key: 'oauth' },
        { access_via: ['codex-images'], type: 'image' }
      ),
      'images'
    );

    expect(result.targetApiType).toBe('codex-images');
    expect(result.selectionReason).toBe("matched incoming request type 'images'");
  });

  test('still matches the other image target protocols', () => {
    for (const apiType of ['chat', 'gemini', 'openai-images', 'openrouter-images']) {
      const result = selectTargetApiType(
        route(
          { api_base_url: 'https://provider.example/v1', api_key: 'k' },
          { access_via: [apiType] }
        ),
        'images'
      );
      expect(result.targetApiType).toBe(apiType);
    }
  });

  test('does not treat a non-image protocol as an images target', () => {
    const result = selectTargetApiType(
      route(
        { api_base_url: 'https://provider.example/v1', api_key: 'k' },
        { access_via: ['messages'] }
      ),
      'images'
    );

    expect(result.targetApiType).toBe('messages');
    expect(result.selectionReason).toBe(
      "incoming type 'images' not supported, defaulted to 'messages'"
    );
  });
});

describe('resolveProviderBaseUrl', () => {
  test('returns a normalized HTTP base URL', () => {
    expect(
      resolveProviderBaseUrl(route({ api_base_url: 'https://provider.example/v1/' }), 'chat')
    ).toBe('https://provider.example/v1');
  });

  test('refuses to hand an oauth:// placeholder to fetch', () => {
    const call = () => resolveProviderBaseUrl(route({ api_base_url: 'oauth://' }), 'codex-images');

    expect(call).toThrow(/oauth:\/\//);
    expect(call).toThrow("Provider 'codex'");
    expect(call).toThrow("'codex-images'");
  });

  test('refuses an oauth:// value that reaches the record form', () => {
    expect(() =>
      resolveProviderBaseUrl(
        route({ api_base_url: { 'codex-images': 'oauth://' } }),
        'codex-images'
      )
    ).toThrow(/oauth:\/\//);
  });
});

describe('applyGeminiThinkingConfig', () => {
  test('tolerates an OAuth provider instead of throwing on the placeholder', () => {
    const payload = { reasoning: { effort: 'high' } };

    expect(
      applyGeminiThinkingConfig(
        route({ api_base_url: 'oauth://', geminiThinkingEnabled: true }),
        'responses',
        payload
      )
    ).toEqual(payload);
  });

  test('still maps reasoning effort for a Gemini endpoint', () => {
    const result = applyGeminiThinkingConfig(
      route({
        api_base_url: 'https://generativelanguage.googleapis.com/v1beta',
        geminiThinkingEnabled: true,
      }),
      'gemini',
      { reasoning: { effort: 'high' } }
    );

    expect(result.reasoning).toBeUndefined();
    expect(result.generationConfig.thinkingConfig).toEqual({ thinkingLevel: 'high' });
  });
});
