/**
 * Codex OAuth header reuse: `buildCodexOAuthHeaders` + `prepareCodexImagesDispatch`.
 *
 * The Codex images endpoints (`POST /backend-api/codex/images/generations`,
 * `/images/edits`) live on the same ChatGPT backend as the Responses endpoint
 * and authenticate with the same identity: `Authorization: Bearer`, the
 * `chatgpt-account-id` claim from the token, and the Codex CLI fingerprint
 * (`originator`, `Version`, `User-Agent`).
 *
 * What must hold:
 *   - the images dispatch targets `<base>/codex` so callers append
 *     `/images/generations` or `/images/edits`;
 *   - the images call sends the shared auth headers plus `Accept: application/json`
 *     and NOTHING else — in particular no `OpenAI-Beta`, which is a Responses
 *     flag the Codex image client does not send;
 *   - a token with no `chatgpt_account_id` claim omits the account header;
 *   - extracting the shared builder does not change the Responses request.
 */

import { afterEach, beforeEach, describe, expect, it, jest, test } from 'bun:test';

import { registerSpy } from '../../../../test/test-utils';
import { CodexVersionService } from '../codex-version-service';
import { OAuthAuthManager } from '../oauth-auth-manager';
import {
  buildCodexOAuthHeaders,
  prepareCodexImagesDispatch,
  prepareOAuthNativeRequest,
} from '../oauth-native-request';

const ACCOUNT_ID = 'acc_images_98765';

/** A fake Codex OAuth JWT whose payload carries the given auth claims. */
function codexToken(auth: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': auth })).toString(
    'base64url'
  );
  return `${header}.${payload}.sig`;
}

const CODEX_TOKEN = codexToken({ chatgpt_account_id: ACCOUNT_ID });
const CODEX_TOKEN_NO_ACCOUNT = codexToken({ chatgpt_plan_type: 'pro' });

const MODEL_ID = 'gpt-5-codex';

describe('buildCodexOAuthHeaders', () => {
  beforeEach(() => {
    CodexVersionService.resetForTesting();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    CodexVersionService.resetForTesting();
  });

  it('builds the shared Codex auth + fingerprint headers', () => {
    const codex = CodexVersionService.getInstance();
    expect(buildCodexOAuthHeaders(CODEX_TOKEN)).toEqual({
      Authorization: `Bearer ${CODEX_TOKEN}`,
      'chatgpt-account-id': ACCOUNT_ID,
      originator: 'codex_cli_rs',
      Version: codex.getVersion(),
      'User-Agent': codex.getUserAgent(),
    });
  });

  it('omits chatgpt-account-id when the token carries no account claim', () => {
    expect(buildCodexOAuthHeaders(CODEX_TOKEN_NO_ACCOUNT)).not.toHaveProperty('chatgpt-account-id');
  });

  it('carries no Responses-only flags', () => {
    expect(buildCodexOAuthHeaders(CODEX_TOKEN)).not.toHaveProperty('OpenAI-Beta');
  });
});

describe('prepareCodexImagesDispatch', () => {
  let getApiKey: ReturnType<typeof registerSpy>;

  beforeEach(() => {
    CodexVersionService.resetForTesting();
    OAuthAuthManager.resetForTesting();
    getApiKey = registerSpy(OAuthAuthManager.getInstance(), 'getApiKey').mockResolvedValue(
      CODEX_TOKEN
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
    OAuthAuthManager.resetForTesting();
    CodexVersionService.resetForTesting();
  });

  it('targets the Codex images base URL', async () => {
    const { baseUrl } = await prepareCodexImagesDispatch({ modelId: MODEL_ID });
    expect(baseUrl).toBe('https://chatgpt.com/backend-api/codex');
    expect(`${baseUrl}/images/generations`).toBe(
      'https://chatgpt.com/backend-api/codex/images/generations'
    );
  });

  it('sends Accept plus the shared Codex OAuth headers and nothing else', async () => {
    const codex = CodexVersionService.getInstance();
    const { headers } = await prepareCodexImagesDispatch({ modelId: MODEL_ID });
    expect(headers).toEqual({
      Accept: 'application/json',
      Authorization: `Bearer ${CODEX_TOKEN}`,
      'chatgpt-account-id': ACCOUNT_ID,
      originator: 'codex_cli_rs',
      Version: codex.getVersion(),
      'User-Agent': codex.getUserAgent(),
    });
  });

  it('does not send the Responses-only OpenAI-Beta flag', async () => {
    const { headers } = await prepareCodexImagesDispatch({ modelId: MODEL_ID });
    expect(headers).not.toHaveProperty('OpenAI-Beta');
  });

  it('omits chatgpt-account-id when the token carries no account claim', async () => {
    getApiKey.mockResolvedValue(CODEX_TOKEN_NO_ACCOUNT);
    const { headers } = await prepareCodexImagesDispatch({ modelId: MODEL_ID });
    expect(headers).not.toHaveProperty('chatgpt-account-id');
    expect(headers['Authorization']).toBe(`Bearer ${CODEX_TOKEN_NO_ACCOUNT}`);
  });

  it('resolves the token for the configured Codex OAuth account', async () => {
    await prepareCodexImagesDispatch({ modelId: MODEL_ID, oauthAccountId: 'work-account' });
    expect(getApiKey).toHaveBeenCalledTimes(1);
    expect(getApiKey).toHaveBeenCalledWith('openai-codex', 'work-account');
  });

  it('propagates an unauthenticated provider error', async () => {
    getApiKey.mockRejectedValue(new Error("OAuth: Not authenticated for provider 'openai-codex'."));
    await expect(prepareCodexImagesDispatch({ modelId: MODEL_ID })).rejects.toThrow(
      'Not authenticated'
    );
  });
});

describe('prepareOAuthNativeRequest — Codex Responses headers (unchanged)', () => {
  const AUTH = { mode: 'oauth', token: CODEX_TOKEN } as const;

  beforeEach(() => {
    CodexVersionService.resetForTesting();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    CodexVersionService.resetForTesting();
  });

  it('keeps the streaming Responses header set intact', () => {
    const codex = CodexVersionService.getInstance();
    const prepared = prepareOAuthNativeRequest(
      'openai-codex',
      MODEL_ID,
      AUTH,
      { model: MODEL_ID, input: [], prompt_cache_key: 'sess-images-1' },
      true,
      { codexPassthrough: true }
    );
    expect(prepared.url).toBe('https://chatgpt.com/backend-api/codex/responses');
    expect(prepared.headers).toEqual({
      'Content-Type': 'application/json',
      accept: 'text/event-stream',
      Authorization: `Bearer ${CODEX_TOKEN}`,
      'chatgpt-account-id': ACCOUNT_ID,
      originator: 'codex_cli_rs',
      'OpenAI-Beta': 'responses=experimental',
      Version: codex.getVersion(),
      'User-Agent': codex.getUserAgent(),
      'session-id': 'sess-images-1',
      'x-client-request-id': 'sess-images-1',
    });
  });

  it('keeps the non-streaming, session-less Responses header set intact', () => {
    const codex = CodexVersionService.getInstance();
    const prepared = prepareOAuthNativeRequest(
      'openai-codex',
      MODEL_ID,
      AUTH,
      { model: MODEL_ID, input: [] },
      false,
      { codexPassthrough: true }
    );
    expect(prepared.headers).toEqual({
      'Content-Type': 'application/json',
      accept: 'application/json',
      Authorization: `Bearer ${CODEX_TOKEN}`,
      'chatgpt-account-id': ACCOUNT_ID,
      originator: 'codex_cli_rs',
      'OpenAI-Beta': 'responses=experimental',
      Version: codex.getVersion(),
      'User-Agent': codex.getUserAgent(),
    });
  });
});
