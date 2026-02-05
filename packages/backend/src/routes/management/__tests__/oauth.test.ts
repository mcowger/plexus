import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import Fastify from 'fastify';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { OAuthProviderInterface } from '@mariozechner/pi-ai';
import { registerOAuthRoutes } from '../oauth';
import { OAuthLoginSessionManager } from '../../../services/oauth-login-session';
import { OAuthAuthManager } from '../../../services/oauth-auth-manager';

const waitForStatus = async (fastify: ReturnType<typeof Fastify>, sessionId: string, status: string) => {
  for (let i = 0; i < 50; i += 1) {
    const response = await fastify.inject({
      method: 'GET',
      url: `/v0/management/oauth/sessions/${sessionId}`
    });
    const json = response.json() as { data?: { status?: string } };
    if (json.data?.status === status) {
      return json;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timeout waiting for status ${status}`);
};

describe('OAuth management routes', () => {
  let fastify: ReturnType<typeof Fastify>;
  let manager: OAuthLoginSessionManager;
  let authPath: string;
  let originalAuthEnv: string | undefined;

  beforeEach(async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plexus-oauth-'));
    authPath = path.join(tempDir, 'auth.json');
    originalAuthEnv = process.env.AUTH_JSON;
    process.env.AUTH_JSON = authPath;
    OAuthAuthManager.resetForTesting();

    const provider: OAuthProviderInterface = {
      id: 'test-provider',
      name: 'Test Provider',
      async login(callbacks) {
        callbacks.onAuth({ url: 'https://example.com/auth', instructions: 'Test instructions' });
        const code = await callbacks.onPrompt({ message: 'Enter code' });
        if (code !== 'test-code') {
          throw new Error('Invalid code');
        }
        return {
          access: 'access-token',
          refresh: 'refresh-token',
          expires: Date.now() + 60_000
        };
      },
      async refreshToken(credentials) {
        return credentials;
      },
      getApiKey(credentials) {
        return credentials.access;
      }
    };

    manager = new OAuthLoginSessionManager((id) => (id === provider.id ? provider : undefined));
    fastify = Fastify();
    await registerOAuthRoutes(fastify, manager);
  });

  afterEach(() => {
    manager.dispose();
    OAuthAuthManager.resetForTesting();
    if (originalAuthEnv === undefined) {
      delete process.env.AUTH_JSON;
    } else {
      process.env.AUTH_JSON = originalAuthEnv;
    }
  });

  it('persists credentials after prompt flow', async () => {
    const response = await fastify.inject({
      method: 'POST',
      url: '/v0/management/oauth/sessions',
      payload: { providerId: 'test-provider' }
    });
    const session = response.json() as { data: { id: string } };

    await waitForStatus(fastify, session.data.id, 'awaiting_prompt');

    await fastify.inject({
      method: 'POST',
      url: `/v0/management/oauth/sessions/${session.data.id}/prompt`,
      payload: { value: 'test-code' }
    });

    await waitForStatus(fastify, session.data.id, 'success');

    const authContents = fs.readFileSync(authPath, 'utf-8');
    const authJson = JSON.parse(authContents) as Record<string, any>;

    expect(authJson['test-provider']).toBeDefined();
    expect(authJson['test-provider'].type).toBe('oauth');
    expect(authJson['test-provider'].access).toBe('access-token');
    expect(authJson['test-provider'].refresh).toBe('refresh-token');

    const authManager = OAuthAuthManager.getInstance();
    authManager.reload();
    expect(authManager.hasProvider('test-provider')).toBe(true);
  });

  it('accepts manual code input for callback flows', async () => {
    const manualProvider: OAuthProviderInterface = {
      id: 'manual-provider',
      name: 'Manual Provider',
      usesCallbackServer: true,
      async login(callbacks) {
        callbacks.onAuth({ url: 'https://example.com/callback' });
        const manual = await callbacks.onManualCodeInput?.();
        if (manual !== 'manual-code') {
          throw new Error('Invalid manual code');
        }
        return {
          access: 'manual-access',
          refresh: 'manual-refresh',
          expires: Date.now() + 60_000
        };
      },
      async refreshToken(credentials) {
        return credentials;
      },
      getApiKey(credentials) {
        return credentials.access;
      }
    };

    manager.dispose();
    manager = new OAuthLoginSessionManager((id) => (id === manualProvider.id ? manualProvider : undefined));
    fastify = Fastify();
    await registerOAuthRoutes(fastify, manager);

    const response = await fastify.inject({
      method: 'POST',
      url: '/v0/management/oauth/sessions',
      payload: { providerId: 'manual-provider' }
    });
    const session = response.json() as { data: { id: string } };

    await waitForStatus(fastify, session.data.id, 'awaiting_manual_code');

    await fastify.inject({
      method: 'POST',
      url: `/v0/management/oauth/sessions/${session.data.id}/manual-code`,
      payload: { value: 'manual-code' }
    });

    await waitForStatus(fastify, session.data.id, 'success');

    const authContents = fs.readFileSync(authPath, 'utf-8');
    const authJson = JSON.parse(authContents) as Record<string, any>;

    expect(authJson['manual-provider']).toBeDefined();
    expect(authJson['manual-provider'].access).toBe('manual-access');
  });
});
