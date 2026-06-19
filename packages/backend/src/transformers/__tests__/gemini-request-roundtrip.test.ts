import { describe, it, expect } from 'vitest';
import { parseGeminiRequest } from '../gemini/request-parser';
import { buildGeminiRequest } from '../gemini/request-builder';
import type { UnifiedChatRequest } from '../../types/unified';

/**
 * Round-trip tests for the Gemini transformer.
 *
 * These mirror the Anthropic round-trip regression tests (PR #617). They cover
 * the case where a same-format (gemini -> gemini) transform takes the
 * non-pass-through path (e.g. adapter active, vision fallthrough) and would
 * otherwise drop Gemini-native fields that the unified schema does not model:
 *   - top-level: safetySettings, cachedContent, labels
 *   - generationConfig extras: topP, topK, stopSequences, responseLogprobs
 *
 * On the common pass-through path the verbatim originalBody is sent regardless,
 * so these only matter when pass-through is suppressed.
 */

const GEMINI_REQUEST = {
  contents: [
    {
      role: 'user',
      parts: [{ text: 'Summarize the latest news.' }],
    },
  ],
  model: 'gemini-2.5-flash',
  generationConfig: {
    maxOutputTokens: 1024,
    temperature: 0.7,
    topP: 0.9,
    topK: 40,
    stopSequences: ['END'],
    responseLogprobs: true,
    logprobs: 5,
  },
  safetySettings: [{ category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' }],
  cachedContent: 'cachedContents/example',
  labels: { team: 'research', env: 'staging' },
};

describe('Gemini gemini -> gemini round-trip preserves native fields', () => {
  it('preserves top-level safetySettings, cachedContent, labels', async () => {
    const unified = await parseGeminiRequest(GEMINI_REQUEST);
    const built = await buildGeminiRequest({
      ...unified,
      incomingApiType: 'gemini',
      originalBody: GEMINI_REQUEST,
    });

    const builtAny = built as any;
    expect(builtAny.safetySettings).toEqual([
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
    ]);
    expect(builtAny.cachedContent).toBe('cachedContents/example');
    expect(builtAny.labels).toEqual({ team: 'research', env: 'staging' });
  });

  it('preserves unmapped generationConfig keys (topP, topK, stopSequences, logprobs)', async () => {
    const unified = await parseGeminiRequest(GEMINI_REQUEST);
    const built = await buildGeminiRequest({
      ...unified,
      incomingApiType: 'gemini',
      originalBody: GEMINI_REQUEST,
    });

    const gc = built.generationConfig as any;
    expect(gc.topP).toBe(0.9);
    expect(gc.topK).toBe(40);
    expect(gc.stopSequences).toEqual(['END']);
    expect(gc.responseLogprobs).toBe(true);
    expect(gc.logprobs).toBe(5);
  });

  it('explicitly-mapped generationConfig fields still override originalBody', async () => {
    const unified = await parseGeminiRequest(GEMINI_REQUEST);
    // Simulate the unified pipeline overriding maxOutputTokens
    const built = await buildGeminiRequest({
      ...unified,
      max_tokens: 2048,
      incomingApiType: 'gemini',
      originalBody: GEMINI_REQUEST,
    });

    const gc = built.generationConfig as any;
    // Explicit mapping wins over originalBody
    expect(gc.maxOutputTokens).toBe(2048);
    // But unmapped originalBody keys are still preserved
    expect(gc.topP).toBe(0.9);
  });

  it('does not pollute cross-format (non-gemini) transforms with originalBody fields', async () => {
    const unified = await parseGeminiRequest(GEMINI_REQUEST);
    // No incomingApiType/originalBody → cross-format path (e.g. chat -> gemini)
    const built = await buildGeminiRequest(unified as UnifiedChatRequest);

    const builtAny = built as any;
    expect(builtAny.safetySettings).toBeUndefined();
    expect(builtAny.cachedContent).toBeUndefined();
    expect(builtAny.labels).toBeUndefined();
  });
});
