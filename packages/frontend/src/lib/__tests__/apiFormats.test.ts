import { describe, expect, test } from 'vitest';

import { legacyDecisionsAccessKind, stripDecisionsAccess } from '../apiFormats';

describe('legacyDecisionsAccessKind', () => {
  test('empty or absent access_via is none', () => {
    expect(legacyDecisionsAccessKind(undefined)).toBe('none');
    expect(legacyDecisionsAccessKind([])).toBe('none');
  });

  test('pure decisions-only lists are pure', () => {
    expect(legacyDecisionsAccessKind(['systemone'])).toBe('pure');
    expect(legacyDecisionsAccessKind(['openrouter-decisions', 'typesafe-decisions'])).toBe('pure');
  });

  test('mixed lists are mixed', () => {
    expect(legacyDecisionsAccessKind(['chat', 'systemone'])).toBe('mixed');
  });

  test('non-decisions lists are none', () => {
    expect(legacyDecisionsAccessKind(['chat', 'responses'])).toBe('none');
  });
});

describe('stripDecisionsAccess', () => {
  test('removes decisions-capable entries, keeping others in order', () => {
    expect(stripDecisionsAccess(['chat', 'systemone', 'messages'])).toEqual(['chat', 'messages']);
    expect(stripDecisionsAccess(['systemone'])).toEqual([]);
  });

  test('undefined stays undefined', () => {
    expect(stripDecisionsAccess(undefined)).toBeUndefined();
  });
});
