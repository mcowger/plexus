import { describe, expect, test } from 'vitest';
import { isGlobalScope, listAllows, scopeMatches, type ScopeLists } from '../scope-match';

describe('listAllows', () => {
  test('empty/absent allowed list allows everything', () => {
    expect(listAllows(undefined, undefined, 'gpt-4')).toBe(true);
    expect(listAllows([], undefined, 'gpt-4')).toBe(true);
  });

  test('non-empty allowed list restricts to exact members', () => {
    expect(listAllows(['gpt-4'], undefined, 'gpt-4')).toBe(true);
    expect(listAllows(['gpt-4', 'gpt-5'], undefined, 'gpt-5')).toBe(true);
    expect(listAllows(['gpt-4'], undefined, 'gpt-4-mini')).toBe(false);
    expect(listAllows(['gpt-4'], undefined, 'claude-3')).toBe(false);
  });

  test('empty/absent excluded list is a no-op', () => {
    expect(listAllows(undefined, undefined, 'gpt-4')).toBe(true);
    expect(listAllows(undefined, [], 'gpt-4')).toBe(true);
    expect(listAllows(['gpt-4'], [], 'gpt-4')).toBe(true);
  });

  test('excluded list blocks a member even with no allowed list', () => {
    expect(listAllows(undefined, ['gpt-4'], 'gpt-4')).toBe(false);
    expect(listAllows(undefined, ['gpt-4'], 'gpt-5')).toBe(true);
  });

  test('excluded wins over allowed when a value is in both lists', () => {
    expect(listAllows(['gpt-4'], ['gpt-4'], 'gpt-4')).toBe(false);
  });

  test('excluded wins even when the allowed list would otherwise permit the value', () => {
    expect(listAllows(['gpt-4', 'gpt-5'], ['gpt-4'], 'gpt-4')).toBe(false);
    expect(listAllows(['gpt-4', 'gpt-5'], ['gpt-4'], 'gpt-5')).toBe(true);
  });

  test('matches are exact strings only — no substring or wildcard semantics', () => {
    expect(listAllows(['gpt-4'], undefined, 'gpt-4-mini')).toBe(false);
    expect(listAllows(['gpt-4-mini'], undefined, 'gpt-4')).toBe(false);
    expect(listAllows(['gpt-4*'], undefined, 'gpt-4-mini')).toBe(false);
    expect(listAllows(['gpt-.*'], undefined, 'gpt-4')).toBe(false);
    expect(listAllows(undefined, ['gpt-4*'], 'gpt-4-mini')).toBe(true);
  });

  test('matching is case-sensitive', () => {
    expect(listAllows(['GPT-4'], undefined, 'gpt-4')).toBe(false);
    expect(listAllows(['gpt-4'], undefined, 'GPT-4')).toBe(false);
    expect(listAllows(undefined, ['GPT-4'], 'gpt-4')).toBe(true);
  });
});

describe('scopeMatches', () => {
  test('an all-empty scope matches everything', () => {
    expect(scopeMatches({}, 'openai', 'gpt-4')).toBe(true);
    expect(scopeMatches({ allowedModels: [], allowedProviders: [] }, 'anthropic', 'claude-3')).toBe(
      true
    );
  });

  test('ANDs the provider axis and the model axis', () => {
    const scope: ScopeLists = { allowedProviders: ['openai'], allowedModels: ['gpt-4'] };
    expect(scopeMatches(scope, 'openai', 'gpt-4')).toBe(true);
    expect(scopeMatches(scope, 'openai', 'gpt-5')).toBe(false); // provider ok, model not allowed
    expect(scopeMatches(scope, 'anthropic', 'gpt-4')).toBe(false); // model ok, provider not allowed
    expect(scopeMatches(scope, 'anthropic', 'gpt-5')).toBe(false); // neither allowed
  });

  test('excluded provider blocks even when the model is allowed', () => {
    const scope: ScopeLists = { excludedProviders: ['openai'], allowedModels: ['gpt-4'] };
    expect(scopeMatches(scope, 'openai', 'gpt-4')).toBe(false);
    expect(scopeMatches(scope, 'anthropic', 'gpt-4')).toBe(true);
  });

  test('excluded model blocks even when the provider is allowed', () => {
    const scope: ScopeLists = { excludedModels: ['gpt-4'], allowedProviders: ['openai'] };
    expect(scopeMatches(scope, 'openai', 'gpt-4')).toBe(false);
    expect(scopeMatches(scope, 'openai', 'gpt-5')).toBe(true);
  });

  test('a restriction on only one axis leaves the other axis open', () => {
    const providerOnly: ScopeLists = { allowedProviders: ['openai'] };
    expect(scopeMatches(providerOnly, 'openai', 'any-model')).toBe(true);
    expect(scopeMatches(providerOnly, 'anthropic', 'any-model')).toBe(false);

    const modelOnly: ScopeLists = { allowedModels: ['gpt-4'] };
    expect(scopeMatches(modelOnly, 'any-provider', 'gpt-4')).toBe(true);
    expect(scopeMatches(modelOnly, 'any-provider', 'gpt-5')).toBe(false);
  });
});

describe('isGlobalScope', () => {
  test('true when all four lists are absent', () => {
    expect(isGlobalScope({})).toBe(true);
  });

  test('true when all four lists are present but empty', () => {
    expect(
      isGlobalScope({
        allowedModels: [],
        allowedProviders: [],
        excludedModels: [],
        excludedProviders: [],
      })
    ).toBe(true);
  });

  test('true for a mix of absent and empty lists', () => {
    expect(isGlobalScope({ allowedModels: [], excludedProviders: undefined })).toBe(true);
  });

  test('false when any single list is non-empty', () => {
    expect(isGlobalScope({ allowedModels: ['gpt-4'] })).toBe(false);
    expect(isGlobalScope({ allowedProviders: ['openai'] })).toBe(false);
    expect(isGlobalScope({ excludedModels: ['gpt-4'] })).toBe(false);
    expect(isGlobalScope({ excludedProviders: ['openai'] })).toBe(false);
  });

  test('false when multiple lists are non-empty', () => {
    expect(isGlobalScope({ allowedModels: ['gpt-4'], excludedProviders: ['azure'] })).toBe(false);
  });
});
