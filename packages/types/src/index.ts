import { z } from 'zod';

// Chat Completion Schema
export const chatCompletionSchema = z.object({
  messages: z.array(
    z.object({
      role: z.enum(['system', 'user', 'assistant']),
      content: z.string(),
    })
  ),
  model: z.string().optional(),
  temperature: z.number().optional(),
});

export type ChatCompletionRequest = z.infer<typeof chatCompletionSchema>;

// Provider Types
export type ProviderType = 'openai' | 'anthropic' | 'openrouter';

export interface ProviderConfig {
  type: ProviderType;
  apiKey: string;
  baseURL?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: ChatMessage;
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// Provider Client Interface
export interface ProviderClient {
  readonly type: ProviderType;
  readonly config: ProviderConfig;
  
  chatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse>;
  chatCompletionStream(
    request: ChatCompletionRequest,
    onChunk: (chunk: string) => void,
    onError?: (error: Error) => void
  ): Promise<void>;
  
  isHealthy(): Promise<boolean>;
  getHealthMetrics(): Promise<ModelHealthMetrics>;
}

// Health Scoring
export interface ModelHealthMetrics {
  provider: ProviderType;
  model: string;
  responseTime: number; // milliseconds
  successRate: number; // 0-1
  errorRate: number; // 0-1
  lastChecked: Date;
  consecutiveFailures: number;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
}

export interface HealthScore {
  overall: number; // 0-100
  latency: number; // 0-100
  reliability: number; // 0-100
  availability: number; // 0-100
}

// Routing Engine Types
export interface VirtualKeyConfig {
  key: string;
  provider: ProviderType;
  model: string;
  priority: number;
  fallbackProviders?: ProviderType[];
  rateLimit?: {
    requestsPerMinute: number;
    requestsPerHour: number;
  };
}

export interface RoutingRequest {
  virtualKey: string;
  request: ChatCompletionRequest;
  userId?: string;
  metadata?: Record<string, any>;
}

export interface RoutingResponse {
  provider: ProviderType;
  model: string;
  response: ChatCompletionResponse;
  routingMetadata: {
    selectedProvider: ProviderType;
    healthScore: HealthScore;
    fallbackUsed: boolean;
    retryAttempt: number;
  };
}
