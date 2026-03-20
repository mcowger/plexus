import { describe, expect, test } from 'bun:test';
import { CooldownParserRegistry } from '../cooldown-parsers';

describe('CooldownParserRegistry', () => {
  test('Returns null for unregistered provider type', () => {
    const result = CooldownParserRegistry.parseCooldown('unknown-provider', 'reset after 20s');
    expect(result).toBe(null);
  });
});
