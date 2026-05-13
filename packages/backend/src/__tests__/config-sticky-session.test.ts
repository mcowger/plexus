import { describe, expect, it } from 'vitest';
import { validateConfig } from '../config';

function configWithAlias(aliasFields: Record<string, unknown>): string {
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
        ...aliasFields,
      },
    },
    keys: {},
  });
}

describe('ModelConfigSchema sticky_session parsing', () => {
  it('accepts sticky_session: true', () => {
    const cfg = validateConfig(configWithAlias({ sticky_session: true }));
    expect(cfg.models?.['test-alias']?.sticky_session).toBe(true);
  });

  it('accepts sticky_session: false', () => {
    const cfg = validateConfig(configWithAlias({ sticky_session: false }));
    expect(cfg.models?.['test-alias']?.sticky_session).toBe(false);
  });

  it('defaults sticky_session to false when not provided', () => {
    const cfg = validateConfig(configWithAlias({}));
    // Schema is `.default(false).optional()` — same pattern as the sibling
    // booleans on this schema, so missing input parses to false.
    expect(cfg.models?.['test-alias']?.sticky_session).toBe(false);
  });

  it('rejects non-boolean sticky_session', () => {
    expect(() => validateConfig(configWithAlias({ sticky_session: 'yes' }))).toThrow();
    expect(() => validateConfig(configWithAlias({ sticky_session: 1 }))).toThrow();
  });
});
