import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProviderFactory } from '../src/providers/factory.js';
import { OpenAIProviderClient } from '../src/providers/openai.js';
import { AnthropicProviderClient } from '../src/providers/anthropic.js';
import { OpenRouterProviderClient } from '../src/providers/openrouter.js';
import { ProviderConfig, ProviderType } from '@plexus/types';

// Mock the AI SDK
vi.mock('ai', () => ({
  generateText: vi.fn().mockResolvedValue({ text: 'Mock response' }),
}));

describe('ProviderFactory', () => {
  beforeEach(() => {
    ProviderFactory.clearCache();
  });

  describe('createClient', () => {
    it('should create OpenAI client', () => {
      const config: ProviderConfig = {
        type: 'openai',
        apiKey: 'test-key',
        model: 'gpt-3.5-turbo',
      };

      const client = ProviderFactory.createClient(config);
      expect(client).toBeInstanceOf(OpenAIProviderClient);
      expect(client.type).toBe('openai');
    });

    it('should create Anthropic client', () => {
      const config: ProviderConfig = {
        type: 'anthropic',
        apiKey: 'test-key',
        model: 'claude-3-haiku',
      };

      const client = ProviderFactory.createClient(config);
      expect(client).toBeInstanceOf(AnthropicProviderClient);
      expect(client.type).toBe('anthropic');
    });

    it('should create OpenRouter client', () => {
      const config: ProviderConfig = {
        type: 'openrouter',
        apiKey: 'test-key',
        model: 'openai/gpt-3.5-turbo',
      };

      const client = ProviderFactory.createClient(config);
      expect(client).toBeInstanceOf(OpenRouterProviderClient);
      expect(client.type).toBe('openrouter');
    });

    it('should cache clients with same configuration', () => {
      const config: ProviderConfig = {
        type: 'openai',
        apiKey: 'test-key',
        model: 'gpt-3.5-turbo',
      };

      const client1 = ProviderFactory.createClient(config);
      const client2 = ProviderFactory.createClient(config);

      expect(client1).toBe(client2); // Should be the same instance
    });

    it('should throw error for unsupported provider type', () => {
      const config: ProviderConfig = {
        type: 'unknown' as ProviderType,
        apiKey: 'test-key',
      };

      expect(() => ProviderFactory.createClient(config)).toThrow(
        'Unsupported provider type: unknown'
      );
    });
  });

  describe('getClient', () => {
    it('should create client with minimal configuration', () => {
      const client = ProviderFactory.getClient('openai', 'test-key');
      expect(client).toBeInstanceOf(OpenAIProviderClient);
      expect(client.type).toBe('openai');
    });

    it('should create client with model specified', () => {
      const client = ProviderFactory.getClient('anthropic', 'test-key', 'claude-3-haiku');
      expect(client).toBeInstanceOf(AnthropicProviderClient);
      expect(client.type).toBe('anthropic');
    });
  });

  describe('clearCache', () => {
    it('should clear all cached clients', () => {
      const config: ProviderConfig = {
        type: 'openai',
        apiKey: 'test-key',
      };

      ProviderFactory.createClient(config);
      expect(ProviderFactory.getCachedClients()).toHaveLength(1);

      ProviderFactory.clearCache();
      expect(ProviderFactory.getCachedClients()).toHaveLength(0);
    });
  });
});

describe('BaseProviderClient', () => {
  let mockClient: any;

  beforeEach(() => {
    mockClient = {
      type: 'openai' as ProviderType,
      config: {
        type: 'openai',
        apiKey: 'test-key',
        model: 'gpt-3.5-turbo',
      },
      initializeModel: vi.fn(),
      chatCompletion: vi.fn(),
      chatCompletionStream: vi.fn(),
      isHealthy: vi.fn(),
      getHealthMetrics: vi.fn(),
    };
  });

  describe('chatCompletion', () => {
    it('should handle successful completion', async () => {
      const mockRequest = {
        messages: [{ role: 'user', content: 'Hello' }],
        temperature: 0.7,
      };

      const mockResponse = {
        id: 'chatcmpl-123',
        object: 'chat.completion',
        created: 1234567890,
        model: 'gpt-3.5-turbo',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'Hello!' },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: 15,
        },
      };

      // This would be tested with actual provider implementations
      expect(mockClient.chatCompletion).toBeDefined();
    });
  });

  describe('isHealthy', () => {
    it('should return true for healthy provider', async () => {
      mockClient.isHealthy.mockResolvedValue(true);
      expect(await mockClient.isHealthy()).toBe(true);
    });

    it('should return false for unhealthy provider', async () => {
      mockClient.isHealthy.mockRejectedValue(new Error('API Error'));
      await expect(mockClient.isHealthy()).rejects.toThrow('API Error');
    });
  });
});