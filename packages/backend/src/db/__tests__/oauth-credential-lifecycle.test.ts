/**
 * OAuth credential upsert bookkeeping and the config cache it drives.
 *
 * What must hold:
 *   - `setOAuthCredentials` tells a new login (`created`, plus any provider
 *     the slug backfill just linked) apart from a token rotation of an
 *     existing row, which reports neither;
 *   - `getOAuthCredentialTimestamps` exposes the row's lifecycle as numbers
 *     (connected once, refreshed on every save) or null when absent;
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  creds,
  oauthProvider,
  resetOAuthDatabase,
  rotated,
} from '../../../test/oauth-credential-test-utils';
import { closeDatabase } from '../client';
import { ConfigRepository } from '../config-repository';

describe('ConfigRepository OAuth credential upsert', () => {
  let repo: ConfigRepository;

  beforeEach(async () => {
    repo = await resetOAuthDatabase();
  });

  afterEach(async () => {
    await closeDatabase();
  });

  it('reports a first login and the unlinked provider it backfilled', async () => {
    await repo.saveProvider('metasub', oauthProvider());

    const result = await repo.setOAuthCredentials('meta', 'metasub', creds);

    expect(result).toEqual({ created: true, linkedProviderSlugs: ['metasub'] });
    expect((await repo.getProvider('metasub'))?.oauth_account).toBe('metasub');
  });

  it('reports a first login with no link when no provider matches the slug', async () => {
    await repo.saveProvider('other', oauthProvider());
    await repo.saveProvider('metasub', { ...oauthProvider(), oauth_provider: 'openai-codex' });

    const result = await repo.setOAuthCredentials('meta', 'metasub', creds);

    expect(result).toEqual({ created: true, linkedProviderSlugs: [] });
  });

  it('reports a token rotation as neither created nor linking', async () => {
    await repo.saveProvider('metasub', oauthProvider());
    await repo.setOAuthCredentials('meta', 'metasub', creds);

    const result = await repo.setOAuthCredentials('meta', 'metasub', rotated);

    expect(result).toEqual({ created: false, linkedProviderSlugs: [] });
    expect(await repo.getOAuthCredentials('meta', 'metasub')).toEqual({
      accessToken: 'access-2',
      refreshToken: 'refresh-2',
      expiresAt: 2100000000,
    });
  });

  it('returns credential timestamps as numbers, keeping connectedAt across rotations', async () => {
    const before = Date.now();
    await repo.setOAuthCredentials('meta', 'metasub', creds);
    const first = await repo.getOAuthCredentialTimestamps('meta', 'metasub');

    expect(first).not.toBeNull();
    expect(typeof first!.createdAt).toBe('number');
    expect(typeof first!.updatedAt).toBe('number');
    expect(typeof first!.expiresAt).toBe('number');
    expect(first!.createdAt).toBeGreaterThanOrEqual(before);
    expect(first!.updatedAt).toBe(first!.createdAt);
    expect(first!.expiresAt).toBe(2000000000);

    await new Promise((resolve) => setTimeout(resolve, 5));
    await repo.setOAuthCredentials('meta', 'metasub', rotated);
    const second = await repo.getOAuthCredentialTimestamps('meta', 'metasub');

    expect(second!.createdAt).toBe(first!.createdAt);
    expect(second!.updatedAt).toBeGreaterThan(first!.updatedAt);
    expect(second!.expiresAt).toBe(2100000000);
  });

  it('returns null timestamps for an unknown credential', async () => {
    await repo.setOAuthCredentials('meta', 'metasub', creds);

    expect(await repo.getOAuthCredentialTimestamps('meta', 'nobody')).toBeNull();
    expect(await repo.getOAuthCredentialTimestamps('openai-codex', 'metasub')).toBeNull();
  });
});
