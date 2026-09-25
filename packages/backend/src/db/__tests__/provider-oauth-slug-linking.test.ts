import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  creds,
  oauthProvider,
  resetOAuthDatabase,
} from '../../../test/oauth-credential-test-utils';
import { closeDatabase } from '../client';
import { ConfigRepository } from '../config-repository';
import type { ProviderConfig } from '../../config';

describe('provider OAuth slug linking', () => {
  let repo: ConfigRepository;

  beforeEach(async () => {
    repo = await resetOAuthDatabase();
  });

  afterEach(async () => {
    await closeDatabase();
  });

  it('links the credential named after the provider slug, ignoring a stale account', async () => {
    await repo.setOAuthCredentials('meta', 'metasub', creds);
    await repo.setOAuthCredentials('meta', 'legacy-name', creds);

    // A stale incoming account must not win over the 1:1 slug key.
    await repo.saveProvider('metasub', oauthProvider('legacy-name'));

    expect((await repo.getProvider('metasub'))?.oauth_account).toBe('metasub');
  });

  it('falls back to a provided legacy account when no slug credential exists', async () => {
    await repo.setOAuthCredentials('meta', 'Personal', creds);

    // Restore/import path: grandfathered rows keep working.
    await repo.saveProvider('metasub', oauthProvider('Personal'));

    expect((await repo.getProvider('metasub'))?.oauth_account).toBe('Personal');
  });

  it('links a provider saved before login once the slug credential arrives', async () => {
    await repo.saveProvider('metasub', oauthProvider());
    expect((await repo.getProvider('metasub'))?.oauth_account).toBeUndefined();

    await repo.setOAuthCredentials('meta', 'metasub', creds);

    expect((await repo.getProvider('metasub'))?.oauth_account).toBe('metasub');
  });

  it('does not link a slug credential of a different provider type', async () => {
    await repo.saveProvider('metasub', oauthProvider());
    await repo.setOAuthCredentials('openai-codex', 'metasub', creds);

    expect((await repo.getProvider('metasub'))?.oauth_account).toBeUndefined();
  });

  it('deletes the exclusive credential with its provider', async () => {
    await repo.saveProvider('metasub', oauthProvider());
    await repo.setOAuthCredentials('meta', 'metasub', creds);

    const deleted = await repo.deleteProvider('metasub', true);

    expect(deleted).toEqual({ providerType: 'meta', accountId: 'metasub' });
    expect(await repo.getOAuthCredentials('meta', 'metasub')).toBeNull();
  });

  it('spares a credential still referenced by another provider', async () => {
    await repo.setOAuthCredentials('meta', 'shared', creds);
    await repo.saveProvider('first', {
      ...oauthProvider('shared'),
      oauth_provider: 'meta',
    } as ProviderConfig);
    await repo.saveProvider('second', {
      ...oauthProvider('shared'),
      oauth_provider: 'meta',
    } as ProviderConfig);

    const deleted = await repo.deleteProvider('first', true);

    expect(deleted).toBeNull();
    expect(await repo.getOAuthCredentials('meta', 'shared')).not.toBeNull();
    expect((await repo.getProvider('second'))?.oauth_account).toBe('shared');
  });

  it('preserves a grandfathered link across writes that carry no account', async () => {
    await repo.setOAuthCredentials('meta', 'Personal', creds);
    await repo.saveProvider('metasub', oauthProvider('Personal'));
    expect((await repo.getProvider('metasub'))?.oauth_account).toBe('Personal');

    // What the UI now sends: no oauth_account at all.
    await repo.saveProvider('metasub', oauthProvider());

    expect((await repo.getProvider('metasub'))?.oauth_account).toBe('Personal');
  });

  it('drops the preserved link when the provider switches OAuth types', async () => {
    await repo.setOAuthCredentials('meta', 'Personal', creds);
    await repo.saveProvider('metasub', oauthProvider('Personal'));

    await repo.saveProvider('metasub', {
      ...oauthProvider(),
      oauth_provider: 'openai-codex',
    } as ProviderConfig);

    expect((await repo.getProvider('metasub'))?.oauth_account).toBeUndefined();
  });

  it('spares the sole credential consumed via fallback by another provider', async () => {
    await repo.setOAuthCredentials('meta', 'lonely', creds);
    await repo.saveProvider('linked', oauthProvider('lonely'));
    await repo.saveProvider('unlinked', oauthProvider());
    expect((await repo.getProvider('unlinked'))?.oauth_account).toBe('lonely');

    const deleted = await repo.deleteProvider('linked', true);

    expect(deleted).toBeNull();
    expect(await repo.getOAuthCredentials('meta', 'lonely')).not.toBeNull();
    expect((await repo.getProvider('unlinked'))?.oauth_account).toBe('lonely');
  });

  it('removes the credential when fallback consumers are already ambiguous', async () => {
    await repo.setOAuthCredentials('meta', 'gone', creds);
    await repo.setOAuthCredentials('meta', 'stays', creds);
    await repo.saveProvider('linked', oauthProvider('gone'));
    await repo.saveProvider('unlinked', oauthProvider());
    expect((await repo.getProvider('unlinked'))?.oauth_account).toBeUndefined();

    const deleted = await repo.deleteProvider('linked', true);

    expect(deleted).toEqual({ providerType: 'meta', accountId: 'gone' });
    expect(await repo.getOAuthCredentials('meta', 'gone')).toBeNull();
    expect(await repo.getOAuthCredentials('meta', 'stays')).not.toBeNull();
  });

  it('does not preserve the link when an explicit account fails to resolve', async () => {
    await repo.setOAuthCredentials('meta', 'Personal', creds);
    await repo.setOAuthCredentials('meta', 'Other', creds);
    await repo.saveProvider('metasub', oauthProvider('Personal'));
    expect((await repo.getProvider('metasub'))?.oauth_account).toBe('Personal');

    // Restore/import naming a credential that doesn't exist: the stale link
    // must not be silently retained.
    await repo.saveProvider('metasub', oauthProvider('ghost'));

    expect((await repo.getProvider('metasub'))?.oauth_account).toBeUndefined();
  });

  it('spares the legacy credential consumed via fallback despite other credentials', async () => {
    await repo.setOAuthCredentials('meta', 'legacy', creds);
    await repo.setOAuthCredentials('meta', 'other', creds);
    await repo.saveProvider('linked', oauthProvider('legacy'));
    await repo.saveProvider('unlinked', oauthProvider());
    // The runtime resolves the well-known legacy account deterministically.
    expect((await repo.getProvider('unlinked'))?.oauth_account).toBe('legacy');

    const deleted = await repo.deleteProvider('linked', true);

    expect(deleted).toBeNull();
    expect(await repo.getOAuthCredentials('meta', 'legacy')).not.toBeNull();
    expect((await repo.getProvider('unlinked'))?.oauth_account).toBe('legacy');
  });
});
