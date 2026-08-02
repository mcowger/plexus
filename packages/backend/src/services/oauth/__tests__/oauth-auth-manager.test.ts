import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OAuthAuthManager } from '../oauth-auth-manager';

const mocks = vi.hoisted(() => ({
  configService: {
    getAllOAuthProviders: vi.fn(),
    getOAuthCredentials: vi.fn(),
    setOAuthCredentials: vi.fn(),
  },
  getConfigInstance: vi.fn(),
  getOAuthProviderAuth: vi.fn(),
  refresh: vi.fn(),
  toAuth: vi.fn(),
}));

vi.mock('../../configuration/config-service', () => ({
  ConfigService: { getInstance: mocks.getConfigInstance },
}));

vi.mock('../oauth-providers', () => ({
  getOAuthProviderAuth: mocks.getOAuthProviderAuth,
}));

const initialCredentials = {
  accessToken: 'old-access',
  refreshToken: 'old-refresh',
  expiresAt: Date.now() + 8 * 60 * 60 * 1000,
};

const refreshedCredentials = {
  type: 'oauth' as const,
  access: 'new-access',
  refresh: 'new-refresh',
  expires: Date.now() + 8 * 60 * 60 * 1000,
};

describe('OAuthAuthManager', () => {
  beforeEach(() => {
    OAuthAuthManager.resetForTesting();
    mocks.getConfigInstance.mockReturnValue(mocks.configService);
    mocks.configService.getAllOAuthProviders.mockResolvedValue([
      { providerType: 'anthropic', accountId: 'personal' },
    ]);
    mocks.configService.getOAuthCredentials.mockResolvedValue(initialCredentials);
    mocks.configService.setOAuthCredentials.mockResolvedValue(undefined);
    mocks.refresh.mockResolvedValue(refreshedCredentials);
    mocks.toAuth.mockImplementation(async (credentials: { access: string }) => ({
      apiKey: credentials.access,
    }));
    mocks.getOAuthProviderAuth.mockReturnValue({
      oauth: {
        refresh: mocks.refresh,
        toAuth: mocks.toAuth,
      },
    });
  });

  async function createManager(): Promise<OAuthAuthManager> {
    const manager = OAuthAuthManager.getInstance();
    await manager.initialize();
    return manager;
  }

  it('refreshes proactively at the requested cadence and persists rotated credentials', async () => {
    const manager = await createManager();

    await expect(
      manager.getApiKey('anthropic', 'personal', { refreshIfOlderThanMs: 60 * 60 * 1000 })
    ).resolves.toBe('new-access');
    await expect(
      manager.getApiKey('anthropic', 'personal', { refreshIfOlderThanMs: 60 * 60 * 1000 })
    ).resolves.toBe('new-access');

    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(mocks.configService.setOAuthCredentials).toHaveBeenCalledWith('anthropic', 'personal', {
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
      expiresAt: expect.any(Number),
    });
  });

  it('keeps the existing refresh token when a refresh response omits rotation', async () => {
    mocks.refresh.mockResolvedValueOnce({
      type: 'oauth',
      access: 'new-access',
      expires: Date.now() + 8 * 60 * 60 * 1000,
    });
    const manager = await createManager();

    await manager.getApiKey('anthropic', 'personal', { refreshIfOlderThanMs: 0 });

    expect(mocks.configService.setOAuthCredentials).toHaveBeenCalledWith(
      'anthropic',
      'personal',
      expect.objectContaining({ refreshToken: 'old-refresh' })
    );
  });

  it('serializes concurrent refreshes for one account', async () => {
    let resolveRefresh: ((value: typeof refreshedCredentials) => void) | undefined;
    mocks.refresh.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRefresh = resolve;
        })
    );
    const manager = await createManager();

    const first = manager.getApiKey('anthropic', 'personal', { refreshIfOlderThanMs: 0 });
    const second = manager.getApiKey('anthropic', 'personal', { refreshIfOlderThanMs: 0 });

    await vi.waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
    resolveRefresh?.(refreshedCredentials);

    await expect(Promise.all([first, second])).resolves.toEqual(['new-access', 'new-access']);
  });

  it('does not proactively refresh without a refresh cadence', async () => {
    const manager = await createManager();

    await expect(manager.getApiKey('anthropic', 'personal')).resolves.toBe('old-access');

    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});
