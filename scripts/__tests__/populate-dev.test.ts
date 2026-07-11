import { describe, expect, it } from 'vitest';
import { deriveDevPort, resolveApiRoot } from '../populate-dev';

describe('resolveApiRoot', () => {
  it('uses the worktree-derived port by default', () => {
    const cwd = '/workspace/plexus-review';

    expect(resolveApiRoot({}, cwd)).toBe(`http://localhost:${deriveDevPort(cwd)}`);
  });

  it.each([
    ['plexus.example.com', 'http://plexus.example.com:8443'],
    ['localhost', 'http://localhost:8443'],
    ['https://plexus.example.com', 'https://plexus.example.com:8443'],
  ])('combines hostname %s with an explicit port', (configuredUrl, expected) => {
    expect(resolveApiRoot({ PLEXUS_URL: configuredUrl, PLEXUS_PORT: '8443' })).toBe(expected);
  });

  it('preserves the port already present in PLEXUS_URL', () => {
    expect(resolveApiRoot({ PLEXUS_URL: 'http://localhost:4000', PLEXUS_PORT: '8443' })).toBe(
      'http://localhost:4000'
    );
  });
});
