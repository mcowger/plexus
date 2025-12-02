import { 
  ProviderClient, 
  ProviderConfig, 
  ChatCompletionRequest, 
  ChatCompletionResponse,
  ModelHealthMetrics,
  ProviderType 
} from '@plexus/types';
import { generateText } from 'ai';

export abstract class BaseProviderClient implements ProviderClient {
  public readonly abstract type: ProviderType;
  public readonly config: ProviderConfig;
  protected model: any;

  constructor(config: ProviderConfig) {
    this.config = config;
    this.initializeModel();
  }

  protected abstract initializeModel(): void;

  async chatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const startTime = Date.now();
    
    try {
      const result = await generateText({
        model: this.model,
        messages: request.messages,
        temperature: request.temperature || this.config.temperature || 0.7,
      });

      const responseTime = Date.now() - startTime;

      return {
        id: `chatcmpl-${Date.now()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: request.model || this.config.model || 'default',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: result.text,
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 10, // Approximate values
          completion_tokens: result.text.length / 4, // Rough estimation
          total_tokens: 10 + (result.text.length / 4),
        },
      };
    } catch (error) {
      const responseTime = Date.now() - startTime;
      console.error(`Error in ${this.type} chat completion:`, error);
      throw error;
    }
  }

  async chatCompletionStream(
    request: ChatCompletionRequest,
    onChunk: (chunk: string) => void,
    onError?: (error: Error) => void
  ): Promise<void> {
    try {
      // For now, implement as non-streaming with chunk simulation
      const result = await generateText({
        model: this.model,
        messages: request.messages,
        temperature: request.temperature || this.config.temperature || 0.7,
      });

      // Simulate streaming by sending the entire response as one chunk
      onChunk(result.text);
      
      return Promise.resolve();
    } catch (error) {
      if (onError) {
        onError(error as Error);
      }
      throw error;
    }
  }

  async isHealthy(): Promise<boolean> {
    try {
      const testRequest: ChatCompletionRequest = {
        messages: [{ role: 'user', content: 'Hello' }],
        model: this.config.model,
        temperature: 0.1,
      };

      await this.chatCompletion(testRequest);
      return true;
    } catch (error) {
      console.error(`${this.type} health check failed:`, error);
      return false;
    }
  }

  async getHealthMetrics(): Promise<ModelHealthMetrics> {
    const startTime = Date.now();
    
    try {
      await this.isHealthy();
      const responseTime = Date.now() - startTime;

      return {
        provider: this.type,
        model: this.config.model || 'default',
        responseTime,
        successRate: 1.0,
        errorRate: 0.0,
        lastChecked: new Date(),
        consecutiveFailures: 0,
        totalRequests: 1,
        successfulRequests: 1,
        failedRequests: 0,
      };
    } catch (error) {
      const responseTime = Date.now() - startTime;

      return {
        provider: this.type,
        model: this.config.model || 'default',
        responseTime,
        successRate: 0.0,
        errorRate: 1.0,
        lastChecked: new Date(),
        consecutiveFailures: 1,
        totalRequests: 1,
        successfulRequests: 0,
        failedRequests: 1,
      };
    }
  }
}