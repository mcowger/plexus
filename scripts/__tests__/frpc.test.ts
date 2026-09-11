import { describe, expect, it } from 'vitest';
import {
  buildFrpcArgs,
  buildFrpcSubdomain,
  buildFrpcUrl,
  repositoryNameFromRemote,
  sanitizeDnsLabel,
} from '../frpc';

describe('frpc helpers', () => {
  it('extracts repository names from common git remote formats', () => {
    expect(repositoryNameFromRemote('https://github.com/mcowger/plexus.git')).toBe('plexus');
    expect(repositoryNameFromRemote('git@github.com:mcowger/plexus.git')).toBe('plexus');
  });

  it('creates a DNS-safe deterministic subdomain from repo and worktree names', () => {
    const subdomain = buildFrpcSubdomain('Plexus', 'feature/auth login');

    expect(subdomain).toBe('plexus-feature-auth-login');
    expect(subdomain).toMatch(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/);
    expect(buildFrpcSubdomain('Plexus', 'feature/auth login')).toBe(subdomain);
  });

  it('keeps long subdomains within the DNS label limit', () => {
    const subdomain = buildFrpcSubdomain('plexus', 'a'.repeat(100));

    expect(subdomain.length).toBeLessThanOrEqual(63);
    expect(subdomain).toMatch(/-[a-f0-9]{8}$/);
  });

  it('builds the CLI-only HTTP proxy arguments', () => {
    expect(
      buildFrpcArgs({
        serverAddr: '192.168.0.2',
        serverPort: 7000,
        token: 'secret',
        proxyName: 'plexus-worktree',
        localPort: 12345,
        subdomain: 'plexus-worktree',
      })
    ).toEqual([
      'http',
      '--server-addr',
      '192.168.0.2',
      '--server-port',
      '7000',
      '--token',
      'secret',
      '--proxy-name',
      'plexus-worktree',
      '--local-ip',
      '127.0.0.1',
      '--local-port',
      '12345',
      '--sd',
      'plexus-worktree',
    ]);
  });

  it('uses a fallback for labels that contain no DNS-safe characters', () => {
    expect(sanitizeDnsLabel('---', 'fallback')).toBe('fallback');
  });

  it('builds a full URL only when the optional host is configured', () => {
    expect(buildFrpcUrl('plexus-worktree', 'dev.home.cowger.us')).toBe(
      'https://plexus-worktree.dev.home.cowger.us'
    );
    expect(buildFrpcUrl('plexus-worktree')).toBeUndefined();
  });
});
