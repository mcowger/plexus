import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import superjson from 'superjson';
import { handleAiSdkEndpoint, registerV1AiSdkRoutes } from '../ai-sdk.js';
import { selectProvider } from '../../selector.js';
import { ProviderFactory } from '../../../providers/factory.js';
import { generateText } from 'ai';
import { logger } from '../../../utils/logger.js';

// Mock dependencies
vi.mock('../../selector.js', () => ({
  selectProvider: vi.fn(),
}));

vi.mock('../../../providers/factory.js', () => ({
  ProviderFactory: {
    createClient: vi.fn(),
  },
}));

vi.mock('ai', () => ({
  generateText: vi.fn(),
}));

vi.mock('../../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('AI SDK Endpoint', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    app = new Hono();
    registerV1AiSdkRoutes(app);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('handleAiSdkEndpoint', () => {
    it('should process a valid AI SDK request with string model identifier', async () => {
      // Mock provider selection
      const mockProviderConfig = {
        type: 'openai' as const,
        apiKey: 'sk-test-key',
      };

      const mockModel = {
        modelId: 'gpt-4',
        provider: 'openai',
      };

      vi.mocked(selectProvider).mockReturnValue({
        provider: mockProviderConfig,
        canonicalModelSlug: 'gpt-4',
      });

      const mockProviderClient = {
        getModel: vi.fn().mockReturnValue(mockModel),
      };

      vi.mocked(ProviderFactory.createClient).mockReturnValue(mockProviderClient as any);

      // Mock generateText result
      const mockGenerateTextResult = {
        text: 'Hello, world!',
        finishReason: 'stop',
        usage: {
          promptTokens: 10,
          completionTokens: 5,
          totalTokens: 15,
        },
      };

      vi.mocked(generateText).mockResolvedValue(mockGenerateTextResult as any);

      // Create request with string model identifier
      const requestData = {
        model: 'gpt-4',
        prompt: [
          {
            role: 'user',
            content: [{ type: 'text', text: 'Hello' }],
          },
        ],
        temperature: 0.7,
      };

      const serializedRequest = superjson.serialize(requestData);

      // Make request to the endpoint
      const req = new Request('http://localhost/v1/ai-sdk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(serializedRequest),
      });

      const res = await app.fetch(req);
      const responseBody = await res.json();

      expect(res.status).toBe(200);
      expect(responseBody).toBeDefined();
      
      // Deserialize the response
      const deserializedResponse = superjson.deserialize(responseBody as any);
      expect(deserializedResponse).toEqual(mockGenerateTextResult);

      // Verify selectProvider was called
      expect(selectProvider).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'gpt-4',
        })
      );

      // Verify ProviderFactory.createClient was called
      expect(ProviderFactory.createClient).toHaveBeenCalledWith(mockProviderConfig);

      // Verify getModel was called
      expect(mockProviderClient.getModel).toHaveBeenCalledWith('gpt-4');

      // Verify generateText was called with the modified request
      expect(generateText).toHaveBeenCalledWith(
        expect.objectContaining({
          model: mockModel,
          prompt: requestData.prompt,
          temperature: 0.7,
        })
      );
    });

    it('should process a valid AI SDK request with object model identifier', async () => {
      // Mock provider selection
      const mockProviderConfig = {
        type: 'openai' as const,
        apiKey: 'sk-test-key',
      };

      const mockModel = {
        modelId: 'gpt-4',
        provider: 'openai',
      };

      vi.mocked(selectProvider).mockReturnValue({
        provider: mockProviderConfig,
        canonicalModelSlug: 'gpt-4',
      });

      const mockProviderClient = {
        getModel: vi.fn().mockReturnValue(mockModel),
      };

      vi.mocked(ProviderFactory.createClient).mockReturnValue(mockProviderClient as any);

      // Mock generateText result
      const mockGenerateTextResult = {
        text: 'Response text',
        finishReason: 'stop',
        usage: {
          promptTokens: 5,
          completionTokens: 10,
          totalTokens: 15,
        },
      };

      vi.mocked(generateText).mockResolvedValue(mockGenerateTextResult as any);

      // Create request with object model identifier
      const requestData = {
        model: {
          modelId: 'gpt-4',
          provider: 'openai',
        },
        prompt: [
          {
            role: 'user',
            content: [{ type: 'text', text: 'Test prompt' }],
          },
        ],
      };

      const serializedRequest = superjson.serialize(requestData);

      // Make request to the endpoint
      const req = new Request('http://localhost/v1/ai-sdk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(serializedRequest),
      });

      const res = await app.fetch(req);
      const responseBody = await res.json();

      expect(res.status).toBe(200);
      expect(responseBody).toBeDefined();

      // Deserialize the response
      const deserializedResponse = superjson.deserialize(responseBody as any);
      expect(deserializedResponse).toEqual(mockGenerateTextResult);

      // Verify selectProvider was called with the extracted model ID
      expect(selectProvider).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'gpt-4',
        })
      );
    });

    it('should handle requests with all generateText parameters', async () => {
      // Mock provider selection
      const mockProviderConfig = {
        type: 'anthropic' as const,
        apiKey: 'sk-ant-key',
      };

      const mockModel = {
        modelId: 'claude-3-opus-20240229',
        provider: 'anthropic',
      };

      vi.mocked(selectProvider).mockReturnValue({
        provider: mockProviderConfig,
        canonicalModelSlug: 'claude-3-opus-20240229',
      });

      const mockProviderClient = {
        getModel: vi.fn().mockReturnValue(mockModel),
      };

      vi.mocked(ProviderFactory.createClient).mockReturnValue(mockProviderClient as any);

      // Mock generateText result
      const mockGenerateTextResult = {
        text: 'Complex response',
        finishReason: 'stop',
        usage: {
          promptTokens: 20,
          completionTokens: 30,
          totalTokens: 50,
        },
      };

      vi.mocked(generateText).mockResolvedValue(mockGenerateTextResult as any);

      // Create comprehensive request
      const requestData = {
        model: 'claude-3-opus',
        prompt: [
          {
            role: 'system',
            content: 'You are a helpful assistant.',
          },
          {
            role: 'user',
            content: [{ type: 'text', text: 'Complex query' }],
          },
        ],
        temperature: 0.8,
        maxOutputTokens: 1000,
        topP: 0.95,
        presencePenalty: 0.1,
        frequencyPenalty: 0.2,
        seed: 42,
      };

      const serializedRequest = superjson.serialize(requestData);

      // Make request to the endpoint
      const req = new Request('http://localhost/v1/ai-sdk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(serializedRequest),
      });

      const res = await app.fetch(req);
      const responseBody = await res.json();

      expect(res.status).toBe(200);

      // Verify generateText was called with all parameters
      expect(generateText).toHaveBeenCalledWith(
        expect.objectContaining({
          model: mockModel,
          prompt: requestData.prompt,
          temperature: 0.8,
          maxOutputTokens: 1000,
          topP: 0.95,
          presencePenalty: 0.1,
          frequencyPenalty: 0.2,
          seed: 42,
        })
      );
    });

    it('should return error when request format is invalid', async () => {
      const invalidRequest = superjson.serialize(null);

      const req = new Request('http://localhost/v1/ai-sdk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(invalidRequest),
      });

      const res = await app.fetch(req);
      const responseBody = await res.json();

      expect(res.status).toBe(500);
      expect(responseBody).toHaveProperty('error');
      expect(responseBody.error).toContain('Invalid request format');
    });

    it('should return error when model is not specified', async () => {
      const requestData = {
        prompt: [
          {
            role: 'user',
            content: [{ type: 'text', text: 'Hello' }],
          },
        ],
      };

      const serializedRequest = superjson.serialize(requestData);

      const req = new Request('http://localhost/v1/ai-sdk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(serializedRequest),
      });

      const res = await app.fetch(req);
      const responseBody = await res.json();

      expect(res.status).toBe(500);
      expect(responseBody).toHaveProperty('error');
      expect(responseBody.error).toContain('Invalid request format');
    });

    it('should return error when model identifier cannot be determined', async () => {
      const requestData = {
        model: { someOtherProperty: 'value' }, // Missing modelId
        prompt: [
          {
            role: 'user',
            content: [{ type: 'text', text: 'Hello' }],
          },
        ],
      };

      const serializedRequest = superjson.serialize(requestData);

      const req = new Request('http://localhost/v1/ai-sdk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(serializedRequest),
      });

      const res = await app.fetch(req);
      const responseBody = await res.json();

      expect(res.status).toBe(500);
      expect(responseBody).toHaveProperty('error');
      expect(responseBody.error).toContain('Invalid request format');
    });

    it('should return error when selectProvider throws', async () => {
      vi.mocked(selectProvider).mockImplementation(() => {
        throw new Error('Provider selection failed');
      });

      const requestData = {
        model: 'non-existent-model',
        prompt: [
          {
            role: 'user',
            content: [{ type: 'text', text: 'Hello' }],
          },
        ],
      };

      const serializedRequest = superjson.serialize(requestData);

      const req = new Request('http://localhost/v1/ai-sdk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(serializedRequest),
      });

      const res = await app.fetch(req);
      const responseBody = await res.json();

      expect(res.status).toBe(500);
      expect(responseBody).toHaveProperty('error');
      expect(responseBody.error).toContain('Provider selection failed');
      expect(logger.error).toHaveBeenCalled();
    });

    it('should return error when generateText throws', async () => {
      // Mock provider selection
      const mockProviderConfig = {
        type: 'openai' as const,
        apiKey: 'sk-test-key',
      };

      const mockModel = {
        modelId: 'gpt-4',
        provider: 'openai',
      };

      vi.mocked(selectProvider).mockReturnValue({
        provider: mockProviderConfig,
        canonicalModelSlug: 'gpt-4',
      });

      const mockProviderClient = {
        getModel: vi.fn().mockReturnValue(mockModel),
      };

      vi.mocked(ProviderFactory.createClient).mockReturnValue(mockProviderClient as any);

      // Mock generateText to throw an error
      vi.mocked(generateText).mockRejectedValue(new Error('API error'));

      const requestData = {
        model: 'gpt-4',
        prompt: [
          {
            role: 'user',
            content: [{ type: 'text', text: 'Hello' }],
          },
        ],
      };

      const serializedRequest = superjson.serialize(requestData);

      const req = new Request('http://localhost/v1/ai-sdk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(serializedRequest),
      });

      const res = await app.fetch(req);
      const responseBody = await res.json();

      expect(res.status).toBe(500);
      expect(responseBody).toHaveProperty('error');
      expect(responseBody.error).toContain('API error');
      expect(logger.error).toHaveBeenCalled();
    });

    it('should correctly serialize complex response objects', async () => {
      // Mock provider selection
      const mockProviderConfig = {
        type: 'openai' as const,
        apiKey: 'sk-test-key',
      };

      const mockModel = {
        modelId: 'gpt-4',
        provider: 'openai',
      };

      vi.mocked(selectProvider).mockReturnValue({
        provider: mockProviderConfig,
        canonicalModelSlug: 'gpt-4',
      });

      const mockProviderClient = {
        getModel: vi.fn().mockReturnValue(mockModel),
      };

      vi.mocked(ProviderFactory.createClient).mockReturnValue(mockProviderClient as any);

      // Create a complex response with nested objects and special types
      const mockGenerateTextResult = {
        text: 'Response',
        finishReason: 'stop',
        usage: {
          promptTokens: 10,
          completionTokens: 5,
          totalTokens: 15,
        },
        metadata: {
          timestamp: new Date('2024-01-01T00:00:00Z'),
          nested: {
            value: 42,
            array: [1, 2, 3],
          },
        },
      };

      vi.mocked(generateText).mockResolvedValue(mockGenerateTextResult as any);

      const requestData = {
        model: 'gpt-4',
        prompt: [
          {
            role: 'user',
            content: [{ type: 'text', text: 'Hello' }],
          },
        ],
      };

      const serializedRequest = superjson.serialize(requestData);

      const req = new Request('http://localhost/v1/ai-sdk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(serializedRequest),
      });

      const res = await app.fetch(req);
      const responseBody = await res.json();

      expect(res.status).toBe(200);

      // Deserialize and verify complex types are preserved
      const deserializedResponse = superjson.deserialize(responseBody as any);
      expect(deserializedResponse).toEqual(mockGenerateTextResult);
      expect((deserializedResponse as any).metadata.timestamp).toBeInstanceOf(Date);
    });

    it('should log appropriate messages during request processing', async () => {
      // Mock provider selection
      const mockProviderConfig = {
        type: 'openai' as const,
        apiKey: 'sk-test-key',
      };

      const mockModel = {
        modelId: 'gpt-4',
        provider: 'openai',
      };

      vi.mocked(selectProvider).mockReturnValue({
        provider: mockProviderConfig,
        canonicalModelSlug: 'gpt-4',
      });

      const mockProviderClient = {
        getModel: vi.fn().mockReturnValue(mockModel),
      };

      vi.mocked(ProviderFactory.createClient).mockReturnValue(mockProviderClient as any);

      const mockGenerateTextResult = {
        text: 'Response',
        finishReason: 'stop',
        usage: {
          promptTokens: 10,
          completionTokens: 5,
          totalTokens: 15,
        },
      };

      vi.mocked(generateText).mockResolvedValue(mockGenerateTextResult as any);

      const requestData = {
        model: 'gpt-4',
        prompt: [
          {
            role: 'user',
            content: [{ type: 'text', text: 'Hello' }],
          },
        ],
      };

      const serializedRequest = superjson.serialize(requestData);

      const req = new Request('http://localhost/v1/ai-sdk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(serializedRequest),
      });

      await app.fetch(req);

      // Verify logging calls
      expect(logger.info).toHaveBeenCalledWith('Received AI SDK request');
      expect(logger.info).toHaveBeenCalledWith('Calling generateText on provider client');
      expect(logger.info).toHaveBeenCalledWith('Successfully generated text response');
      expect(logger.debug).toHaveBeenCalled();
    });
  });
});
