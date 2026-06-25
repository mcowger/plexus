import { describe, expect, test } from 'vitest';
import { resolveCompactionSettings } from '../resolve-settings';
import { COMPACTION_DEFAULTS } from '../types';

describe('resolveCompactionSettings', () => {
  test('empty call returns COMPACTION_DEFAULTS', () => {
    const result = resolveCompactionSettings();
    expect(result).toEqual(COMPACTION_DEFAULTS);
  });

  test('alias > provider > global precedence for scalar fields', () => {
    // alias: enabled=true, strategy unset
    // provider: strategy='headroom', enabled unset
    // global: enabled=false, strategy='native'
    const result = resolveCompactionSettings(
      { enabled: false, strategy: 'native' }, // global
      { strategy: 'headroom' }, // provider
      { enabled: true } // alias
    );
    expect(result.enabled).toBe(true); // alias wins
    expect(result.strategy).toBe('headroom'); // provider beats global
  });

  test('nested native fields merged field-by-field across layers', () => {
    // global provides maxArrayItems=10
    // provider provides maxStringChars=999
    // alias provides nothing for native
    const result = resolveCompactionSettings(
      { native: { maxArrayItems: 10 } }, // global
      { native: { maxStringChars: 999 } }, // provider
      {} // alias (empty)
    );
    expect(result.native.maxArrayItems).toBe(10); // from global
    expect(result.native.maxStringChars).toBe(999); // from provider
  });

  test('nested headroom fields merged field-by-field across layers', () => {
    // global provides baseUrl
    // alias provides timeoutMs
    const result = resolveCompactionSettings(
      { headroom: { baseUrl: 'http://x' } }, // global
      undefined, // provider unset
      { headroom: { timeoutMs: 1234 } } // alias
    );
    expect(result.headroom.baseUrl).toBe('http://x');
    expect(result.headroom.timeoutMs).toBe(1234);
    expect(result.headroom.targetRatio).toBeNull(); // default
    expect(result.headroom.apiKey).toBeUndefined(); // no default
  });
});
