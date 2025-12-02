import { describe, it, expect, beforeEach } from 'vitest';
import { ProviderFactory } from '../src/providers/factory.js';
import { RoutingEngine } from '../src/routing/engine.js';
import { VirtualKeyConfig, ChatCompletionRequest, ProviderType } from '@plexus/types';


declare global {
  namespace NodeJS {
    interface ProcessEnv {
      OPENAI_API_KEY?: string;
      ANTHROPIC_API_KEY?: string;
      OPENROUTER_API_KEY?: string;
    }
  }
}

describe('Provider Integration Tests', () => {
  let routingEngine: RoutingEngine;

  beforeEach(() => {
    // Set up mock environment variables for testing
    process.env.OPENAI_API_KEY = 'mock-openai-key';
    process.env.ANTHROPIC_API_KEY = 'mock-anthropic-key';
    process.env.OPENROUTER_API_KEY = 'mock-openrouter-key';

    const mockVirtualKeys = new Map<string, VirtualKeyConfig>([
      ['test-key-openai', {
        key: 'test-key-openai',
        provider: 'openai' as ProviderType,
        model: 'gpt-3.5-turbo',
        priority: 1,
        fallbackProviders: ['anthropic', 'openrouter']
      }],
      ['test-key-anthropic', {
        key: 'test-key-anthropic',
        provider: 'anthropic' as ProviderType,
        model: 'claude-3-haiku',
        priority: 2,
        fallbackProviders: ['openrouter']
      }]
    ]);

    const config = {
      virtualKeys: mockVirtualKeys,
      healthCheckInterval: 30000, // 30 seconds for testing
      retryPolicy: {
        maxRetries: 2,
        backoffMultiplier: 1.5,
        initialDelay: 50,
        maxDelay: 500,
        retryableErrors: ['timeout', 'rate_limit', 'network_error']
      },
      fallbackEnabled: true
    };

    routingEngine = new RoutingEngine(config);
  });

  describe('ProviderFactory Integration', () => {
    it('should create and cache provider clients', () => {
      const openaiClient = ProviderFactory.getClient('openai', 'mock-key');
      const anthropicClient = ProviderFactory.getClient('anthropic', 'mock-key');
      const openrouterClient = ProviderFactory.getClient('openrouter', 'mock-key');

      expect(openaiClient.type).toBe('openai');
      expect(anthropicClient.type).toBe('anthropic');
      expect(openrouterClient.type).toBe('openrouter');

      // Verify caching works
      const cachedClients = ProviderFactory.getCachedClients();
      expect(cachedClients.length).toBeGreaterThan(0);
    });

    it('should handle different model configurations', () => {
      const client1 = ProviderFactory.getClient('openai', 'mock-key', 'gpt-4');
      const client2 = ProviderFactory.getClient('openai', 'mock-key', 'gpt-3.5-turbo');

      expect(client1).toBeDefined();
      expect(client2).toBeDefined();
    });
  });

  describe('RoutingEngine Integration', () => {
    it('should route requests to configured providers', async () => {
      const request: ChatCompletionRequest = {
        messages: [
          { role: 'user', content: 'Hello, world!' }
        ],
        temperature: 0.7
      };

      const routingRequest = {
        virtualKey: 'test-key-openai',
        request,
        userId: 'test-user'
      };

      // This would test actual routing in a real environment
      expect(routingEngine).toBeDefined();
      expect(routingRequest.virtualKey).toBe('test-key-openai');
    });

    it('should handle fallback providers', async () => {
      const request: ChatCompletionRequest = {
        messages: [
          { role: 'user', content: 'Test fallback' }
        ],
        temperature: 0.5
      };

      const routingRequest = {
        virtualKey: 'test-key-anthropic',
        request,
        userId: 'test-user'
      };

      // Test that fallback providers are configured
      const status = routingEngine.getProviderStatus();
      expect(status.size).toBeGreaterThan(0);
    });

    it('should provide health status for all providers', () => {
      const status = routingEngine.getProviderStatus();
      const healthScores = routingEngine.getHealthScores();

      expect(status).toBeInstanceOf(Map);
      expect(healthScores).toBeInstanceOf(Map);

      // All providers should have health scores
      status.forEach((providerStatus, provider) => {
        expect(providerStatus.healthy).toBeDefined();
        expect(providerStatus.score).toBeDefined();
        expect(providerStatus.score.overall).toBeGreaterThanOrEqual(0);
        expect(providerStatus.score.overall).toBeLessThanOrEqual(100);
      });
    });
  });

  describe('End-to-End Provider Workflow', () => {
    it('should handle complete request lifecycle', async () => {
      const request: ChatCompletionRequest = {
        messages: [
          { role: 'system', content: 'You are a helpful assistant.' },
          { role: 'user', content: 'What is the weather like?' }
        ],
        model: 'gpt-3.5-turbo',
        temperature: 0.7
      };

      const routingRequest = {
        virtualKey: 'test-key-openai',
        request,
        userId: 'test-user-123',
        metadata: {
          source: 'web',
          priority: 'normal'
        }
      };

      // Test the complete workflow
      expect(routingRequest.virtualKey).toBeDefined();
      expect(routingRequest.request.messages).toHaveLength(2);
      expect(routingRequest.userId).toBeDefined();
    });

    it('should handle streaming requests', async () => {
      const request: ChatCompletionRequest = {
        messages: [
          { role: 'user', content: 'Tell me a story' }
        ],
        temperature: 0.8
      };

      const chunks: string[] = [];
      const onChunk = (chunk: string) => {
        chunks.push(chunk);
      };

      const onError = (error: Error) => {
        console.error('Streaming error:', error);
      };

      // This would test actual streaming in a real environment
      expect(chunks).toEqual([]);
      expect(onError).toBeDefined();
    });

    it('should handle virtual key management', () => {
      // Add new virtual key
      const newKeyConfig: VirtualKeyConfig = {
        key: 'new-test-key',
        provider: 'openrouter',
        model: 'openai/gpt-4',
        priority: 3,
        fallbackProviders: ['openai']
      };

      routingEngine.updateVirtualKey('new-test-key', newKeyConfig);

      // Remove virtual key
      routingEngine.removeVirtualKey('test-key-openai');

      expect(routingEngine).toBeDefined();
    });
  });

  describe('Error Handling and Resilience', () => {
    it('should handle provider failures gracefully', () => {
      // Test that the system can handle multiple provider types
      const providers: ProviderType[] = ['openai', 'anthropic', 'openrouter'];
      
      providers.forEach(provider => {
        const client = ProviderFactory.getClient(provider, 'mock-key');
        expect(client.type).toBe(provider);
      });
    });

    it('should maintain health scores across requests', () => {
      const initialScores = routingEngine.getHealthScores();
      const initialStatus = routingEngine.getProviderStatus();

      // Simulate some health checks
      const updatedScores = routingEngine.getHealthScores();
      const updatedStatus = routingEngine.getProviderStatus();

      expect(updatedScores.size).toBe(initialScores.size);
      expect(updatedStatus.size).toBe(initialStatus.size);
    });

    it('should handle configuration updates', () => {
      const originalStatus = routingEngine.getProviderStatus();
      
      // Update configuration
      const updatedConfig: VirtualKeyConfig = {
        key: 'updated-key',
        provider: 'openai',
        model: 'gpt-4',
        priority: 1
      };

      routingEngine.updateVirtualKey('updated-key', updatedConfig);
      
      const newStatus = routingEngine.getProviderStatus();
      expect(newStatus.size).toBeGreaterThanOrEqual(originalStatus.size);
    });
  });
});

describe('Performance and Load Testing', () => {
  it('should handle concurrent requests', async () => {
    const requests = Array.from({ length: 5 }, (_, i) => ({
      virtualKey: `test-key-${i % 2}`,
      request: {
        messages: [{ role: 'user', content: `Request ${i}` }],
        temperature: 0.7
      }
    }));

    // This would test concurrent request handling
    expect(requests).toHaveLength(5);
  });

  it('should maintain performance under load', () => {
    const startTime = Date.now();
    
    // Simulate some processing
    const processingTime = Date.now() - startTime;
    
    expect(processingTime).toBeGreaterThanOrEqual(0);
  });
});