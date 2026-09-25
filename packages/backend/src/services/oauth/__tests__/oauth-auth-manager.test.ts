import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OAuthAuthManager } from '../oauth-auth-manager';

const mocks = vi.hoisted(() => ({
  configService: {
    getAllOAuthProviders: vi.fn(),
    getOAuthCredentials: vi.fn(),
    setOAuthCredentials: vi.fn(),
    deleteOAuthCredentials: vi.fn(),
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

  it('propagates cancellation while waiting behind another account refresh', async () => {
    vi.useFakeTimers();
    mocks.configService.getAllOAuthProviders.mockResolvedValue([
      { providerType: 'anthropic', accountId: 'personal' },
      { providerType: 'anthropic', accountId: 'work' },
    ]);
    mocks.configService.getOAuthCredentials.mockResolvedValue(initialCredentials);

    let resolveFirstRefresh: ((value: typeof refreshedCredentials) => void) | undefined;
    mocks.refresh
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirstRefresh = resolve;
          })
      )
      .mockResolvedValueOnce(refreshedCredentials);

    const manager = await createManager();
    const first = manager.getApiKey('anthropic', 'personal', { refreshIfOlderThanMs: 0 });
    await vi.waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));

    const controller = new AbortController();
    const second = manager.getApiKey('anthropic', 'work', {
      refreshIfOlderThanMs: 0,
      signal: controller.signal,
    });
    controller.abort(new DOMException('Request aborted', 'AbortError'));

    await expect(second).rejects.toMatchObject({ name: 'AbortError' });
    resolveFirstRefresh?.(refreshedCredentials);
    await expect(first).resolves.toBe('new-access');

    const third = manager.getApiKey('anthropic', 'work', { refreshIfOlderThanMs: 0 });
    await vi.advanceTimersByTimeAsync(30_000);
    await expect(third).resolves.toBe('new-access');
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

  it('propagates cancellation when joining an account refresh already in flight', async () => {
    let resolveRefresh: ((value: typeof refreshedCredentials) => void) | undefined;
    mocks.refresh.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRefresh = resolve;
        })
    );
    const manager = await createManager();

    const first = manager.getApiKey('anthropic', 'personal', { refreshIfOlderThanMs: 0 });
    await vi.waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));

    const controller = new AbortController();
    const second = manager.getApiKey('anthropic', 'personal', {
      refreshIfOlderThanMs: 0,
      signal: controller.signal,
    });
    controller.abort(new DOMException('Request aborted', 'AbortError'));

    await expect(second).rejects.toMatchObject({ name: 'AbortError' });
    resolveRefresh?.(refreshedCredentials);
    await expect(first).resolves.toBe('new-access');
  });

  it('does not proactively refresh without a refresh cadence', async () => {
    const manager = await createManager();

    await expect(manager.getApiKey('anthropic', 'personal')).resolves.toBe('old-access');

    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it('forces a refresh even when the token is still valid', async () => {
    const manager = await createManager();

    await expect(manager.forceRefresh('anthropic', 'personal')).resolves.toBe('new-access');

    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(mocks.configService.setOAuthCredentials).toHaveBeenCalledWith('anthropic', 'personal', {
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
      expiresAt: expect.any(Number),
    });
  });

  it('throws on forceRefresh failure even if the existing access token has not expired', async () => {
    mocks.refresh.mockRejectedValue(new Error('HTTP 401: Invalid token'));
    const manager = await createManager();

    await expect(manager.forceRefresh('anthropic', 'personal')).rejects.toThrow(
      'HTTP 401: Invalid token'
    );
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it('refreshes when token is within refreshIfExpiringWithinMs buffer', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    mocks.configService.getOAuthCredentials.mockResolvedValue({
      accessToken: 'expiring-access',
      refreshToken: 'valid-refresh',
      expiresAt: Date.now() + 5 * 60 * 1000, // 5 minutes remaining
    });
    const manager = await createManager();

    // With a 10-minute buffer, 5 minutes remaining should trigger refresh
    await expect(
      manager.getApiKey('anthropic', 'personal', { refreshIfExpiringWithinMs: 10 * 60 * 1000 })
    ).resolves.toBe('new-access');

    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it('refreshes by default when token is within the default 60s expiry buffer', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    mocks.configService.getOAuthCredentials.mockResolvedValue({
      accessToken: 'almost-expired-access',
      refreshToken: 'valid-refresh',
      expiresAt: Date.now() + 30 * 1000, // 30 seconds remaining (<= 60s default buffer)
    });
    const manager = await createManager();

    await expect(manager.getApiKey('anthropic', 'personal')).resolves.toBe('new-access');

    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it('honors refresh backoff on repeated forceRefresh calls after token-endpoint failure', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    mocks.refresh.mockRejectedValue(new Error('HTTP 500: Internal Server Error'));
    const manager = await createManager();

    // First forceRefresh attempts refresh and fails, establishing a 60s backoff
    await expect(manager.forceRefresh('anthropic', 'personal')).rejects.toThrow('HTTP 500');
    expect(mocks.refresh).toHaveBeenCalledTimes(1);

    // Second forceRefresh within 60s throws backoff error without hitting the endpoint again
    await expect(manager.forceRefresh('anthropic', 'personal')).rejects.toThrow(
      /is backed off until/
    );
    expect(mocks.refresh).toHaveBeenCalledTimes(1);

    // After backoff window expires (60s), next forceRefresh can retry
    vi.advanceTimersByTime(61 * 1000);
    await expect(manager.forceRefresh('anthropic', 'personal')).rejects.toThrow('HTTP 500');
    expect(mocks.refresh).toHaveBeenCalledTimes(2);
  });

  it('evicts in-memory credentials without touching persistence', async () => {
    const manager = await createManager();
    await manager.setCredentials('anthropic', 'personal', {
      access: 'a',
      refresh: 'r',
      expires: Date.now() + 3600 * 1000,
    });
    expect(manager.hasProvider('anthropic', 'personal')).toBe(true);

    expect(manager.evictCredentials('anthropic', 'personal')).toBe(true);
    expect(manager.hasProvider('anthropic', 'personal')).toBe(false);
    expect(manager.evictCredentials('anthropic', 'personal')).toBe(false);
    expect(manager.evictCredentials('anthropic', '')).toBe(false);
  });

  it('rejects a login save that fails and keeps the previous in-memory credential', async () => {
    const manager = await createManager();
    mocks.configService.setOAuthCredentials.mockRejectedValue(new Error('database unavailable'));

    await expect(
      manager.setCredentials('anthropic', 'personal', {
        access: 'replacement',
        refresh: 'replacement-refresh',
        expires: Date.now() + 3600 * 1000,
      })
    ).rejects.toThrow('database unavailable');

    expect(manager.getCredentials('anthropic', 'personal')?.access).toBe('old-access');
    expect(manager.hasProvider('anthropic', 'personal')).toBe(true);
  });

  it('does not expose a new account when its login save fails', async () => {
    const manager = await createManager();
    mocks.configService.setOAuthCredentials.mockRejectedValue(new Error('database unavailable'));

    await expect(
      manager.setCredentials('anthropic', 'work', {
        access: 'new-access',
        refresh: 'new-refresh',
        expires: Date.now() + 3600 * 1000,
      })
    ).rejects.toThrow('database unavailable');

    expect(manager.hasProvider('anthropic', 'work')).toBe(false);
  });

  it('deleteCredentials persists then evicts through the shared path', async () => {
    const manager = await createManager();
    await manager.setCredentials('anthropic', 'personal', {
      access: 'a',
      refresh: 'r',
      expires: Date.now() + 3600 * 1000,
    });
    mocks.configService.deleteOAuthCredentials.mockResolvedValue(undefined);

    await expect(manager.deleteCredentials('anthropic', 'personal')).resolves.toBe(true);

    expect(mocks.configService.deleteOAuthCredentials).toHaveBeenCalledWith(
      'anthropic',
      'personal'
    );
    expect(manager.hasProvider('anthropic', 'personal')).toBe(false);
  });
});
