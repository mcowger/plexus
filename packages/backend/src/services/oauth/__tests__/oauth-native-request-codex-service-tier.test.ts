import { beforeEach, describe, expect, it } from 'vitest';
import { CodexVersionService } from '../codex-version-service';
import { prepareOAuthNativeRequest } from '../oauth-native-request';

function codexToken(): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: 'acc_tier_1' } })
  ).toString('base64url');
  return `${header}.${payload}.sig`;
}

const AUTH = { mode: 'oauth', token: codexToken() } as const;
const MODEL_ID = 'gpt-5-codex';

describe('prepareOAuthNativeRequest — Codex service_tier suppression', () => {
  beforeEach(() => {
    CodexVersionService.resetForTesting();
  });

  it("strips service_tier 'flex' on the CLI passthrough path", () => {
    const prepared = prepareOAuthNativeRequest(
      'openai-codex',
      MODEL_ID,
      AUTH,
      { model: MODEL_ID, input: [], service_tier: 'flex' },
      true,
      { codexPassthrough: true }
    );
    expect(prepared.body).not.toHaveProperty('service_tier');
  });

  it("strips service_tier 'flex' on the adorned (non-CLI) path", () => {
    const prepared = prepareOAuthNativeRequest(
      'openai-codex',
      MODEL_ID,
      AUTH,
      { model: MODEL_ID, input: [], service_tier: 'flex' },
      true,
      { codexPassthrough: false }
    );
    expect(prepared.body).not.toHaveProperty('service_tier');
  });

  it("preserves service_tier 'priority' (supported by the Codex backend)", () => {
    for (const passthrough of [true, false]) {
      const prepared = prepareOAuthNativeRequest(
        'openai-codex',
        MODEL_ID,
        AUTH,
        { model: MODEL_ID, input: [], service_tier: 'priority' },
        true,
        { codexPassthrough: passthrough }
      );
      expect(prepared.body.service_tier).toBe('priority');
    }
  });
});
