/**
 * Muse Code subscription dispatch.
 *
 * What must hold:
 *   - `muse-code` resolves through the native OAuth path with the `chat`
 *     wire type (Meta's Model API speaks OpenAI Chat Completions on /v1);
 *   - preparation targets `https://api.meta.ai/v1/chat/completions` with the
 *     subscription-minted key as Bearer plus `x-api-version: 1.0.0`, passing
 *     the standard-path body through untouched (no masking, no renames);
 *   - apiKey mode is rejected — only the minted OAuth key may be used.
 */

import { describe, expect, it } from 'vitest';
import {
  isNativeOAuthProvider,
  nativeOAuthApiType,
  prepareOAuthNativeRequest,
} from '../oauth-native-request';

const AUTH = { mode: 'oauth', token: 'mk_live_abc' } as const;

const CHAT_BODY = {
  model: 'muse-spark-1.3',
  messages: [{ role: 'user', content: 'hello' }],
};

describe('muse-code native OAuth dispatch', () => {
  it('is a native provider speaking the chat wire API', () => {
    expect(isNativeOAuthProvider('muse-code')).toBe(true);
    expect(nativeOAuthApiType('muse-code')).toBe('chat');
  });

  it('targets Meta chat completions with the minted key + api version', () => {
    const prepared = prepareOAuthNativeRequest('muse-code', 'muse-spark-1.3', AUTH, CHAT_BODY, false);
    expect(prepared.url).toBe('https://api.meta.ai/v1/chat/completions');
    expect(prepared.headers.Authorization).toBe('Bearer mk_live_abc');
    expect(prepared.headers['x-api-version']).toBe('1.0.0');
    expect(prepared.body).toBe(CHAT_BODY);
    expect(prepared.reverseResponseFrame('data: x')).toBe('data: x');
  });

  it('requests event-stream Accept when streaming', () => {
    const prepared = prepareOAuthNativeRequest('muse-code', 'muse-spark-1.3', AUTH, CHAT_BODY, true);
    expect(prepared.headers.Accept).toBe('text/event-stream');
  });

  it('rejects apiKey mode', () => {
    expect(() =>
      prepareOAuthNativeRequest(
        'muse-code',
        'muse-spark-1.3',
        { mode: 'apiKey', apiKey: 'sk-ant-x' },
        CHAT_BODY,
        false
      )
    ).toThrow(/OAuth token/);
  });
});
