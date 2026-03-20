import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import * as actualPiAi from '@mariozechner/pi-ai';
import { OAuthAuthManager } from '../../services/oauth-auth-manager';

mock.module('@mariozechner/pi-ai', () => ({
  ...actualPiAi,
  getModel: (provider: any, modelId: string) => ({ id: modelId, provider }),
  complete: async () => ({ ok: true }),
  stream: async () => ({ ok: true }),
}));

const { OAuthTransformer } = await import('../oauth/oauth-transformer');

describe('OAuthTransformer', () => {
  beforeEach(() => {
    OAuthAuthManager.resetForTesting();
  });

  afterEach(() => {
    mock.restore();
    OAuthAuthManager.resetForTesting();
  });

  test('skips proxy renaming for claude code agent headers', async () => {
    const authManager = OAuthAuthManager.getInstance();
    spyOn(authManager, 'getApiKey').mockResolvedValue('sk-ant-oat-test');

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
    spyOn(authManager, 'getApiKey').mockResolvedValue('sk-ant-oat-test');

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
    const getApiKeySpy = spyOn(authManager, 'getApiKey');

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
