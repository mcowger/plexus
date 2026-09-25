import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDatabase } from '../../src/db/client';
import { ConfigRepository } from '../../src/db/config-repository';
import { ConfigService } from '../../src/services/configuration/config-service';
import { ModelAutosyncScheduler } from '../../src/services/models/model-autosync-scheduler';
import { creds, oauthProvider, resetOAuthDatabase, rotated } from '../oauth-credential-test-utils';
import { registerSpy } from '../test-utils';

describe('ConfigService OAuth credential cache', () => {
  let repo: ConfigRepository;
  let service: ConfigService;

  beforeEach(async () => {
    ConfigService.resetInstance();
    ModelAutosyncScheduler.resetInstance();
    repo = await resetOAuthDatabase();
    service = new ConfigService(repo);
    await service.initialize();
  });

  afterEach(async () => {
    await service.flush();
    ModelAutosyncScheduler.resetInstance();
    ConfigService.resetInstance();
    await closeDatabase();
  });

  it('hydrates a provider saved before login without re-saving it', async () => {
    await service.saveProvider('metasub', oauthProvider());
    await service.flush();
    expect(service.getConfig().providers['metasub']?.oauth_account).toBeUndefined();

    const rebuild = registerSpy(repo, 'getAllProviders');
    await service.setOAuthCredentials('meta', 'metasub', creds);

    // The login alone triggers the rebuild (no flush, no provider save).
    expect(rebuild).toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(service.getConfig().providers['metasub']?.oauth_account).toBe('metasub');
    });
  });

  it('skips the cache rebuild for a token rotation', async () => {
    await service.saveProvider('metasub', oauthProvider());
    await service.setOAuthCredentials('meta', 'metasub', creds);
    await service.flush();
    expect(service.getConfig().providers['metasub']?.oauth_account).toBe('metasub');

    const rebuild = registerSpy(repo, 'getAllProviders');
    await service.setOAuthCredentials('meta', 'metasub', rotated);

    expect(rebuild).not.toHaveBeenCalled();
    expect((await service.getOAuthCredentials('meta', 'metasub'))?.accessToken).toBe('access-2');
  });

  it('rebuilds the cache after a credential delete', async () => {
    await service.saveProvider('metasub', oauthProvider());
    await service.setOAuthCredentials('meta', 'metasub', creds);
    await service.flush();
    expect(service.getConfig().providers['metasub']?.oauth_account).toBe('metasub');

    const rebuild = registerSpy(repo, 'getAllProviders');
    await service.deleteOAuthCredentials('meta', 'metasub');

    expect(rebuild).toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(service.getConfig().providers['metasub']?.oauth_account).toBeUndefined();
    });
  });

  it('passes credential timestamps through', async () => {
    await service.setOAuthCredentials('meta', 'metasub', creds);

    const timestamps = await service.getOAuthCredentialTimestamps('meta', 'metasub');

    expect(timestamps).toEqual({
      createdAt: expect.any(Number),
      updatedAt: expect.any(Number),
      expiresAt: 2000000000,
    });
    expect(await service.getOAuthCredentialTimestamps('meta', 'nobody')).toBeNull();
  });
});
