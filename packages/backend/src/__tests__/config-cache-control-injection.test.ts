import { describe, expect, it } from 'bun:test';

import { validateConfig } from '../config';

function configWithBehavior(behaviors: unknown[]): string {
  return JSON.stringify({
    providers: {
      p1: {
        api_base_url: 'https://p1.example.com/v1',
        api_key: 'k',
        models: { 'model-1': {} },
      },
    },
    models: {
      'test-alias': {
        target_groups: [
          {
            name: 'default',
            selector: 'random',
            targets: [{ provider: 'p1', model: 'model-1' }],
          },
        ],
        advanced: behaviors,
      },
    },
    keys: {},
  });
}

const parseBehavior = (behavior: unknown) =>
  validateConfig(configWithBehavior([behavior])).models?.['test-alias']?.advanced?.[0] as any;

describe('ModelConfigSchema inject_cache_control parsing', () => {
  it('applies the documented defaults', () => {
    expect(parseBehavior({ type: 'inject_cache_control' })).toEqual({
      type: 'inject_cache_control',
      enabled: true,
      tools: true,
      system: true,
      message_breakpoints: 2,
      ttl: undefined,
    });
  });

  it('keeps explicit options', () => {
    expect(
      parseBehavior({
        type: 'inject_cache_control',
        enabled: false,
        tools: false,
        system: false,
        message_breakpoints: 4,
        ttl: '1h',
      })
    ).toEqual({
      type: 'inject_cache_control',
      enabled: false,
      tools: false,
      system: false,
      message_breakpoints: 4,
      ttl: '1h',
    });
  });

  it('accepts a 5m ttl', () => {
    expect(parseBehavior({ type: 'inject_cache_control', ttl: '5m' }).ttl).toBe('5m');
  });

  it('rejects an unknown ttl', () => {
    expect(() => parseBehavior({ type: 'inject_cache_control', ttl: '2h' })).toThrow();
  });

  it('rejects a trailing count outside 0-4', () => {
    expect(() => parseBehavior({ type: 'inject_cache_control', message_breakpoints: 5 })).toThrow();
    expect(() =>
      parseBehavior({ type: 'inject_cache_control', message_breakpoints: -1 })
    ).toThrow();
  });
});
