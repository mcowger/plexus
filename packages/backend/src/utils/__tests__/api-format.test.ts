import { describe, expect, test } from 'vitest';
import {
  apiAccessToKey,
  getApiBaseType,
  getApiSubtype,
  isApiSubtype,
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
