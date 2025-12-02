import { 
  ProviderClient, 
  VirtualKeyConfig, 
  RoutingRequest, 
  RoutingResponse,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ProviderType,
  HealthScore,
  ModelHealthMetrics
} from '@plexus/types';
import { ProviderFactory } from '../providers/factory.js';

export interface RoutingConfig {
  virtualKeys: Map<string, VirtualKeyConfig>;
  healthCheckInterval: number; // milliseconds
  retryPolicy: RetryPolicy;
  fallbackEnabled: boolean;
}

export interface RetryPolicy {
  maxRetries: number;
  backoffMultiplier: number;
  initialDelay: number; // milliseconds
  maxDelay: number; // milliseconds
  retryableErrors: string[];
}

export class RoutingEngine {
  private config: RoutingConfig;
  private healthScores: Map<string, HealthScore> = new Map();
  private lastHealthCheck: Map<string, Date> = new Map();
  private providerClients: Map<ProviderType, ProviderClient> = new Map();

  constructor(config: RoutingConfig) {
    this.config = config;
    this.initializeProviders();
    this.startHealthCheckScheduler();
  }

  private initializeProviders(): void {
    // Initialize provider clients based on virtual key configurations
    for (const [key, vkeyConfig] of this.config.virtualKeys) {
      if (!this.providerClients.has(vkeyConfig.provider)) {
        // In a real implementation, you'd get API keys from environment variables
        const apiKey = this.getApiKeyForProvider(vkeyConfig.provider);
        const client = ProviderFactory.getClient(vkeyConfig.provider, apiKey, vkeyConfig.model);
        this.providerClients.set(vkeyConfig.provider, client);
      }
    }
  }

  private getApiKeyForProvider(provider: ProviderType): string {
    // In a real implementation, this would get API keys from environment variables
    const envVar = `${provider.toUpperCase()}_API_KEY`;
    return process.env[envVar] || 'mock-api-key';
  }

  async routeRequest(request: RoutingRequest): Promise<RoutingResponse> {
    const virtualKeyConfig = this.config.virtualKeys.get(request.virtualKey);
    
    if (!virtualKeyConfig) {
      throw new Error(`Virtual key '${request.virtualKey}' not found`);
    }

    let lastError: Error | null = null;
    let selectedProvider = virtualKeyConfig.provider;
    let retryAttempt = 0;

    // Try primary provider first, then fallbacks
    const providersToTry = [
      virtualKeyConfig.provider,
      ...(virtualKeyConfig.fallbackProviders || [])
    ];

    for (const providerType of providersToTry) {
      retryAttempt = 0;
      
      while (retryAttempt <= this.config.retryPolicy.maxRetries) {
        try {
          const client = this.getProviderClient(providerType);
          const healthScore = await this.getHealthScore(providerType);
          
          // Check if provider is healthy enough
          if (healthScore.overall < 20) {
            throw new Error(`Provider ${providerType} health score too low: ${healthScore.overall}`);
          }

          const response = await client.chatCompletion(request.request);
          
          // Update health metrics on success
          await this.updateHealthMetrics(providerType, true, Date.now() - Date.now());
          
          return {
            provider: providerType,
            model: virtualKeyConfig.model,
            response,
            routingMetadata: {
              selectedProvider: providerType,
              healthScore,
              fallbackUsed: providerType !== virtualKeyConfig.provider,
              retryAttempt
            }
          };

        } catch (error) {
          lastError = error as Error;
          retryAttempt++;
          
          if (retryAttempt <= this.config.retryPolicy.maxRetries) {
            const delay = this.calculateBackoffDelay(retryAttempt);
            await this.sleep(delay);
          }
        }
      }
    }

    // All providers failed
    throw new Error(`All providers failed for virtual key '${request.virtualKey}': ${lastError?.message}`);
  }

  async routeRequestStream(
    request: RoutingRequest,
    onChunk: (chunk: string) => void,
    onError?: (error: Error) => void
  ): Promise<void> {
    const virtualKeyConfig = this.config.virtualKeys.get(request.virtualKey);
    
    if (!virtualKeyConfig) {
      const error = new Error(`Virtual key '${request.virtualKey}' not found`);
      if (onError) onError(error);
      throw error;
    }

    const providersToTry = [
      virtualKeyConfig.provider,
      ...(virtualKeyConfig.fallbackProviders || [])
    ];

    for (const providerType of providersToTry) {
      try {
        const client = this.getProviderClient(providerType);
        const healthScore = await this.getHealthScore(providerType);
        
        if (healthScore.overall < 20) {
          continue; // Try next provider
        }

        await client.chatCompletionStream(request.request, onChunk, onError);
        return; // Success

      } catch (error) {
        console.error(`Provider ${providerType} failed for streaming:`, error);
        if (onError && providerType === providersToTry[providersToTry.length - 1]) {
          onError(error as Error);
        }
      }
    }
  }

  private getProviderClient(provider: ProviderType): ProviderClient {
    const client = this.providerClients.get(provider);
    if (!client) {
      throw new Error(`Provider client for ${provider} not found`);
    }
    return client;
  }

  private async getHealthScore(provider: ProviderType): Promise<HealthScore> {
    const cacheKey = `${provider}`;
    const lastCheck = this.lastHealthCheck.get(cacheKey);
    
    // Return cached score if recent
    if (lastCheck && Date.now() - lastCheck.getTime() < this.config.healthCheckInterval) {
      return this.healthScores.get(cacheKey) || this.computeDefaultHealthScore();
    }

    // Perform health check
    const client = this.getProviderClient(provider);
    const metrics = await client.getHealthMetrics();
    const score = this.computeHealthScore(metrics);
    
    this.healthScores.set(cacheKey, score);
    this.lastHealthCheck.set(cacheKey, new Date());
    
    return score;
  }

  private computeHealthScore(metrics: ModelHealthMetrics): HealthScore {
    const latencyScore = Math.max(0, 100 - (metrics.responseTime / 10)); // Penalize slow responses
    const reliabilityScore = metrics.successRate * 100;
    const availabilityScore = Math.max(0, 100 - (metrics.consecutiveFailures * 20));
    
    const overall = (latencyScore * 0.3 + reliabilityScore * 0.5 + availabilityScore * 0.2);
    
    return {
      overall: Math.round(overall),
      latency: Math.round(latencyScore),
      reliability: Math.round(reliabilityScore),
      availability: Math.round(availabilityScore)
    };
  }

  private computeDefaultHealthScore(): HealthScore {
    return {
      overall: 50,
      latency: 50,
      reliability: 50,
      availability: 50
    };
  }

  private async updateHealthMetrics(provider: ProviderType, success: boolean, responseTime: number): Promise<void> {
    const client = this.getProviderClient(provider);
    const metrics = await client.getHealthMetrics();
    
    // Update metrics based on success/failure
    metrics.totalRequests++;
    if (success) {
      metrics.successfulRequests++;
      metrics.consecutiveFailures = 0;
    } else {
      metrics.failedRequests++;
      metrics.consecutiveFailures++;
    }
    
    metrics.successRate = metrics.successfulRequests / metrics.totalRequests;
    metrics.errorRate = metrics.failedRequests / metrics.totalRequests;
    metrics.responseTime = responseTime;
    metrics.lastChecked = new Date();
    
    // Recompute health score
    const score = this.computeHealthScore(metrics);
    this.healthScores.set(provider, score);
  }

  private calculateBackoffDelay(retryAttempt: number): number {
    const delay = this.config.retryPolicy.initialDelay * 
                  Math.pow(this.config.retryPolicy.backoffMultiplier, retryAttempt);
    return Math.min(delay, this.config.retryPolicy.maxDelay);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private startHealthCheckScheduler(): void {
    setInterval(async () => {
      for (const [provider, client] of this.providerClients) {
        try {
          await this.getHealthScore(provider);
        } catch (error) {
          console.error(`Health check failed for ${provider}:`, error);
        }
      }
    }, this.config.healthCheckInterval);
  }

  // Public methods for configuration management
  updateVirtualKey(key: string, config: VirtualKeyConfig): void {
    this.config.virtualKeys.set(key, config);
    this.initializeProviders();
  }

  removeVirtualKey(key: string): void {
    this.config.virtualKeys.delete(key);
  }

  getHealthScores(): Map<string, HealthScore> {
    return new Map(this.healthScores);
  }

  getProviderStatus(): Map<ProviderType, { healthy: boolean; score: HealthScore }> {
    const status = new Map();
    
    for (const [provider, _client] of this.providerClients) {
      const score = this.healthScores.get(provider) || this.computeDefaultHealthScore();
      status.set(provider, {
        healthy: score.overall > 20,
        score
      });
    }
    
    return status;
  }
}