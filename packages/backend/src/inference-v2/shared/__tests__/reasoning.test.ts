import { describe, it, expect } from 'vitest';
import {
  budgetToEffort,
  effortToBudget,
  normalizeEffort,
  clampEffortToWindow,
  intentToEffort,
  type ReasoningIntent,
} from '../reasoning';

describe('budgetToEffort', () => {
  it('returns off for non-positive budgets', () => {
    expect(budgetToEffort(0)).toBe('off');
    expect(budgetToEffort(-5)).toBe('off');
  });

  it('maps budgets to buckets', () => {
    expect(budgetToEffort(512)).toBe('minimal');
    expect(budgetToEffort(1024)).toBe('minimal');
    expect(budgetToEffort(2048)).toBe('low');
    expect(budgetToEffort(8192)).toBe('medium');
    expect(budgetToEffort(16384)).toBe('high');
    expect(budgetToEffort(40000)).toBe('xhigh');
  });
});

describe('effortToBudget', () => {
  it('is consistent with budgetToEffort bucket boundaries', () => {
    // round-trip: an effort's representative budget maps back to that effort
    for (const e of ['minimal', 'low', 'medium', 'high', 'xhigh'] as const) {
      expect(budgetToEffort(effortToBudget(e))).toBe(e);
    }
  });
});

describe('normalizeEffort', () => {
  it('recognises off synonyms', () => {
    expect(normalizeEffort('none')).toBe('off');
    expect(normalizeEffort('off')).toBe('off');
    expect(normalizeEffort('disabled')).toBe('off');
  });

  it('recognises max synonyms as xhigh', () => {
    expect(normalizeEffort('max')).toBe('xhigh');
    expect(normalizeEffort('maximum')).toBe('xhigh');
    expect(normalizeEffort('xhigh')).toBe('xhigh');
  });

  it('is case-insensitive and trims', () => {
    expect(normalizeEffort('  HIGH ')).toBe('high');
  });

  it('returns undefined for unknown values', () => {
    expect(normalizeEffort('turbo')).toBeUndefined();
    expect(normalizeEffort(42)).toBeUndefined();
    expect(normalizeEffort(undefined)).toBeUndefined();
  });
});

describe('clampEffortToWindow', () => {
  it('raises below floor', () => {
    expect(clampEffortToWindow('minimal', 'medium')).toBe('medium');
  });

  it('lowers above ceiling', () => {
    expect(clampEffortToWindow('xhigh', undefined, 'medium')).toBe('medium');
  });

  it('leaves values inside the window untouched', () => {
    expect(clampEffortToWindow('low', 'minimal', 'high')).toBe('low');
  });
});

describe('intentToEffort', () => {
  it('returns off when explicitly disabled', () => {
    expect(intentToEffort({ enabled: false, source: 'client' })).toBe('off');
  });

  it('prefers explicit effort', () => {
    expect(intentToEffort({ effort: 'high', enabled: true, source: 'client' })).toBe('high');
  });

  it('derives effort from budget when no effort given', () => {
    const intent: ReasoningIntent = { budgetTokens: 2048, enabled: true, source: 'client' };
    expect(intentToEffort(intent)).toBe('low');
  });

  it('returns medium for enabled-but-unspecified', () => {
    expect(intentToEffort({ enabled: true, source: 'client' })).toBe('medium');
  });

  it('resolves an adaptive intent to the documented default effort (high)', () => {
    expect(intentToEffort({ adaptive: true, enabled: true, source: 'client' })).toBe('high');
  });

  it('prefers an explicit effort over the adaptive default', () => {
    expect(intentToEffort({ adaptive: true, effort: 'low', enabled: true, source: 'client' })).toBe(
      'low'
    );
  });

  it('returns undefined when the client said nothing', () => {
    expect(intentToEffort({ source: 'client' })).toBeUndefined();
  });
});
