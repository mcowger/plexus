import { z } from 'zod';
import {GenerateTextResult, ToolSet } from 'ai';

// Chat Message Schema
const chatMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string().min(1, 'Message content cannot be empty'),
});

export type ChatMessage = z.infer<typeof chatMessageSchema>;

// Chat Completion Request Schema
export const chatCompletionRequestSchema = z.object({
  messages: z.array(chatMessageSchema).min(1, 'At least one message is required'),
  model: z.string(),
  temperature: z.number().min(0).max(2).default(1.0),
  max_tokens: z.number().min(1).max(128000).optional(),
  stream: z.boolean().default(true),
});

export type ChatCompletionRequest = z.infer<typeof chatCompletionRequestSchema>;

// Chat Completion Response Schema
const chatCompletionResponseSchema = z.object({
  id: z.string(),
  object: z.literal('chat.completion'),
  created: z.number(),
  model: z.string(),
  choices: z.array(
    z.object({
      index: z.number().gte(0),
      message: chatMessageSchema,
      finish_reason: z.enum(['stop', 'length', 'content_filter','tool_calls']),
    })
  ),
  usage: z.object({
    prompt_tokens: z.number(),
    completion_tokens: z.number(),
    total_tokens: z.number(),
  }),
});

export type ChatCompletionResponse = z.infer<typeof chatCompletionResponseSchema>;

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
const providerTypeSchema = z.enum(['openai', 'anthropic', 'openrouter']);
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

export type ProviderClient = {
  chatCompletion(request: ChatCompletionRequest, model: ModelConfig): Promise<GenerateTextResult<ToolSet, never>>;
};

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
