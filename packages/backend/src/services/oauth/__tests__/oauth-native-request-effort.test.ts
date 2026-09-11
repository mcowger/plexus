import { describe, expect, it } from 'vitest';
import { prepareOAuthNativeRequest } from '../oauth-native-request';

const AUTH_OAUTH = { mode: 'oauth', token: 'sk-ant-oat-test-token' } as const;
const AUTH_MASKING = { mode: 'apiKey', apiKey: 'sk-ant-api03-test-key' } as const;

describe('prepareOAuthNativeRequest — Claude OAuth effort clamping', () => {
  describe('claude-opus-5 (cannot disable thinking)', () => {
    it('clamps output_config.effort: minimal to low', () => {
      const nativeBody = {
        model: 'claude-opus-5',
        max_tokens: 64,
        messages: [{ role: 'user', content: 'hello' }],
        thinking: { type: 'adaptive' },
        output_config: { effort: 'minimal' },
      };
      const prepared = prepareOAuthNativeRequest(
        'anthropic',
        'claude-opus-5',
        AUTH_OAUTH,
        nativeBody,
        false
      );
      expect(prepared.body.output_config).toEqual({ effort: 'low' });
      expect(prepared.body.thinking).toEqual({ type: 'adaptive' });
    });

    it('clamps thinking: disabled to adaptive with effort: low', () => {
      const nativeBody = {
        model: 'claude-opus-5',
        max_tokens: 64,
        messages: [{ role: 'user', content: 'hello' }],
        thinking: { type: 'disabled' },
      };
      const prepared = prepareOAuthNativeRequest(
        'anthropic',
        'claude-opus-5',
        AUTH_OAUTH,
        nativeBody,
        false
      );
      expect(prepared.body.thinking).toEqual({ type: 'adaptive' });
      expect(prepared.body.output_config).toEqual({ effort: 'low' });
    });

    it('clamps output_config.effort: off to adaptive with effort: low', () => {
      const nativeBody = {
        model: 'claude-opus-5',
        max_tokens: 64,
        messages: [{ role: 'user', content: 'hello' }],
        output_config: { effort: 'off' },
      };
      const prepared = prepareOAuthNativeRequest(
        'anthropic',
        'claude-opus-5',
        AUTH_OAUTH,
        nativeBody,
        false
      );
      expect(prepared.body.thinking).toEqual({ type: 'adaptive' });
      expect(prepared.body.output_config).toEqual({ effort: 'low' });
    });

    it('preserves valid effort levels like high or max', () => {
      const nativeBody = {
        model: 'claude-opus-5',
        max_tokens: 64,
        messages: [{ role: 'user', content: 'hello' }],
        thinking: { type: 'adaptive' },
        output_config: { effort: 'max' },
      };
      const prepared = prepareOAuthNativeRequest(
        'anthropic',
        'claude-opus-5',
        AUTH_OAUTH,
        nativeBody,
        false
      );
      expect(prepared.body.output_config).toEqual({ effort: 'max' });
    });
  });

  describe('claude-sonnet-4-6 (supports disable)', () => {
    it('clamps output_config.effort: minimal to low', () => {
      const nativeBody = {
        model: 'claude-sonnet-4-6',
        max_tokens: 64,
        messages: [{ role: 'user', content: 'hello' }],
        thinking: { type: 'adaptive' },
        output_config: { effort: 'minimal' },
      };
      const prepared = prepareOAuthNativeRequest(
        'anthropic',
        'claude-sonnet-4-6',
        AUTH_OAUTH,
        nativeBody,
        false
      );
      expect(prepared.body.output_config).toEqual({ effort: 'low' });
    });

    it('maps output_config.effort: off to thinking: disabled and removes output_config.effort', () => {
      const nativeBody = {
        model: 'claude-sonnet-4-6',
        max_tokens: 64,
        messages: [{ role: 'user', content: 'hello' }],
        output_config: { effort: 'off' },
      };
      const prepared = prepareOAuthNativeRequest(
        'anthropic',
        'claude-sonnet-4-6',
        AUTH_OAUTH,
        nativeBody,
        false
      );
      expect(prepared.body.thinking).toEqual({ type: 'disabled' });
      expect(prepared.body.output_config).toBeUndefined();
    });
  });

  describe('Claude masking API key route (useClaudeMasking)', () => {
    it('applies effort clamping on the Claude masking route', () => {
      const nativeBody = {
        model: 'claude-opus-5',
        max_tokens: 64,
        messages: [{ role: 'user', content: 'hello' }],
        output_config: { effort: 'minimal' },
      };
      const prepared = prepareOAuthNativeRequest(
        'anthropic',
        'claude-opus-5',
        AUTH_MASKING,
        nativeBody,
        false
      );
      expect(prepared.body.output_config).toEqual({ effort: 'low' });
    });
  });
});
