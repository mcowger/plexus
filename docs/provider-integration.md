# Provider Integration Documentation

## Overview

The Provider Integration system is a comprehensive solution for managing multiple AI providers (OpenAI, Anthropic, OpenRouter) with intelligent routing, health monitoring, and fallback mechanisms. Built on top of Vercel AI SDK v5, it provides a unified interface for interacting with various AI providers while maintaining high availability and performance.

## Architecture

### Core Components

1. **Provider Abstraction Layer** (`packages/backend/src/providers/`)
   - `BaseProviderClient`: Abstract base class for all providers
   - `OpenAIProviderClient`: OpenAI-specific implementation
   - `AnthropicProviderClient`: Anthropic-specific implementation  
   - `OpenRouterProviderClient`: OpenRouter-specific implementation
   - `ProviderFactory`: Factory pattern for creating and caching provider clients

2. **Routing Engine** (`packages/backend/src/routing/`)
   - `RoutingEngine`: Core routing logic with health scoring and retry policies
   - Handles provider selection based on virtual keys
   - Implements fallback mechanisms and retry logic

3. **Type System** (`packages/types/src/index.ts`)
   - Comprehensive TypeScript interfaces for all components
   - Type-safe provider configurations and responses

## Features

### Provider Abstraction
- **Unified Interface**: All providers implement the same `ProviderClient` interface
- **Factory Pattern**: Efficient client creation and caching
- **Type Safety**: Full TypeScript support with comprehensive type definitions

### Routing Engine
- **Virtual Key Routing**: Route requests based on virtual keys to specific providers
- **Health Scoring**: Real-time health monitoring with configurable scoring algorithms
- **Retry Policies**: Exponential backoff with configurable retry logic
- **Fallback Mechanisms**: Automatic failover to backup providers

### Health Monitoring
- **Real-time Metrics**: Track response times, success rates, and error rates
- **Health Scoring**: Composite scoring based on latency, reliability, and availability
- **Automatic Health Checks**: Scheduled health monitoring with configurable intervals

### Error Handling
- **Graceful Degradation**: Fallback to healthy providers on failures
- **Comprehensive Logging**: Detailed error tracking and debugging information
- **Retry Logic**: Intelligent retry with exponential backoff

## Usage

### Basic Setup

```typescript
import { RoutingEngine, VirtualKeyConfig, ProviderType } from '@plexus/types';

// Configure virtual keys
const virtualKeys = new Map<string, VirtualKeyConfig>([
  ['my-virtual-key', {
    key: 'my-virtual-key',
    provider: 'openai' as ProviderType,
    model: 'gpt-3.5-turbo',
    priority: 1,
    fallbackProviders: ['anthropic', 'openrouter']
  }]
]);

// Configure routing engine
const routingConfig = {
  virtualKeys,
  healthCheckInterval: 60000, // 1 minute
  retryPolicy: {
    maxRetries: 3,
    backoffMultiplier: 2,
    initialDelay: 100,
    maxDelay: 1000,
    retryableErrors: ['timeout', 'rate_limit', 'network_error']
  },
  fallbackEnabled: true
};

const routingEngine = new RoutingEngine(routingConfig);
```

### Making Requests

```typescript
import { ChatCompletionRequest } from '@plexus/types';

const request: ChatCompletionRequest = {
  messages: [
    { role: 'user', content: 'Hello, world!' }
  ],
  temperature: 0.7
};

const routingRequest = {
  virtualKey: 'my-virtual-key',
  request,
  userId: 'user-123'
};

// Route the request
const response = await routingEngine.routeRequest(routingRequest);
console.log('Response:', response.response);
```

### Streaming Requests

```typescript
const chunks: string[] = [];

await routingEngine.routeRequestStream(
  routingRequest,
  (chunk: string) => {
    chunks.push(chunk);
    // Handle streaming chunk
  },
  (error: Error) => {
    console.error('Streaming error:', error);
  }
);
```

### Health Monitoring

```typescript
// Get provider status
const status = routingEngine.getProviderStatus();
status.forEach((providerStatus, provider) => {
  console.log(`${provider}:`, providerStatus);
});

// Get health scores
const scores = routingEngine.getHealthScores();
scores.forEach((score, provider) => {
  console.log(`${provider} health score:`, score.overall);
});
```

## API Endpoints

### Chat Completions
- **POST** `/v1/chat/completions`
- **Headers**: `Authorization: Bearer <virtual-key>`
- **Body**: Chat completion request
- **Returns**: Provider response

### Health Check
- **GET** `/health`
- **Returns**: Overall system health status

### Provider Status
- **GET** `/api/providers/status`
- **Returns**: Detailed provider health and status information

## Configuration

### Environment Variables

Set the following environment variables for provider API keys:

```bash
OPENAI_API_KEY=your_openai_api_key
ANTHROPIC_API_KEY=your_anthropic_api_key
OPENROUTER_API_KEY=your_openrouter_api_key
```

### Virtual Key Configuration

```typescript
interface VirtualKeyConfig {
  key: string;                    // Virtual key identifier
  provider: ProviderType;         // Primary provider
  model: string;                  // Model to use
  priority: number;               // Priority level
  fallbackProviders?: ProviderType[]; // Backup providers
  rateLimit?: {                   // Optional rate limiting
    requestsPerMinute: number;
    requestsPerHour: number;
  };
}
```

### Retry Policy Configuration

```typescript
interface RetryPolicy {
  maxRetries: number;             // Maximum retry attempts
  backoffMultiplier: number;      // Exponential backoff multiplier
  initialDelay: number;           // Initial delay in milliseconds
  maxDelay: number;               // Maximum delay in milliseconds
  retryableErrors: string[];      // Error types that should be retried
}
```

## Health Scoring Algorithm

The health scoring system uses a weighted combination of three factors:

1. **Latency Score** (30% weight): Penalizes slow response times
   - `score = max(0, 100 - (responseTime / 10))`

2. **Reliability Score** (50% weight): Based on success rate
   - `score = successRate * 100`

3. **Availability Score** (20% weight): Penalizes consecutive failures
   - `score = max(0, 100 - (consecutiveFailures * 20))`

Overall score: `(latencyScore * 0.3 + reliabilityScore * 0.5 + availabilityScore * 0.2)`

## Testing

### Unit Tests
- Provider factory and client tests: `packages/backend/tests/providers.test.ts`
- Routing engine tests: `packages/backend/tests/routing.test.ts`

### Integration Tests
- End-to-end provider interaction tests: `packages/backend/tests/integration.test.ts`

### Running Tests
```bash
cd packages/backend
pnpm test
```

## Performance Considerations

1. **Client Caching**: Provider clients are cached to avoid recreation overhead
2. **Health Score Caching**: Health scores are cached for performance
3. **Connection Pooling**: Underlying provider SDKs handle connection pooling
4. **Async Operations**: All provider interactions are asynchronous

## Error Handling

### Provider Failures
- Automatic fallback to backup providers
- Retry with exponential backoff
- Comprehensive error logging

### Network Issues
- Configurable retry policies
- Timeout handling
- Circuit breaker patterns (planned)

### Rate Limiting
- Rate limit detection and handling
- Automatic backoff on rate limit errors
- Queue management (planned)

## Monitoring and Observability

### Metrics Tracked
- Response times
- Success/error rates
- Provider health scores
- Retry attempts
- Fallback usage

### Logging
- Request routing decisions
- Provider health changes
- Error details and stack traces
- Performance metrics

## Security Considerations

1. **API Key Management**: API keys stored in environment variables
2. **Request Validation**: Input validation using Zod schemas
3. **Authentication**: Bearer token authentication for API access
4. **Rate Limiting**: Configurable rate limits per virtual key

## Future Enhancements

1. **Circuit Breaker Pattern**: Implement circuit breakers for failing providers
2. **Request Queuing**: Add request queuing for high-load scenarios
3. **Metrics Dashboard**: Real-time monitoring dashboard
4. **A/B Testing**: Provider performance comparison
5. **Cost Optimization**: Intelligent routing based on cost
6. **Custom Providers**: Plugin system for custom provider implementations

## Troubleshooting

### Common Issues

1. **Provider Not Found**
   - Check virtual key configuration
   - Verify provider type is supported

2. **High Latency**
   - Check provider health scores
   - Consider adjusting health check intervals

3. **Frequent Fallbacks**
   - Investigate primary provider issues
   - Review retry policies

4. **Memory Leaks**
   - Monitor client cache size
   - Consider implementing cache eviction policies

### Debug Mode

Enable debug logging by setting:
```bash
DEBUG=plexus:*
```

## Support

For issues and questions:
1. Check the troubleshooting section
2. Review test cases for usage examples
3. Examine health metrics for provider status
4. Check logs for detailed error information