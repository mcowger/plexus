

## 1. Scope

### 1.1 In-Scope

* Single process, personal-use **AI Gateway** with:

  * HTTP API layer using **Hono**
  * Text-only **chat completion** endpoint, OpenAI-compatible signature
  * Provider integration via **Vercel AI SDK v5**
  * Request validation and config schemas via **Zod**
  * **Routing engine** implementing:

    * Retry policies
    * Error-based fallback
  * **Virtual API keys** for access and routing configuration
  * Provider API keys stored in **configuration files on disk**

### 1.2 Out of Scope (Initial Version)

* Multimodal (images, audio, video)
* Loadbalancing
* Key management UI or external secret store
* RBAC, SSO, compliance features
* Budgets and caching
* Observability (metrics, traces, dashboards, external log sinks)
* Plugin system, guardrails
* Developer experience tooling (CLIs, installers, templates)

---

## 2. Technology Stack

* **Runtime**: Node.js 24+ (or compatible runtime)
* **Language**: TypeScript
* **Web framework**: [Hono](https://hono.dev/)
* **LLM Client**: Vercel AI SDK v5
* **Schema & validation**: Zod
* **Config files**: JSON on local disk
* **Package manager**: pnpm

---

## 3. High-Level Architecture

### 3.1 Components

1. **HTTP Layer (Hono App)**

   * Exposes OpenAI-compatible `/v1/chat/completions` endpoint
   * Handles request parsing, validation, and error translation
   * Extracts virtual key from `Authorization` header

2. **Auth & Virtual Key Resolver**

   * Maps incoming virtual keys to **VirtualKeyConfig** entries loaded from disk
   * Each virtual key defines:

     * Allowed routing groups / providers / models
     * Retry and fallback configuration overrides

3. **Routing Engine**

   * Given a virtual key and request payload, selects a provider+model:

     * Health scoring
   * Applies retry policy and error-based fallback between candidates

4. **Provider Abstraction Layer (Vercel AI SDK v5)**

   * Wraps Vercel AI SDK clients for supported providers
   * Normalizes responses to OpenAI-compatible chat completion output
   * Handles provider-specific errors and mapping into normalized error types

5. **Configuration Loader**

   * Loads and validates:

     * Provider configuration file
     * Virtual keys configuration file
   * Uses Zod schemas
   * Provides in-memory read-only snapshot during runtime

6. **Health State (In-Memory)**

   * Tracks per-provider and per-model statistics:

     * Success count, failure count
     * Rolling error rate
     * Rolling average latency
   * Computes health scores per provider/model
   * Used by routing engine

---

## 4. HTTP API Specification

### 4.1 Authentication

* Header: `Authorization: Bearer <virtual_key_id>`
* `virtual_key_id` is a string used to look up the virtual key configuration.   Use the Bearer auth middleware:
https://hono.dev/docs/middleware/builtin/bearer-auth

```typescript
import { Hono } from 'hono'
import { bearerAuth } from 'hono/bearer-auth'
```

### 4.2 Endpoint: `POST /v1/chat/completions`

**Request body** (subset of OpenAI spec, validated via Zod):

```ts
const ChatCompletionRequestSchema = z.object({
  model: z.string(),
  messages: z.array(
    z.object({
      role: z.enum(['system', 'user', 'assistant']),
      content: z.string(), // initial version: plain string only
    })
  ),
  max_tokens: z.number().int().positive().optional(),
  max_completion_tokens: z.number().int().positive().optional(),
  temperature: z.number().min(0).max(2).optional(),
  top_p: z.number().min(0).max(1).optional(),
  stream: z.boolean().optional(),
  tools: z.object().optional()
}).strict();
```

**Response body** (OpenAI-compatible, simplified):

```ts
const ChatCompletionResponseSchema = z.object({
  id: z.string(),
  object: z.literal('chat.completion'),
  created: z.number(),
  model: z.string(),
  choices: z.array(
    z.object({
      index: z.number(),
      finish_reason: z.string().nullable(),
      message: z.object({
        role: z.literal('assistant'),
        content: z.string(),
      }),
    })
  ),
  usage: z.object({
    prompt_tokens: z.number().optional(),
    completion_tokens: z.number().optional(),
    total_tokens: z.number().optional(),
  }).optional(),
});
```

### 4.3 Error Responses

* **401 Unauthorized**

  * Missing or unknown virtual key
* **400 Bad Request**

  * Request body does not pass Zod validation
* **422 Unprocessable Entity**

  * Requested model not allowed for this virtual key
* **503 Service Unavailable**

  * All configured providers failed according to routing/fallback policy

Error response shape:

```ts
const ErrorResponseSchema = z.object({
  error: z.object({
    type: z.string(),
    message: z.string(),
    code: z.string().nullable().optional(),
  }),
});
```

---

## 5. Configuration Design

Three main config files:

1. `providers.json`
1. `models.json`
2. `virtual-keys.json`

### 5.1 Provider Configuration (`providers.json`)

Defines available providers and related metadata

Example (JSON):

```json
{
  "providers": [
    {
      "id": "openai",
      "type": "openai",
      "apiKey": "env:OPENAI_API_KEY",
      "baseUrl": "https://api.openai.com/v1",
      "headers": {
        "Custom-HEader": "1234",
      }
    },
    {
      "id": "anthropic",
      "type": "anthropic",
      "apiKey": "env:ANTHROPIC_API_KEY",
      "baseUrl": "https://api.anthropic.com/v1"
    }
  ]
}

```

**Zod schema (conceptual):**

```ts

const ProviderConfigSchema = z.object({
  id: z.string(),
  type: z.enum(['openai', 'anthropic', 'gemini'), // extend as needed
  apiKey: z.string(),
  baseUrl: z.string().url().optional(),
  headers: z.record(z.string()) // arbitrary string → string map
});

```

### 5.2 Virtual Keys Configuration (`virtual-keys.json`)

Defines virtual keys and their routing policies.

Example:

```json
{
  "virtualKeys": [
    {
      "id": "vk-personal-default",
      "label": "Personal default key",
      "key": "Actual key text",
      "allowedModels": [
        {
          "modelId": "gpt-4o-mini"
        },
        {
          "modelId": "claude-3-opus"
        }
      ]
    }
  ]
}

```

**Zod schema (conceptual):**

```ts
const ModelRefSchema = z.array(modelId: z.string(),);


const VirtualKeyConfigSchema = z.object({
  id: z.string(),
  label: z.string().optional(),
  key: z.string(),
  allowedModels: z.array(ModelRefSchema),
});

const VirtualKeysConfigSchema = z.object({
  virtualKeys: z.array(VirtualKeyConfigSchema),
});
```

### 5.3 Model Configurations (`models.json`)

```ts
const ModelSchema = z.object({
  // Canonical human-readable name (e.g., "GPT-4o Mini")
  name: z.string(),

  // Unique machine-friendly identifier (e.g., "gpt-4o-mini")
  slug: z.string(),

  // Display label used in UIs (may differ from name)
  displayName: z.string(),

  // Key used to look up pricing in a pricing table
  costLookupName: z.string(),

  // Context window size (tokens)
  contextWindow: z.number().int().positive(),

  // Optionally include output token limit or other constraints
  maxOutputTokens: z.number().int().positive().optional(),

  // Optional generic metadata bucket
  metadata: z.record(z.any()).optional(),

  // Providers that offer this model (e.g., ["openai", "azure-openai"])
  providerIds: z.array(z.string()).nonempty()
});

const ModelsConfigSchema = z.object({
  virtualKeys: z.array(ModelSchema).nonempty(),
});

```

Example JSON:

```json
[
    {
        "name": "GPT-4o Mini",
        "slug": "gpt-4o-mini",
        "displayName": "OpenAI GPT-4o Mini",
        "costLookupName": "gpt-4o-mini",
        "contextWindow": 128000,
        "maxOutputTokens": 4096,
        "providerIds": ["openai","otherProvider"],
        "metadata": {
            "releaseDate": "2024-05-01",
            "family": "GPT-4o",
            "supportsImages": false
        }
    },
        {
        "name": "MyModel Mega",
        "slug": "mymodel-mega",
        "displayName": "OBest on the market",
        "costLookupName": "mymodel-mega-lookup",
        "contextWindow": 256000,
        "maxOutputTokens": 8192,
        "providerIds": ["otherProvider"],
        "metadata": {
            "releaseDate": "2025-05-01",
            "family": "Gemini",
            "supportsImages": true
        }
    }
]
```

---

## 6. Routing Engine Specification

### 6.1 Inputs

* `virtualKey: VirtualKeyConfig`
* `request: ChatCompletionRequest`
* `providers: ProviderConfig[]`
* `models: ModelConfig[]`
* `healthState: ProviderHealthState`

### 6.2 Provider Candidate Selection

1. **Filter by virtual key:**

   * Build list of `(providerId, modelId)` pairs from `virtualKey.allowedModels`.
2. **Filter by known providers/models:**

   * Match against `providers` config; ignore unknown entries.

Result: `candidateModels: CandidateModel[]`.


5. Get **health score** from `healthState`:

* `healthScore` ∈ [0,1]
* If unknown, default to `1.0`.

6. Compute **final routing score** (example):

```text
routingScore = healthScore
```

### 6.4 Weighted Selection

* Use ** routingScore** as weights for random selection:

  * Select model with highest routing score.  If all routing scores are equal, select randomly.



## 7. Provider Abstraction Using Vercel AI SDK v5

### 7.1 Provider Client Interface

Define internal interface:

```ts
interface ProviderClient {
  chatCompletion(
    modelId: string,
    request: ChatCompletionRequest
  ): Promise<any>; // provider-specific result

  chatCompletionStream?(
    modelId: string,
    request: ChatCompletionRequest
  ): AsyncIterable<any>;
}
```

### 7.2 Implementation Sketch

Use Vercel AI SDK v5 clients for different providers. For example, for OpenAI-like providers:

```ts
// Pseudocode, adjust to actual Vercel AI SDK v5 API
import { createOpenAI } from '@ai-sdk/openai';

function createOpenAIProviderClient(config: ProviderConfig): ProviderClient {
  const client = createOpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseUrl,
  });

  return {
    async chatCompletion(modelId, request) {
      const result = await client.chat.completions.create({
        model: modelId,
        messages: request.messages,
        max_tokens: request.max_tokens,
        temperature: request.temperature,
        top_p: request.top_p,
        stream: false,
      });
      return result;
    },

    async *chatCompletionStream(modelId, request) {
      const stream = await client.chat.completions.create({
        model: modelId,
        messages: request.messages,
        stream: true,
      });
      for await (const chunk of stream) {
        yield chunk;
      }
    },
  };
}
```

Additional provider types can be implemented similarly, mapping `modelId` and request fields.

### 7.3 Normalization Layer

Convert provider result to OpenAI-compatible structure using a normalizer:

```ts
function normalizeResponse(
  providerResponse: any,
  candidate: CandidateModel
): ChatCompletionResponse {
  // Extract text, usage, etc. according to provider format
  return {
    id: providerResponse.id ?? generateId(),
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: `${candidate.providerId}/${candidate.modelId}`,
    choices: [
      {
        index: 0,
        finish_reason: providerResponse.choices?.[0]?.finish_reason ?? 'stop',
        message: {
          role: 'assistant',
          content: providerResponse.choices?.[0]?.message?.content ?? '',
        },
      },
    ],
    usage: providerResponse.usage,
  };
}
```

---

## 8. Health Scoring

### 8.1 Data Structures

```ts
interface ModelHealthMetrics {
  providerId: string;
  modelId: string;
  successCount: number;
  failureCount: number;
  errorCounts: Record<string, number>; // by normalized error type
  totalLatencyMs: number;
  sampleCount: number;
}

interface ProviderHealthState {
  [key: string]: ModelHealthMetrics; // key: `${providerId}:${modelId}`
}
```

### 8.2 Metrics Update

On each request completion:

```ts
function updateHealth(
  candidate: CandidateModel,
  result: {
    success: boolean;
    latency: number;
    errorType?: string;
  }
) {
  const key = `${candidate.providerId}:${candidate.modelId}`;
  const metrics = state[key] || initMetrics(candidate);

  metrics.sampleCount += 1;
  metrics.totalLatencyMs += result.latency;

  if (result.success) {
    metrics.successCount += 1;
  } else {
    metrics.failureCount += 1;
    if (result.errorType) {
      metrics.errorCounts[result.errorType] =
        (metrics.errorCounts[result.errorType] ?? 0) + 1;
    }
  }

  state[key] = metrics;
}
```

### 8.3 Health Score Calculation

For routing:

```ts
function computeHealthScore(metrics: ModelHealthMetrics): number {
  const total = metrics.successCount + metrics.failureCount;
  if (total === 0) return 1.0;

  const errorRate = metrics.failureCount / total;
  const avgLatency = metrics.totalLatencyMs / Math.max(metrics.sampleCount, 1);

  // Example calculation:
  const errorComponent = Math.max(0, 1 - errorRate * 2); // penalize errors
  const latencyComponent = 1 / (1 + avgLatency / 1000);  // 1s -> 0.5

  const score = (errorComponent * 0.7) + (latencyComponent * 0.3);
  return Math.min(Math.max(score, 0), 1);
}
```

`computeHealthScore` is invoked inside the routing engine when computing `routingScore`.

---

## 9. Request Lifecycle

1. **HTTP Layer**

   * Receive POST `/v1/chat/completions`.
   * Extract `Authorization` header.
   * Parse JSON body.
   * Validate body with `ChatCompletionRequestSchema`.

2. **Virtual Key Resolution**

   * Extract virtual key token from `Authorization` (strip `Bearer ` prefix).
   * Look up in `VirtualKeysConfig.virtualKeys`.
   * If not found → `401 Unauthorized`.

3. **Candidate Models Resolution**

   * Resolve `virtualKey.allowedModels` into actual `ProviderConfig` and `ProviderModelConfig` entries.
   * If `request.model` is given:

     * Check if it is allowed
     * Otherwise return `422`.

4. **Routing Engine**

   * Build list of candidate models.
   * For each candidate:
     * Compute health score.


5. **Provider Call**

   * Use `ProviderClient` created via Vercel AI SDK.
   * Map input fields.
   * Execute completion.

6. **Response Normalization**

   * Convert provider response into OpenAI-compatible response.
   * Validate with `ChatCompletionResponseSchema` (optional).
   * Return JSON with `200 OK`.

7. **Error Handling**

   * Normalize thrown errors.
   * If routing engine throws final error → map to `503` or other appropriate status code.
   * Send `ErrorResponseSchema`.

---

## 10. Implementation Structure (Suggested)

```text
src/
  app.ts                 # Hono server setup, route registration, argument parsing.
  config/
    loader.ts            # config file loading + Zod validation
    providers.ts         # typed provider config accessors
    virtualKeys.ts       # typed virtual key accessors
  routing/
    engine.ts            # routing algorithm
    health.ts            # health tracking and scoring
    errors.ts            # normalized error types
  providers/
    index.ts             # provider registry
    openai.ts            # OpenAI via Vercel AI SDK
    anthropic.ts         # Anthropic via Vercel AI SDK
  api/
    chatCompletions.ts   # handler for /v1/chat/completions
  schemas/
    chat.ts              # Zod schemas for chat request/response
    config.ts            # Zod schemas for provider, model & virtual key configs
  utils/
    id.ts                # id generation
types/
  index.d.ts             # shared TypeScript interfaces
```
