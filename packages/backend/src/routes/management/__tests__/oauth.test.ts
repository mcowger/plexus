import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import type { OAuthProviderDescriptor } from '../../../services/oauth/oauth-providers';
import { registerOAuthRoutes } from '../oauth';
import { OAuthLoginSessionManager } from '../../../services/oauth/oauth-login-session';
import { OAuthAuthManager } from '../../../services/oauth/oauth-auth-manager';
import { CodexVersionService } from '../../../services/oauth/codex-version-service';
import { CODEX_IMAGE_MODELS } from '../../../services/providers/provider-model-discovery';
import { registerSpy } from '../../../../test/test-utils';

// @earendil-works/pi-ai is mocked globally in vitest.setup.ts — do not add a
// per-file vi.mock() call here.  With isolate: false all files share one
// module registry and competing registrations create last-writer-wins races.

const waitForStatus = async (
  fastify: ReturnType<typeof Fastify>,
  sessionId: string,
  status: string
) => {
  for (let i = 0; i < 50; i += 1) {
    const response = await fastify.inject({
      method: 'GET',
      url: `/v0/management/oauth/sessions/${sessionId}`,
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

  beforeEach(async () => {
    OAuthAuthManager.resetForTesting();

    const provider: OAuthProviderDescriptor = {
      id: 'test-provider',
      name: 'Test Provider',
      usesCallbackServer: false,
      oauth: {
        name: 'Test Provider',
        async login(interaction) {
          interaction.notify({
            type: 'auth_url',
            url: 'https://example.com/auth',
            instructions: 'Test instructions',
          });
          const code = await interaction.prompt({ type: 'text', message: 'Enter code' });
          if (code !== 'test-code') {
            throw new Error('Invalid code');
          }
          return {
            type: 'oauth',
            access: 'access-token',
            refresh: 'refresh-token',
            expires: Date.now() + 60_000,
          };
        },
        async refresh(credential) {
          return credential;
        },
        async toAuth(credential) {
          return { apiKey: credential.access };
        },
      },
    };

    manager = new OAuthLoginSessionManager((id) => (id === provider.id ? provider : undefined));
    fastify = Fastify();
    await registerOAuthRoutes(fastify, manager);
  });

  afterEach(() => {
    manager.dispose();
    OAuthAuthManager.resetForTesting();
  });

  it('persists credentials after prompt flow', async () => {
    const accountId = 'work';
    const response = await fastify.inject({
      method: 'POST',
      url: '/v0/management/oauth/sessions',
      payload: { providerId: 'test-provider', accountId },
    });
    const session = response.json() as { data: { id: string } };

    const awaiting = await waitForStatus(fastify, session.data.id, 'awaiting_prompt');
    // Text prompts surface through the generic prompt input, and blank
    // submission stays enabled (providers validate blank semantics, e.g.
    // Copilot's blank-for-github.com domain).
    const prompt = (awaiting.data as { prompt?: { message?: string; allowEmpty?: boolean } })
      ?.prompt;
    expect(prompt?.message).toBe('Enter code');
    expect(prompt?.allowEmpty).toBe(true);

    await fastify.inject({
      method: 'POST',
      url: `/v0/management/oauth/sessions/${session.data.id}/prompt`,
      payload: { value: 'test-code' },
    });

    await waitForStatus(fastify, session.data.id, 'success');

    // Credentials are now stored in the database, not auth.json.
    // Verify via the in-memory state of OAuthAuthManager.
    const authManager = OAuthAuthManager.getInstance();
    expect(authManager.hasProvider('test-provider' as any, accountId)).toBe(true);

    const deleteResponse = await fastify.inject({
      method: 'DELETE',
      url: '/v0/management/oauth/credentials',
      payload: { providerId: 'test-provider', accountId },
    });
    expect(deleteResponse.statusCode).toBe(200);

    // After delete, the in-memory cache should reflect the removal.
    await authManager.reload();
    expect(authManager.hasProvider('test-provider' as any, accountId)).toBe(false);
  });

  it('accepts manual code input for callback flows', async () => {
    const accountId = 'personal';
    const manualProvider: OAuthProviderDescriptor = {
      id: 'manual-provider',
      name: 'Manual Provider',
      usesCallbackServer: true,
      oauth: {
        name: 'Manual Provider',
        async login(interaction) {
          interaction.notify({ type: 'auth_url', url: 'https://example.com/callback' });
          const manual = await interaction.prompt({
            type: 'manual_code',
            message: 'Enter the code from the browser',
          });
          if (manual !== 'manual-code') {
            throw new Error('Invalid manual code');
          }
          return {
            type: 'oauth',
            access: 'manual-access',
            refresh: 'manual-refresh',
            expires: Date.now() + 60_000,
          };
        },
        async refresh(credential) {
          return credential;
        },
        async toAuth(credential) {
          return { apiKey: credential.access };
        },
      },
    };

    manager.dispose();
    manager = new OAuthLoginSessionManager((id) =>
      id === manualProvider.id ? manualProvider : undefined
    );
    fastify = Fastify();
    await registerOAuthRoutes(fastify, manager);

    const response = await fastify.inject({
      method: 'POST',
      url: '/v0/management/oauth/sessions',
      payload: { providerId: 'manual-provider', accountId },
    });
    const session = response.json() as { data: { id: string } };

    const awaiting = await waitForStatus(fastify, session.data.id, 'awaiting_manual_code');
    // Manual-code entry uses the dedicated redirect-URL input only — the
    // generic prompt object must stay unset so the UI renders one input.
    expect((awaiting.data as { prompt?: unknown })?.prompt).toBeUndefined();

    await fastify.inject({
      method: 'POST',
      url: `/v0/management/oauth/sessions/${session.data.id}/manual-code`,
      payload: { value: 'manual-code' },
    });

    await waitForStatus(fastify, session.data.id, 'success');

    // Credentials are now stored in the database, not auth.json.
    const authManager = OAuthAuthManager.getInstance();
    expect(authManager.hasProvider('manual-provider' as any, accountId)).toBe(true);
  });

  it('fetches OAuth provider models', async () => {
    const response = await fastify.inject({
      method: 'GET',
      url: '/v0/management/oauth/models?providerId=anthropic',
    });

    expect(response.statusCode).toBe(200);
    const json = response.json() as {
      data: Array<{
        id: string;
        name?: string;
        context_length?: number;
        pricing?: { prompt?: string; completion?: string };
      }>;
    };
    expect(Array.isArray(json.data)).toBe(true);
    expect(json.data.length).toBeGreaterThan(0);

    // Verify the first model has expected structure
    const firstModel = json.data[0];
    expect(firstModel).toBeDefined();
    if (firstModel) {
      expect(firstModel.id).toBeDefined();
      expect(typeof firstModel.id).toBe('string');

      // Check optional fields exist if present
      if (firstModel.name) {
        expect(typeof firstModel.name).toBe('string');
      }
      if (firstModel.context_length) {
        expect(typeof firstModel.context_length).toBe('number');
      }
      if (firstModel.pricing) {
        expect(firstModel.pricing).toBeDefined();
      }
    }
  });

  it('returns 400 for invalid providerId', async () => {
    const response = await fastify.inject({
      method: 'GET',
      url: '/v0/management/oauth/models?providerId=',
    });

    expect(response.statusCode).toBe(400);
    const json = response.json() as { error: string };
    expect(json.error).toBeDefined();
  });

  it('handles unknown provider gracefully', async () => {
    const response = await fastify.inject({
      method: 'GET',
      url: '/v0/management/oauth/models?providerId=unknown-provider',
    });

    // getModels returns empty array for unknown providers instead of throwing
    expect(response.statusCode).toBe(200);
    const json = response.json() as { data: Array<any> };
    expect(Array.isArray(json.data)).toBe(true);
    expect(json.data.length).toBe(0);
  });

  it('labels static-catalog answers with their source', async () => {
    const response = await fastify.inject({
      method: 'GET',
      url: '/v0/management/oauth/models?providerId=anthropic',
    });

    const json = response.json() as { source?: string; warning?: string };
    expect(json.source).toBe('catalog');
    expect(json.warning).toBeUndefined();
  });

  describe('Codex live model discovery', () => {
    beforeEach(() => {
      CodexVersionService.resetForTesting();
    });

    afterEach(() => {
      vi.restoreAllMocks();
      CodexVersionService.resetForTesting();
    });

    it('forwards accountId to the Codex backend and reports the live source', async () => {
      const getApiKey = registerSpy(OAuthAuthManager.getInstance(), 'getApiKey').mockResolvedValue(
        'codex-token'
      );
      const fetchSpy = registerSpy(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          models: [
            {
              slug: 'gpt-5.4-codex',
              display_name: 'GPT-5.4 Codex',
              visibility: 'list',
              priority: 5,
              context_window: 272000,
            },
          ],
        }),
      } as any);

      const response = await fastify.inject({
        method: 'GET',
        url: '/v0/management/oauth/models?providerId=openai-codex&accountId=work',
      });

      expect(response.statusCode).toBe(200);
      expect(getApiKey).toHaveBeenCalledWith('openai-codex', 'work');
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      const json = response.json() as {
        data: Array<{ id: string }>;
        source: string;
        warning?: string;
      };
      expect(json.source).toBe('codex-backend');
      expect(json.warning).toBeUndefined();
      const ids = json.data.map((model) => model.id);
      expect(ids).toContain('gpt-5.4-codex');
      for (const image of CODEX_IMAGE_MODELS) {
        expect(ids).toContain(image.id);
      }
    });

    it('degrades to the catalog with a warning when discovery fails', async () => {
      registerSpy(OAuthAuthManager.getInstance(), 'getApiKey').mockRejectedValue(
        new Error('OAuth: Not authenticated for provider')
      );
      const fetchSpy = registerSpy(globalThis, 'fetch');

      const response = await fastify.inject({
        method: 'GET',
        url: '/v0/management/oauth/models?providerId=openai-codex',
      });

      expect(response.statusCode).toBe(200);
      expect(fetchSpy).not.toHaveBeenCalled();

      const json = response.json() as {
        data: Array<{ id: string }>;
        source: string;
        warning?: string;
      };
      expect(json.source).toBe('catalog');
      expect(json.warning).toEqual(expect.stringContaining('static catalog'));
      expect(json.data.map((model) => model.id)).toContain('gpt-image-2');
    });
  });

  describe('Muse Code live model discovery', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('forwards accountId to the Muse backend and reports the live source', async () => {
      const getApiKey = registerSpy(OAuthAuthManager.getInstance(), 'getApiKey').mockResolvedValue(
        'mk_live_abc'
      );
      const fetchSpy = registerSpy(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          object: 'list',
          data: [
            { id: 'muse-spark-1.3', object: 'model' },
            { id: 'muse-spark-1.2', object: 'model' },
          ],
        }),
      } as any);

      const response = await fastify.inject({
        method: 'GET',
        url: '/v0/management/oauth/models?providerId=muse-code&accountId=work',
      });

      expect(response.statusCode).toBe(200);
      expect(getApiKey).toHaveBeenCalledWith('muse-code', 'work');
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0]!;
      expect(url).toBe('https://api.meta.ai/v1/models');
      expect((init?.headers as Record<string, string>)['x-api-version']).toBe('1.0.0');

      const json = response.json() as {
        data: Array<{ id: string }>;
        source: string;
        warning?: string;
      };
      expect(json.source).toBe('muse-backend');
      expect(json.warning).toBeUndefined();
      expect(json.data.map((model) => model.id)).toEqual([
        'muse-spark-1.2',
        'muse-spark-1.3',
      ]);
    });

    it('degrades to the static catalog with a warning when discovery fails', async () => {
      registerSpy(OAuthAuthManager.getInstance(), 'getApiKey').mockRejectedValue(
        new Error('OAuth: Not authenticated for provider')
      );
      const fetchSpy = registerSpy(globalThis, 'fetch');

      const response = await fastify.inject({
        method: 'GET',
        url: '/v0/management/oauth/models?providerId=muse-code',
      });

      expect(response.statusCode).toBe(200);
      expect(fetchSpy).not.toHaveBeenCalled();

      const json = response.json() as {
        data: Array<{ id: string }>;
        source: string;
        warning?: string;
      };
      expect(json.source).toBe('catalog');
      expect(json.warning).toEqual(expect.stringContaining('static catalog'));
      expect(json.data.map((model) => model.id)).toContain('muse-spark-1.3-contributor');
    });
  });
});
