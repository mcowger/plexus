import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  creds,
  oauthProvider,
  resetOAuthDatabase,
} from '../../../test/oauth-credential-test-utils';
import { closeDatabase } from '../client';
import { ConfigRepository } from '../config-repository';

describe('provider OAuth account hydration', () => {
  let repo: ConfigRepository;

  beforeEach(async () => {
    repo = await resetOAuthDatabase();
  });

  afterEach(async () => {
    await closeDatabase();
  });

  it('hydrates the account when the credential is created after the provider was saved', async () => {
    // Provider saved before OAuth login: no credential exists, so no link.
    await repo.saveProvider('metasub', oauthProvider('Personal'));
    expect((await repo.getProvider('metasub'))?.oauth_account).toBeUndefined();

    await repo.setOAuthCredentials('meta', 'Personal', creds);

    const bySlug = await repo.getProvider('metasub');
    expect(bySlug?.oauth_account).toBe('Personal');
    const all = await repo.getAllProviders();
    expect(all['metasub']?.oauth_account).toBe('Personal');
  });

  it('re-links the credential on the next save', async () => {
    await repo.saveProvider('metasub', oauthProvider('Personal'));
    await repo.setOAuthCredentials('meta', 'Personal', creds);
    await repo.setOAuthCredentials('meta', 'Work', creds);

    // Two accounts with no link is ambiguous: nothing to hydrate.
    expect((await repo.getProvider('metasub'))?.oauth_account).toBeUndefined();

    // Saving with the hydrated name links the FK, disambiguating later reads.
    await repo.saveProvider('metasub', oauthProvider('Personal'));
    expect((await repo.getProvider('metasub'))?.oauth_account).toBe('Personal');
  });

  it('matches the credential when the saved account name has surrounding whitespace', async () => {
    await repo.setOAuthCredentials('meta', 'Personal', creds);

    await repo.saveProvider('metasub', oauthProvider('  Personal  '));
    expect((await repo.getProvider('metasub'))?.oauth_account).toBe('Personal');
  });
});
