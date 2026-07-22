import { describe, expect, it, vi } from 'vitest';
import { OAuthLoginSessionManager } from '../oauth-login-session';
import type { OAuthProviderDescriptor } from '../oauth-providers';

// A provider whose login mimics pi-ai's Anthropic flow: it waits on a
// manual-code prompt and only releases its (fake) callback resource when that
// prompt settles. Rejecting the prompt is therefore what frees the port.
function makeProviderResolver() {
  let promptRejected: ((reason: unknown) => void) | null = null;
  const portReleased = vi.fn();

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
