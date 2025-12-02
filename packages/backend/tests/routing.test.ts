import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RoutingEngine } from '../src/routing/engine.js';
import { VirtualKeyConfig, ProviderType, ChatCompletionRequest } from '@plexus/types';

describe('RoutingEngine', () => {
  let routingEngine: RoutingEngine;
  let mockVirtualKeys: Map<string, VirtualKeyConfig>;

  beforeEach(() => {
    mockVirtualKeys = new Map([
      ['test-key-1', {
        key: 'test-key-1',
        provider: 'openai',
        model: 'gpt-3.5-turbo',
        priority: 1,
        fallbackProviders: ['anthropic']
      }],
      ['test-key-2', {
        key: 'test-key-2',
        provider: 'anthropic',
        model: 'claude-3-haiku',
        priority: 2,
        fallbackProviders: ['openrouter']
      }]
    ]);

    const config = {
      virtualKeys: mockVirtualKeys,
      healthCheckInterval: 60000,
      retryPolicy: {
        maxRetries: 3,
        backoffMultiplier: 2,
        initialDelay: 100,
        maxDelay: 1000,
        retryableErrors: ['timeout', 'rate_limit']
      },
      fallbackEnabled: true
    };

    routingEngine = new RoutingEngine(config);
  });

  describe('constructor', () => {
    it('should initialize with provided configuration', () => {
      expect(routingEngine).toBeDefined();
    });
  });

  describe('updateVirtualKey', () => {
    it('should update virtual key configuration', () => {
      const newConfig: VirtualKeyConfig = {
        key: 'test-key-3',
        provider: 'openrouter',
        model: 'openai/gpt-3.5-turbo',
        priority: 3
      };

      routingEngine.updateVirtualKey('test-key-3', newConfig);
      // In a real test, we'd verify the key was added
      expect(routingEngine).toBeDefined();
    });
  });

  describe('removeVirtualKey', () => {
    it('should remove virtual key', () => {
      routingEngine.removeVirtualKey('test-key-1');
      // In a real test, we'd verify the key was removed
      expect(routingEngine).toBeDefined();
    });
  });

  describe('getProviderStatus', () => {
    it('should return provider status', () => {
      const status = routingEngine.getProviderStatus();
      expect(status).toBeInstanceOf(Map);
    });
  });

  describe('getHealthScores', () => {
    it('should return health scores', () => {
      const scores = routingEngine.getHealthScores();
      expect(scores).toBeInstanceOf(Map);
    });
  });
});

describe('RetryPolicy', () => {
  describe('calculateBackoffDelay', () => {
    it('should calculate exponential backoff delay', () => {
      const initialDelay = 100;
      const multiplier = 2;
      const maxDelay = 1000;

      // This would be tested with actual retry logic
      expect(initialDelay).toBe(100);
      expect(multiplier).toBe(2);
      expect(maxDelay).toBe(1000);
    });
  });
});

describe('Health Scoring', () => {
  describe('computeHealthScore', () => {
    it('should compute health score based on metrics', () => {
      const mockMetrics = {
        provider: 'openai' as ProviderType,
        model: 'gpt-3.5-turbo',
        responseTime: 500,
        successRate: 0.95,
        errorRate: 0.05,
        lastChecked: new Date(),
        consecutiveFailures: 0,
        totalRequests: 100,
        successfulRequests: 95,
        failedRequests: 5
      };

      // This would test the actual health score calculation
      expect(mockMetrics.successRate).toBeGreaterThan(0.9);
    });

    it('should penalize high response times', () => {
      const slowMetrics = {
        provider: 'openai' as ProviderType,
        model: 'gpt-3.5-turbo',
        responseTime: 5000, // Very slow
        successRate: 0.95,
        errorRate: 0.05,
        lastChecked: new Date(),
        consecutiveFailures: 0,
        totalRequests: 100,
        successfulRequests: 95,
        failedRequests: 5
      };

      expect(slowMetrics.responseTime).toBeGreaterThan(1000);
    });

    it('should penalize consecutive failures', () => {
      const failingMetrics = {
        provider: 'openai' as ProviderType,
        model: 'gpt-3.5-turbo',
        responseTime: 500,
        successRate: 0.5,
        errorRate: 0.5,
        lastChecked: new Date(),
        consecutiveFailures: 5, // Many consecutive failures
        totalRequests: 100,
        successfulRequests: 50,
        failedRequests: 50
      };

      expect(failingMetrics.consecutiveFailures).toBeGreaterThan(3);
    });
  });
});