import { describe, it, expect } from 'vitest';
import {
  resolveBaseUrl,
  buildReasoningOptions,
  buildPiAiModel,
  buildThinkingOptions,
} from '../pi-ai-utils';

// pi-ai is globally mocked in test/vitest.setup.ts

describe('resolveBaseUrl', () => {
  describe('string api_base_url', () => {
    it('preserves URL for openai-completions (no stripping)', () => {
      expect(resolveBaseUrl('https://api.example.com/v1', 'openai-completions')).toBe(
        'https://api.example.com/v1'
      );
    });

    it('preserves URL for openai-responses', () => {
      expect(resolveBaseUrl('https://api.example.com/v1', 'openai-responses')).toBe(
        'https://api.example.com/v1'
      );
    });

    it('preserves URL for google-generative-ai', () => {
      expect(
        resolveBaseUrl('https://generativelanguage.googleapis.com/v1', 'google-generative-ai')
      ).toBe('https://generativelanguage.googleapis.com/v1');
    });

    it('strips trailing /v1 for anthropic-messages', () => {
      expect(resolveBaseUrl('https://api.anthropic.com/v1', 'anthropic-messages')).toBe(
        'https://api.anthropic.com'
      );
    });

    it('strips trailing /v2 for anthropic-messages', () => {
      expect(resolveBaseUrl('https://api.anthropic.com/v2', 'anthropic-messages')).toBe(
        'https://api.anthropic.com'
      );
    });

    it('does not strip /v1/something for anthropic-messages', () => {
      expect(resolveBaseUrl('https://api.anthropic.com/v1/messages', 'anthropic-messages')).toBe(
        'https://api.anthropic.com/v1/messages'
      );
    });

    it('strips trailing slash for non-anthropic', () => {
      expect(resolveBaseUrl('https://api.example.com/v1/', 'openai-completions')).toBe(
        'https://api.example.com/v1'
      );
    });

    it('handles undefined api_base_url', () => {
      expect(resolveBaseUrl(undefined, 'openai-completions')).toBe('');
    });
  });

  describe('record api_base_url', () => {
    it('selects by exact upstream API key', () => {
      const urls = {
        'anthropic-messages': 'https://api.anthropic.com/v1',
        chat: 'https://api.openai.com/v1',
      };
      expect(resolveBaseUrl(urls, 'anthropic-messages')).toBe('https://api.anthropic.com');
    });

    it('falls back to Plexus alias when exact key missing', () => {
      const urls = {
        chat: 'https://api.openai.com/v1',
        messages: 'https://api.anthropic.com/v1',
      };
      // 'anthropic-messages' not in keys, should try alias 'messages'
      expect(resolveBaseUrl(urls, 'anthropic-messages')).toBe('https://api.anthropic.com');
    });

    it('falls back to "default" when alias also missing', () => {
      const urls = {
        default: 'https://default.example.com/v1',
        other: 'https://other.example.com/v1',
      };
      expect(resolveBaseUrl(urls, 'openai-completions')).toBe('https://default.example.com/v1');
    });

    it('falls back to first value when nothing matches', () => {
      const urls = {
        responses: 'https://responses.example.com/v1',
        gemini: 'https://gemini.example.com/v1',
      };
      // 'openai-completions' alias is 'chat', not in keys, no 'default' either
      expect(resolveBaseUrl(urls, 'openai-completions')).toBe('https://responses.example.com/v1');
    });

    it('selects openai-completions via chat alias', () => {
      const urls = {
        chat: 'https://chat.example.com/v1',
        messages: 'https://messages.example.com/v1',
      };
      expect(resolveBaseUrl(urls, 'openai-completions')).toBe('https://chat.example.com/v1');
    });

    it('selects openai-responses via responses alias', () => {
      const urls = {
        responses: 'https://responses.example.com/v1',
      };
      expect(resolveBaseUrl(urls, 'openai-responses')).toBe('https://responses.example.com/v1');
    });

    it('selects google-generative-ai via gemini alias', () => {
      const urls = {
        gemini: 'https://gemini.example.com/v1',
      };
      expect(resolveBaseUrl(urls, 'google-generative-ai')).toBe('https://gemini.example.com/v1');
    });
  });
});

describe('buildReasoningOptions', () => {
  describe('with effort (delegates to buildThinkingOptions)', () => {
    it('anthropic-messages: returns thinkingEnabled and effort fields', () => {
      const opts = buildReasoningOptions('anthropic-messages', 'claude-opus-4-6', 'high');
      expect(opts.thinkingEnabled).toBe(true);
      expect(opts.reasoning).toBe('high');
    });

    it('openai-responses: returns reasoningEffort', () => {
      const opts = buildReasoningOptions('openai-responses', 'gpt-4.1', 'medium');
      expect(opts.reasoningEffort).toBe('medium');
      expect(opts.reasoning).toBe('medium');
    });

    it('google-generative-ai: returns thinking.enabled=true', () => {
      const opts = buildReasoningOptions('google-generative-ai', 'gemini-2.5-pro', 'low');
      expect(opts.thinking?.enabled).toBe(true);
    });
  });

  describe('without effort (explicit disable)', () => {
    it('anthropic-messages: returns { thinkingEnabled: false }', () => {
      const opts = buildReasoningOptions('anthropic-messages', 'claude-opus-4-6');
      expect(opts).toEqual({ thinkingEnabled: false });
    });

    it('google-generative-ai: returns { thinking: { enabled: false } }', () => {
      const opts = buildReasoningOptions('google-generative-ai', 'gemini-2.5-pro');
      expect(opts).toEqual({ thinking: { enabled: false } });
    });

    it('openai-completions: returns {}', () => {
      const opts = buildReasoningOptions('openai-completions', 'gpt-4.1');
      expect(opts).toEqual({});
    });

    it('openai-responses: returns {}', () => {
      const opts = buildReasoningOptions('openai-responses', 'o3');
      expect(opts).toEqual({});
    });

    it('undefined API: returns {}', () => {
      const opts = buildReasoningOptions(undefined, undefined);
      expect(opts).toEqual({});
    });
  });
});

describe('buildPiAiModel', () => {
  it('returns pi-ai model with baseUrl overridden from provider config', () => {
    const model = buildPiAiModel(
      { api_base_url: 'https://api.anthropic.com/v1' },
      'anthropic',
      'claude-opus-4-6',
      'chat'
    );
    // The mock getModel returns api: 'anthropic-messages' for non-openai-codex
    expect(model.id).toBe('claude-opus-4-6');
    expect(model.provider).toBe('anthropic');
    // resolveBaseUrl strips /v1 for anthropic-messages
    expect(model.baseUrl).toBe('https://api.anthropic.com');
  });

  it('returns pi-ai model with baseUrl from record config', () => {
    const model = buildPiAiModel(
      { api_base_url: { 'anthropic-messages': 'https://api.anthropic.com/v1' } },
      'anthropic',
      'claude-sonnet-4',
      'messages'
    );
    expect(model.baseUrl).toBe('https://api.anthropic.com');
  });
});

describe('buildThinkingOptions re-export', () => {
  it('is exported and callable', () => {
    // Verify the re-export from oauth-transformer still works via beta/pi-ai-utils
    const opts = buildThinkingOptions('anthropic-messages', 'claude-opus-4-6', 'medium');
    expect(opts.thinkingEnabled).toBe(true);
  });
});
