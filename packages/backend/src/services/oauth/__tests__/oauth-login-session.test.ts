import { describe, expect, it, mock, spyOn, test } from 'bun:test';

import { registerSpy, waitFor } from '../../../../test/test-utils';
import { ConfigService } from '../../configuration/config-service';
import { INSTALLATION_DEVICE_ID_SETTING } from '../installation-identity';
import { OAuthAuthManager } from '../oauth-auth-manager';
import { OAuthLoginSessionManager } from '../oauth-login-session';
import type { OAuthProviderDescriptor } from '../oauth-providers';

// A provider whose login mimics pi-ai's Anthropic flow: it waits on a
// manual-code prompt and only releases its (fake) callback resource when that
// prompt settles. Rejecting the prompt is therefore what frees the port.
function makeProviderResolver() {
  let promptRejected: ((reason: unknown) => void) | null = null;
  const portReleased = mock();

  const descriptor = {
    id: 'anthropic',
    name: 'Anthropic',
    usesCallbackServer: true,
    oauth: {
      name: 'Anthropic',
      async login(interaction: any) {
        try {
          await interaction.prompt({ type: 'manual_code', message: 'paste' });
          return { type: 'oauth', access: 'a', refresh: 'r', expires: Date.now() };
        } catch (error) {
          promptRejected?.(error);
          throw error;
        } finally {
          portReleased();
        }
      },
      refresh: async () => ({ type: 'oauth', access: 'a', refresh: 'r', expires: 0 }),
      toAuth: async () => ({ apiKey: 'a' }),
    },
  } as unknown as OAuthProviderDescriptor;

  return {
    resolver: () => descriptor,
    portReleased,
    onPromptRejected: (fn: (reason: unknown) => void) => {
      promptRejected = fn;
    },
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('OAuthLoginSessionManager — callback port release', () => {
  it('rejects the pending prompt (releasing the port) on cancel', async () => {
    const provider = makeProviderResolver();
    const manager = new OAuthLoginSessionManager(provider.resolver);

    const session = await manager.createSession('anthropic', 'acct');
    await flush();
    expect(manager.getSession(session.id)?.status).toBe('awaiting_manual_code');

    await manager.cancel(session.id);
    await flush();

    expect(provider.portReleased).toHaveBeenCalledTimes(1);
    manager.dispose();
  });

  it('rejects the pending prompt (releasing the port) when a session expires', async () => {
    const provider = makeProviderResolver();
    const manager = new OAuthLoginSessionManager(provider.resolver);

    const session = await manager.createSession('anthropic', 'acct');
    await flush();

    // Force expiry, then trigger cleanup via any read.
    (manager as any).sessions.get(session.id).expiresAt = Date.now() - 1;
    manager.getSession(session.id);
    await flush();

    expect(provider.portReleased).toHaveBeenCalledTimes(1);
    manager.dispose();
  });

  it('rejects the pending prompt (releasing the port) on dispose', async () => {
    const provider = makeProviderResolver();
    const manager = new OAuthLoginSessionManager(provider.resolver);

    await manager.createSession('anthropic', 'acct');
    await flush();

    manager.dispose();
    await flush();

    expect(provider.portReleased).toHaveBeenCalledTimes(1);
  });
});

describe('OAuthLoginSessionManager — concurrent login guard', () => {
  it('supersedes an active callback-server login, releasing its port', async () => {
    const provider = makeProviderResolver();
    const manager = new OAuthLoginSessionManager(provider.resolver);

    const first = await manager.createSession('anthropic', 'acct-1');
    await flush();

    const second = await manager.createSession('anthropic', 'acct-2');
    await flush();

    // The stale login was cancelled and its port released before the new one.
    expect(provider.portReleased).toHaveBeenCalledTimes(1);
    expect(manager.getSession(first.id)?.status).toBe('cancelled');
    expect(manager.getSession(first.id)?.error).toBe('Superseded by a new login');
    expect(second.accountId).toBe('acct-2');
    expect(manager.getSession(second.id)?.status).toBe('awaiting_manual_code');

    manager.dispose();
  });

  it('allows a new login once the previous one is cancelled', async () => {
    const provider = makeProviderResolver();
    const manager = new OAuthLoginSessionManager(provider.resolver);

    const first = await manager.createSession('anthropic', 'acct-1');
    await flush();
    await manager.cancel(first.id);
    await flush();

    const second = await manager.createSession('anthropic', 'acct-2');
    expect(second.accountId).toBe('acct-2');

    manager.dispose();
  });
});

describe('OAuthLoginSessionManager — completed login', () => {
  const provider = {
    id: 'anthropic',
    name: 'Anthropic',
    usesCallbackServer: false,
    oauth: {
      name: 'Anthropic',
      login: async () => ({
        type: 'oauth',
        access: 'a',
        refresh: 'r',
        expires: Date.now() + 60_000,
      }),
      refresh: async (credentials) => credentials,
      toAuth: async (credentials) => ({ apiKey: credentials.access }),
    },
  } as OAuthProviderDescriptor;

  it('does not finish or cancel a login while its credential save is pending', async () => {
    OAuthAuthManager.resetForTesting();
    const authManager = OAuthAuthManager.getInstance();
    let releaseSave!: () => void;
    let saveStarted!: () => void;
    const saving = new Promise<void>((resolve) => {
      releaseSave = resolve;
    });
    const started = new Promise<void>((resolve) => {
      saveStarted = resolve;
    });
    registerSpy(authManager, 'setCredentials').mockImplementation(async () => {
      saveStarted();
      await saving;
    });

    const manager = new OAuthLoginSessionManager(() => provider);

    try {
      const session = await manager.createSession('anthropic', 'acct');
      await started;
      expect(manager.getSession(session.id)?.status).toBe('in_progress');

      const cancellation = manager.cancel(session.id);
      expect(manager.getSession(session.id)?.status).toBe('in_progress');

      releaseSave();
      await waitFor(() => expect(manager.getSession(session.id)?.status).toBe('success'));
      await expect(cancellation).resolves.toMatchObject({ status: 'success' });
    } finally {
      releaseSave();
      manager.dispose();
      OAuthAuthManager.resetForTesting();
    }
  });

  it('reports an error when credential persistence fails', async () => {
    OAuthAuthManager.resetForTesting();
    const authManager = OAuthAuthManager.getInstance();
    registerSpy(authManager, 'setCredentials').mockRejectedValue(new Error('database unavailable'));
    const manager = new OAuthLoginSessionManager(() => provider);

    try {
      const session = await manager.createSession('anthropic', 'acct');
      await waitFor(() => expect(manager.getSession(session.id)?.status).toBe('error'));
      expect(manager.getSession(session.id)?.error).toBe('database unavailable');
    } finally {
      manager.dispose();
      OAuthAuthManager.resetForTesting();
    }
  });
});

describe('OAuthLoginSessionManager — installation device ID', () => {
  // Sign in with ChatGPT aborts immediately unless the login is handed a UUID.
  it('passes the persisted installation device ID to the provider login', async () => {
    OAuthAuthManager.resetForTesting();
    const deviceId = '9f1d3a6e-6c2b-4b6a-9c2f-2d6f0b8f9a11';
    spyOn(ConfigService.getInstance(), 'getSetting').mockImplementation((async (key: string) =>
      key === INSTALLATION_DEVICE_ID_SETTING ? deviceId : undefined) as never);
    registerSpy(OAuthAuthManager.getInstance(), 'setCredentials').mockResolvedValue();

    const seen: Array<(() => string) | undefined> = [];
    const provider = {
      id: 'openai',
      name: 'OpenAI',
      usesCallbackServer: false,
      oauth: {
        name: 'OpenAI',
        login: async (_interaction: any, options?: { getDeviceId?: () => string }) => {
          seen.push(options?.getDeviceId);
          return { type: 'oauth', access: 'a', refresh: 'r', expires: Date.now() + 60_000 };
        },
        refresh: async (credential: any) => credential,
        toAuth: async (credential: any) => ({ apiKey: credential.access }),
      },
    } as unknown as OAuthProviderDescriptor;

    const manager = new OAuthLoginSessionManager(() => provider);
    try {
      const session = await manager.createSession('openai', 'acct');
      await waitFor(() => expect(manager.getSession(session.id)?.status).toBe('success'));
      expect(seen).toHaveLength(1);
      expect(seen[0]?.()).toBe(deviceId);
    } finally {
      manager.dispose();
      OAuthAuthManager.resetForTesting();
    }
  });
});

describe('OAuthLoginSessionManager — select prompts', () => {
  const selectProvider = {
    id: 'openai-codex',
    name: 'Codex',
    usesCallbackServer: false,
    oauth: {
      name: 'Codex',
      login: async (interaction: any) => {
        const method = await interaction.prompt({
          type: 'select',
          message: 'Select OpenAI Codex login method:',
          options: [
            { id: 'browser', label: 'Browser login (default)' },
            { id: 'device_code', label: 'Device code login (headless)' },
          ],
        });
        return { type: 'oauth', access: method, refresh: 'r', expires: Date.now() + 60_000 };
      },
      refresh: async (credential: any) => credential,
      toAuth: async (credential: any) => ({ apiKey: credential.access }),
    },
  } as unknown as OAuthProviderDescriptor;

  it('surfaces a select prompt and continues with the chosen option', async () => {
    OAuthAuthManager.resetForTesting();
    const authManager = OAuthAuthManager.getInstance();
    const save = registerSpy(authManager, 'setCredentials').mockResolvedValue();
    const manager = new OAuthLoginSessionManager(() => selectProvider);

    try {
      const session = await manager.createSession('openai-codex', 'acct');
      await waitFor(() => expect(manager.getSession(session.id)?.status).toBe('awaiting_select'));

      expect(manager.getSession(session.id)?.select).toEqual({
        message: 'Select OpenAI Codex login method:',
        options: [
          { id: 'browser', label: 'Browser login (default)' },
          { id: 'device_code', label: 'Device code login (headless)' },
        ],
      });

      await manager.submitSelect(session.id, 'device_code');
      await waitFor(() => expect(manager.getSession(session.id)?.status).toBe('success'));
      expect(save).toHaveBeenCalledWith(
        'openai-codex',
        'acct',
        expect.objectContaining({ access: 'device_code' })
      );
      expect(manager.getSession(session.id)?.select).toBeUndefined();
    } finally {
      manager.dispose();
      OAuthAuthManager.resetForTesting();
    }
  });

  it('rejects an option that was not offered', async () => {
    OAuthAuthManager.resetForTesting();
    const manager = new OAuthLoginSessionManager(() => selectProvider);

    try {
      const session = await manager.createSession('openai-codex', 'acct');
      await waitFor(() => expect(manager.getSession(session.id)?.status).toBe('awaiting_select'));
      await expect(manager.submitSelect(session.id, 'nope')).rejects.toThrow(
        'Unknown option: nope'
      );
    } finally {
      manager.dispose();
      OAuthAuthManager.resetForTesting();
    }
  });
});
