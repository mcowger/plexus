import { describe, expect, it } from 'vitest';
import { deriveDevPort, resolveApiRoot } from '../populate-dev';

describe('resolveApiRoot', () => {
  it('uses the worktree-derived port by default', () => {
    const cwd = '/workspace/plexus-review';

    expect(resolveApiRoot({}, cwd)).toBe(`http://localhost:${deriveDevPort(cwd)}`);
  });

  it('combines a hostname-only URL with an explicit port', () => {
    expect(resolveApiRoot({ PLEXUS_URL: 'https://plexus.example.com', PLEXUS_PORT: '8443' })).toBe(
      'https://plexus.example.com:8443'
    );
  });

  it('preserves the port already present in PLEXUS_URL', () => {
    expect(resolveApiRoot({ PLEXUS_URL: 'http://localhost:4000', PLEXUS_PORT: '8443' })).toBe(
      'http://localhost:4000'
    );
  });
});
