import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

  afterEach(() => {
    vi.useRealTimers();
  });

  async function createManager(): Promise<OAuthAuthManager> {
    const manager = OAuthAuthManager.getInstance();
    await manager.initialize();
    return manager;
  }

  it('refreshes proactively at the requested cadence and persists rotated credentials', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const manager = await createManager();
    vi.advanceTimersByTime(60 * 60 * 1000);

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

  it('does not proactively refresh valid persisted credentials immediately after startup', async () => {
    const manager = await createManager();

    await expect(
      manager.getApiKey('anthropic', 'personal', { refreshIfOlderThanMs: 60 * 60 * 1000 })
    ).resolves.toBe('old-access');

    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it('serializes and spaces refreshes across accounts for the same provider', async () => {
    vi.useFakeTimers();
    mocks.configService.getAllOAuthProviders.mockResolvedValue([
      { providerType: 'anthropic', accountId: 'personal' },
      { providerType: 'anthropic', accountId: 'work' },
    ]);
    mocks.configService.getOAuthCredentials.mockResolvedValue(initialCredentials);
    const manager = await createManager();

    const first = manager.getApiKey('anthropic', 'personal', { refreshIfOlderThanMs: 0 });
    const second = manager.getApiKey('anthropic', 'work', { refreshIfOlderThanMs: 0 });
    await vi.advanceTimersByTimeAsync(0);

    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    await expect(first).resolves.toBe('new-access');

    await vi.advanceTimersByTimeAsync(29_999);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    await expect(second).resolves.toBe('new-access');
    expect(mocks.refresh).toHaveBeenCalledTimes(2);
  });

  it('backs off a failed proactive refresh and keeps using a valid access token', async () => {
    mocks.refresh.mockRejectedValue(new Error('HTTP 429: Too Many Requests'));
    const manager = await createManager();

    await expect(
      manager.getApiKey('anthropic', 'personal', { refreshIfOlderThanMs: 0 })
    ).resolves.toBe('old-access');
    await expect(
      manager.getApiKey('anthropic', 'personal', { refreshIfOlderThanMs: 0 })
    ).resolves.toBe('old-access');

    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it('propagates caller cancellation instead of falling back to the old token', async () => {
    mocks.refresh.mockImplementationOnce(
      (_credentials: unknown, signal: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        })
    );
    const manager = await createManager();
    const controller = new AbortController();

    const apiKey = manager.getApiKey('anthropic', 'personal', {
      refreshIfOlderThanMs: 0,
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
    controller.abort(new DOMException('Request aborted', 'AbortError'));

    await expect(apiKey).rejects.toMatchObject({ name: 'AbortError' });
    expect(mocks.configService.setOAuthCredentials).not.toHaveBeenCalled();
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
