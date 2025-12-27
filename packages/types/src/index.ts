import { z } from 'zod';
import { LanguageModel, Provider } from 'ai';


// Error Response Schema
export const errorResponseSchema = z.object({
  error: z.object({
    message: z.string(),
    type: z.string().optional(),
    code: z.string().optional(),
  }),
});

export type ErrorResponse = z.infer<typeof errorResponseSchema>;

// Provider Types
const providerTypeSchema = z.enum(['openai', 'anthropic']);
export type ProviderType = z.infer<typeof providerTypeSchema>;


// Configuration Schemas
export const providerConfigSchema = z.object({
  type: providerTypeSchema,
  apiKey: z.string().min(1, 'API key is required'),
  baseURL: z.url().optional(),
  headers: z.record(z.string(), z.string()).optional()
});

export type ProviderConfig = z.infer<typeof providerConfigSchema>;

export const virtualKeyConfigSchema = z.object({
  key: z.string().min(4, 'Virtual key is required')
});

export type VirtualKeyConfig = z.infer<typeof virtualKeyConfigSchema>;

export const modelSchema = z.object({
  display_slug: z.string('Model ID is required'),
  canonical_slug: z.string().optional(),
  display_name: z.string().min(1, 'Model name is required'),
  pricing_slug: z.string().optional(),
  providerIds: z.array(z.string()).nonempty('Must specify at least one provider id'),
  maxTokens: z.number().int().min(1).max(32000).optional(),
  contextWindow: z.number().int().min(1).optional(),
  inputTokenPrice: z.number().min(0).optional(),
  outputTokenPrice: z.number().min(0).optional(),
});

export type ModelConfig = z.infer<typeof modelSchema>;

export interface ProviderClient {
  readonly type: ProviderType;
  readonly config: ProviderConfig;
  readonly providerInstance: Provider; // Provider instance from @ai-sdk providers (OpenAIProvider, AnthropicProvider, etc.)
  getModel(modelId: string): LanguageModel;
}

// Health Scoring Schemas
const modelHealthMetricsSchema = z.object({
  provider: providerTypeSchema,
  model: z.string(),
  responseTime: z.number().min(0), // milliseconds
  successRate: z.number().min(0).max(1), // 0-1
  errorRate: z.number().min(0).max(1), // 0-1
  lastChecked: z.date(),
  consecutiveFailures: z.number().int().min(0),
  totalRequests: z.number().int().min(0),
  successfulRequests: z.number().int().min(0),
  failedRequests: z.number().int().min(0),
});

export type ModelHealthMetrics = z.infer<typeof modelHealthMetricsSchema>;

const healthScoreSchema = z.object({
  overall: z.number().min(0).max(100), // 0-100
  latency: z.number().min(0).max(100), // 0-100
  reliability: z.number().min(0).max(100), // 0-100
  availability: z.number().min(0).max(100), // 0-100
});

export type HealthScore = z.infer<typeof healthScoreSchema>;
