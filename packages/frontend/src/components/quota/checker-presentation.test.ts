import { describe, expect, test } from 'bun:test';

import type { QuotaCheckerInfo } from '../../types/quota';
import { sortQuotaCheckersByDisplayName } from './checker-presentation';

const displayNameMap = new Map([
  ['claude-code', 'Claude Code'],
  ['muse-code', 'Muse Code'],
  ['openai-codex', 'OpenAI Codex'],
]);

function checker(checkerId: string, checkerType: string, provider: string): QuotaCheckerInfo {
  return { checkerId, checkerType, provider, success: true, meters: [] };
}

describe('sortQuotaCheckersByDisplayName', () => {
  test('groups checkers for the same service together, ordered by provider within a group', () => {
    const sorted = sortQuotaCheckersByDisplayName(
      [
        checker('quota-1', 'claude-code', 'cc'),
        checker('quota-2', 'muse-code', 'meta'),
        checker('quota-3', 'openai-codex', 'openai-s'),
        checker('quota-4', 'claude-code', 'cc-s'),
      ],
      displayNameMap
    );

    expect(sorted.map((q) => q.provider)).toEqual(['cc', 'cc-s', 'meta', 'openai-s']);
  });

  test('falls back to checker type when no display name is known, and does not mutate input', () => {
    const input = [
      checker('quota-2', 'muse-code', 'meta'),
      checker('quota-1', 'claude-code', 'cc'),
    ];

    const sorted = sortQuotaCheckersByDisplayName(input);

    expect(sorted.map((q) => q.checkerId)).toEqual(['quota-1', 'quota-2']);
    expect(input.map((q) => q.checkerId)).toEqual(['quota-2', 'quota-1']);
  });
});
