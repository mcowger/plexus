import { describe, it, expect } from 'vitest';
import {
  normalizeEffort,
  budgetToEffort,
  effortToBudget,
  getReasoningLogValue,
  splitReasoningSuffix,
} from '../reasoning';

describe('normalizeEffort', () => {
  it.each([
    ['none', 'off'],
    ['off', 'off'],
    ['disabled', 'off'],
    ['minimal', 'minimal'],
    ['low', 'low'],
    ['medium', 'medium'],
    ['high', 'high'],
    ['xhigh', 'xhigh'],
    // 'max' is its own canonical level, not a synonym of 'xhigh'
    ['max', 'max'],
    ['maximum', 'max'],
    ['MAX', 'max'],
  ])('normalizes %s → %s', (raw, expected) => {
    expect(normalizeEffort(raw)).toBe(expected);
  });

  it('returns undefined for unknown values and non-strings', () => {
    expect(normalizeEffort('turbo')).toBeUndefined();
    expect(normalizeEffort(42)).toBeUndefined();
    expect(normalizeEffort(undefined)).toBeUndefined();
  });
});

describe('budgetToEffort', () => {
  it('maps budget bands up through xhigh', () => {
    expect(budgetToEffort(0)).toBe('off');
    expect(budgetToEffort(1024)).toBe('minimal');
    expect(budgetToEffort(2048)).toBe('low');
    expect(budgetToEffort(8192)).toBe('medium');
    expect(budgetToEffort(16384)).toBe('high');
    expect(budgetToEffort(32768)).toBe('xhigh');
  });

  it('maps budgets above the xhigh band to max', () => {
    expect(budgetToEffort(32769)).toBe('max');
    expect(budgetToEffort(65536)).toBe('max');
  });

  it('round-trips stably through effortToBudget', () => {
    for (const budget of [1024, 2048, 8192, 16384, 32768, 65536]) {
      const effort = budgetToEffort(budget);
      expect(effort).not.toBe('off');
      expect(effortToBudget(effort as Exclude<typeof effort, 'off'>)).toBe(budget);
    }
  });
});

describe('splitReasoningSuffix', () => {
  it('splits a :max suffix into a max-effort intent (not xhigh)', () => {
    const { alias, intent } = splitReasoningSuffix('gpt-5.6-luna:max');
    expect(alias).toBe('gpt-5.6-luna');
    expect(intent).toEqual({ effort: 'max', enabled: true, source: 'client' });
  });

  it('leaves unknown suffixes intact', () => {
    expect(splitReasoningSuffix('my-model:custom')).toEqual({ alias: 'my-model:custom' });
  });
});

describe('getReasoningLogValue', () => {
  it.each([
    [{ reasoning_effort: 'low' }, undefined, 'low'],
    [{ reasoning: { effort: 'max' } }, undefined, 'max'],
    [{ thinking: { type: 'enabled', budget_tokens: 2048 } }, undefined, 'low'],
    [{ generationConfig: { thinkingConfig: { thinkingLevel: 'HIGH' } } }, undefined, 'high'],
    [{ reasoning: { enabled: true } }, undefined, 'on'],
    [{ reasoning: { enabled: false } }, undefined, 'off'],
  ] as const)('extracts %s as %s', (payload, request, expected) => {
    expect(getReasoningLogValue(request, payload)).toBe(expected);
  });

  it('falls back to the normalized request', () => {
    expect(getReasoningLogValue({ reasoning: { effort: 'medium' } }, {})).toBe('medium');
  });

  it('does not report an unspecified reasoning setting', () => {
    expect(getReasoningLogValue({}, {})).toBeUndefined();
  });
});
