import { describe, expect, it } from 'bun:test';
import { getProviderTypes, ProviderConfig } from '../config';

describe('getProviderTypes', () => {
  describe('string URL inference', () => {
    it('returns ["chat"] for OpenAI-compatible URLs', () => {
      const provider: ProviderConfig = {
        api_base_url: 'https://api.openai.com/v1',
        api_key: 'test-key',
        disable_cooldown: false,
        estimateTokens: false,
      };
      expect(getProviderTypes(provider)).toEqual(['chat']);
    });

    it('returns ["chat"] for ollama.com OpenAI-compatible URLs', () => {
      // ollama.com/v1 is OpenAI-compatible, should NOT be 'ollama'
      const provider: ProviderConfig = {
        api_base_url: 'https://ollama.com/v1',
        api_key: 'test-key',
        disable_cooldown: false,
        estimateTokens: false,
      };
      expect(getProviderTypes(provider)).toEqual(['chat']);
    });

    it('returns ["chat"] for localhost:11434/v1 OpenAI-compatible URLs', () => {
      // localhost:11434/v1 is OpenAI-compatible (OpenAI endpoint), should NOT be 'ollama'
      const provider: ProviderConfig = {
        api_base_url: 'http://localhost:11434/v1',
        api_key: 'test-key',
        disable_cooldown: false,
        estimateTokens: false,
      };
      expect(getProviderTypes(provider)).toEqual(['chat']);
    });

    it('returns ["chat"] for any URL containing "ollama" string', () => {
      // String URLs with 'ollama' in them are OpenAI-compatible and should be 'chat'
      const provider: ProviderConfig = {
        api_base_url: 'https://my-ollama-proxy.example.com/v1',
        api_key: 'test-key',
        disable_cooldown: false,
        estimateTokens: false,
      };
      expect(getProviderTypes(provider)).toEqual(['chat']);
    });

    it('returns ["chat"] for port 11434 URLs', () => {
      // Port 11434 doesn't automatically mean native Ollama - it could be OpenAI-compatible
      const provider: ProviderConfig = {
        api_base_url: 'http://192.168.1.100:11434/v1',
        api_key: 'test-key',
        disable_cooldown: false,
        estimateTokens: false,
      };
      expect(getProviderTypes(provider)).toEqual(['chat']);
    });

    it('returns ["messages"] for anthropic.com URLs', () => {
      const provider: ProviderConfig = {
        api_base_url: 'https://api.anthropic.com/v1',
        api_key: 'test-key',
        disable_cooldown: false,
        estimateTokens: false,
      };
      expect(getProviderTypes(provider)).toEqual(['messages']);
    });

    it('returns ["gemini"] for generativelanguage.googleapis.com URLs', () => {
      const provider: ProviderConfig = {
        api_base_url: 'https://generativelanguage.googleapis.com/v1beta',
        api_key: 'test-key',
        disable_cooldown: false,
        estimateTokens: false,
      };
      expect(getProviderTypes(provider)).toEqual(['gemini']);
    });

    it('returns ["oauth"] for oauth:// URLs', () => {
      const provider: ProviderConfig = {
        api_base_url: 'oauth://',
        api_key: 'oauth',
        oauth_provider: 'anthropic',
        disable_cooldown: false,
        estimateTokens: false,
      };
      expect(getProviderTypes(provider)).toEqual(['oauth']);
    });
  });

  describe('object api_base_url inference', () => {
    it('returns ["ollama"] when object has ollama key', () => {
      const provider: ProviderConfig = {
        api_base_url: { ollama: 'http://localhost:11434' },
        api_key: 'test-key',
        disable_cooldown: false,
        estimateTokens: false,
      };
      expect(getProviderTypes(provider)).toEqual(['ollama']);
    });

    it('returns ["ollama", "chat"] when object has both ollama and chat keys', () => {
      const provider: ProviderConfig = {
        api_base_url: {
          ollama: 'http://localhost:11434',
          chat: 'https://api.openai.com/v1',
        },
        api_key: 'test-key',
        disable_cooldown: false,
        estimateTokens: false,
      };
      // Order depends on object key order
      const types = getProviderTypes(provider);
      expect(types).toContain('ollama');
      expect(types).toContain('chat');
    });

    it('returns ["chat"] when object has chat key', () => {
      const provider: ProviderConfig = {
        api_base_url: { chat: 'https://api.openai.com/v1' },
        api_key: 'test-key',
        disable_cooldown: false,
        estimateTokens: false,
      };
      expect(getProviderTypes(provider)).toEqual(['chat']);
    });

    it('returns ["messages"] when object has messages key', () => {
      const provider: ProviderConfig = {
        api_base_url: { messages: 'https://api.anthropic.com/v1' },
        api_key: 'test-key',
        disable_cooldown: false,
        estimateTokens: false,
      };
      expect(getProviderTypes(provider)).toEqual(['messages']);
    });

    it('filters out empty string values', () => {
      const provider: ProviderConfig = {
        api_base_url: { ollama: '', chat: 'https://api.openai.com/v1' },
        api_key: 'test-key',
        disable_cooldown: false,
        estimateTokens: false,
      };
      expect(getProviderTypes(provider)).toEqual(['chat']);
    });
  });
});
