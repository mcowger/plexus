import { describe, expect, test } from 'vitest';

import {
  apiAccessToKey,
  getApiBaseType,
  getApiSubtype,
  IMAGE_TARGET_API_TYPES,
  isApiSubtype,
  isImageTargetApiType,
  normalizeApiAccessList,
} from '../api-format';

describe('API format helpers', () => {
  test('keeps legacy string access entries compatible', () => {
    expect(normalizeApiAccessList(['chat', 'Responses'])).toEqual(['chat', 'responses']);
  });

  test('canonicalizes structured subtypes', () => {
    expect(apiAccessToKey({ type: ' Responses ', subtype: ' Lite ' })).toBe('responses:lite');
    expect(getApiBaseType('responses:lite')).toBe('responses');
    expect(getApiSubtype('responses:lite')).toBe('lite');
    expect(isApiSubtype('responses:lite')).toBe(true);
    expect(isApiSubtype('responses')).toBe(false);
  });
});

describe('isImageTargetApiType', () => {
  test('accepts every advertised image target protocol', () => {
    expect([...IMAGE_TARGET_API_TYPES]).toEqual([
      'chat',
      'gemini',
      'openai-images',
      'openrouter-images',
      'codex-images',
    ]);
    for (const apiType of IMAGE_TARGET_API_TYPES) {
      expect(isImageTargetApiType(apiType)).toBe(true);
    }
  });

  test('rejects non-image target protocols', () => {
    expect(isImageTargetApiType('messages')).toBe(false);
    expect(isImageTargetApiType('responses')).toBe(false);
    expect(isImageTargetApiType('images')).toBe(false);
    expect(isImageTargetApiType('')).toBe(false);
  });

  test('matches on the base type, case-insensitively', () => {
    expect(isImageTargetApiType(' Codex-Images ')).toBe(true);
    expect(isImageTargetApiType('chat:codex')).toBe(true);
    expect(isImageTargetApiType('responses:lite')).toBe(false);
  });
});
