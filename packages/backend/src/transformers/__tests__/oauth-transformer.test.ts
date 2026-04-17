import { afterEach, beforeEach, describe, expect, vi, test } from 'vitest';
import { registerSpy } from '../../../test/test-utils';
import { OAuthAuthManager } from '../../services/oauth-auth-manager';

vi.mock('@mariozechner/pi-ai', async (importOriginal) => {
  const actualPiAi = await importOriginal<typeof import('@mariozechner/pi-ai')>();
  return {
    ...actualPiAi,
    getModel: (provider: any, modelId: string) => ({ id: modelId, provider }),
    complete: async () => ({ ok: true }),
    stream: async () => ({ ok: true }),
  };
});

const { OAuthTransformer } = await import('../oauth/oauth-transformer');

describe('OAuthTransformer', () => {
  beforeEach(() => {
    OAuthAuthManager.resetForTesting();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    OAuthAuthManager.resetForTesting();
  });

  test('skips proxy renaming for claude code agent headers', async () => {
    const authManager = OAuthAuthManager.getInstance();
    registerSpy(authManager, 'getApiKey').mockResolvedValue('sk-ant-oat-test');

    const transformer = new OAuthTransformer();
    const context = {
      tools: [{ name: 'MyTool' }],
      messages: [],
    };

    await transformer.executeRequest(
      context,
      'anthropic' as any,
      'claude-test',
      false,
      {
        clientHeaders: { 'x-app': 'cli' },
      },
      { authMode: 'oauth', accountId: 'test-account' }
    );

    expect(context.tools[0]?.name).toBe('MyTool');
  });

  test('proxies tool names for non-claude code agents', async () => {
    const authManager = OAuthAuthManager.getInstance();
    registerSpy(authManager, 'getApiKey').mockResolvedValue('sk-ant-oat-test');

    const transformer = new OAuthTransformer();
    const context = {
      tools: [{ name: 'MyTool' }],
      messages: [],
    };

    await transformer.executeRequest(
      context,
      'anthropic' as any,
      'claude-test',
      false,
      {},
      { authMode: 'oauth', accountId: 'test-account' }
    );

    expect(context.tools[0]?.name).toBe('proxy_MyTool');
  });

  test('uses direct API key for claude masking without OAuth auth manager', async () => {
    const authManager = OAuthAuthManager.getInstance();
    const getApiKeySpy = registerSpy(authManager, 'getApiKey');

    const transformer = new OAuthTransformer();
    const context = {
      tools: [{ name: 'MyTool' }],
      messages: [],
    };

    await transformer.executeRequest(
      context,
      'anthropic' as any,
      'claude-test',
      false,
      {},
      { authMode: 'apiKey', apiKey: 'sk-ant-api03-direct-test' }
    );

    expect(context.tools[0]?.name).toBe('proxy_MyTool');
    expect(getApiKeySpy).not.toHaveBeenCalled();
  });

  test('throws enriched errors for pi-ai error envelope responses', async () => {
    const transformer = new OAuthTransformer();
    const piAiErrorResponse = {
      type: 'error',
      reason: 'error',
      error: {
        api: 'openai-codex-responses',
        provider: 'openai-codex',
        model: 'gpt-5.4',
        errorMessage: 'You have hit your ChatGPT usage limit (free plan). Try again in ~9725 min.',
      },
    };

    try {
      await transformer.transformResponse(piAiErrorResponse);
      throw new Error('expected transformResponse to fail');
    } catch (error: any) {
      expect(error.message).toContain('usage limit');
      expect(error.piAiResponse).toEqual(piAiErrorResponse);
    }
  });
});
