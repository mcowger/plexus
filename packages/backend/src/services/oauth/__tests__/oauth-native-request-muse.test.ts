/**
 * Muse Code subscription dispatch.
 *
 * What must hold:
 *   - `muse-code` resolves through the native OAuth path with the `responses`
 *     wire type (Meta's Model API speaks the Responses API on /v1 —
 *     oh-my-pi seeds muse-code as `openai-responses`);
 *   - preparation targets `https://api.meta.ai/v1/responses` with the
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

const RESPONSES_BODY = {
  model: 'muse-spark-1.3',
  input: [{ role: 'user', content: 'hello' }],
};

describe('muse-code native OAuth dispatch', () => {
  it('is a native provider speaking the responses wire API', () => {
    expect(isNativeOAuthProvider('muse-code')).toBe(true);
    expect(nativeOAuthApiType('muse-code')).toBe('responses');
  });

  it('targets Meta responses with the minted key + api version', () => {
    const prepared = prepareOAuthNativeRequest(
      'muse-code',
      'muse-spark-1.3',
      AUTH,
      RESPONSES_BODY,
      false
    );
    expect(prepared.url).toBe('https://api.meta.ai/v1/responses');
    expect(prepared.headers.Authorization).toBe('Bearer mk_live_abc');
    expect(prepared.headers['x-api-version']).toBe('1.0.0');
    expect(prepared.body).toBe(RESPONSES_BODY);
    expect(prepared.reverseResponseFrame('data: x')).toBe('data: x');
  });

  it('requests event-stream Accept when streaming', () => {
    const prepared = prepareOAuthNativeRequest(
      'muse-code',
      'muse-spark-1.3',
      AUTH,
      RESPONSES_BODY,
      true
    );
    expect(prepared.headers.Accept).toBe('text/event-stream');
  });

  it('rejects apiKey mode', () => {
    expect(() =>
      prepareOAuthNativeRequest(
        'muse-code',
        'muse-spark-1.3',
        { mode: 'apiKey', apiKey: 'sk-ant-x' },
        RESPONSES_BODY,
        false
      )
    ).toThrow(/OAuth token/);
  });
});
