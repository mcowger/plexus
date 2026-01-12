# Programmatic Usage Guide: @musistudio/llms

This guide provides a comprehensive deep-dive into using the LLM Transformation library programmatically. 

## 1. Architecture Overview

The library acts as a universal adapter. It defines a "Common Language" for LLMs:

- **Unified Request**: A superset of OpenAI and Anthropic formats.
- **Unified Response**: A standardized way to represent text, tool calls, and reasoning.

### The Two Directions of Transformation

| Direction | Transformer Method | Data Flow | Purpose |
| :--- | :--- | :--- | :--- |
| **Inward** | `transformRequestOut` | External API -> Unified | Build a gateway that accepts Anthropic/OpenAI requests. |
| **Outward** | `transformRequestIn` | Unified -> Provider-specific | Modify the request before it hits the final LLM provider. |
| **Response** | `transformResponseOut`| Provider Response -> Unified | Normalize proprietary provider responses. |
| **Response** | `transformResponseIn` | Unified -> External Client | Convert the unified result back to the format the client expects. |

---

## 2. Core Data Structures

To use the library effectively, you should understand the `UnifiedChatRequest`.

```typescript
import { UnifiedChatRequest, UnifiedMessage, UnifiedTool } from "@musistudio/llms/types/llm";

const request: UnifiedChatRequest = {
  model: "string", // The target model name
  messages: [
    {
      role: "user", // "system", "user", "assistant", "tool"
      content: "Hello", // Can be string or MessageContent[] for multi-modal
    }
  ],
  tools: [ ... ], // Unified tool definitions
  stream: true,   // Boolean
  reasoning: {    // Reasoning/Thinking configuration
    enabled: true,
    effort: "medium" // "low", "medium", "high"
  }
};
```

---

## 3. Advanced Initialization

Using the `TransformerService` allows you to leverage all built-in transformers automatically.

```typescript
import { ConfigService } from "@musistudio/llms/services/config";
import { TransformerService } from "@musistudio/llms/services/transformer";
import { ProviderService } from "@musistudio/llms/services/provider";

// 1. Highly detailed configuration
const configService = new ConfigService({
  initialConfig: {
    providers: [
      {
        name: "vertex-provider",
        api_base_url: "https://...",
        api_key: "...",
        models: ["claude-3-5-sonnet"],
        transformer: {
          // Applied to all models in this provider
          use: ["maxtoken", { max_tokens: 4096 }],
          // Specific logic just for this model
          "claude-3-5-sonnet": {
            use: ["vertex-claude"] 
          }
        }
      }
    ]
  }
});

const transformerService = new TransformerService(configService, console);
await transformerService.initialize();

const providerService = new ProviderService(configService, transformerService, console);
```

---

## 4. End-to-End Request Lifecycle

Here is how to process a request from a client (e.g., using `@anthropic-ai/sdk`) and route it to a different provider.

```typescript
import { AnthropicTransformer } from "@musistudio/llms/transformer/anthropic.transformer";

async function handleInboundRequest(req: any) {
  // 1. Initialize the Gateway Transformer
  const gateway = new AnthropicTransformer();

  // 2. Transform the proprietary request (Anthropic) into the Unified Format
  const unifiedRequest = await gateway.transformRequestOut(req.body);

  // 3. Find the target provider/model
  const route = providerService.resolveModelRoute("vertex-provider,claude-3-5-sonnet");
  const provider = route.provider;

  // 4. Apply provider-side transformations (e.g. Vertex auth, parameter mapping)
  let finalRequest = unifiedRequest;
  if (provider.transformer?.use) {
    for (const t of provider.transformer.use) {
      finalRequest = await t.transformRequestIn(finalRequest, provider, { req });
    }
  }

  // 5. Send the request
  const response = await fetch(provider.baseUrl, {
    method: "POST",
    headers: { "Authorization": `Bearer ${provider.apiKey}` },
    body: JSON.stringify(finalRequest)
  });

  // 6. Transform response back (Provider -> Unified -> Client)
  // First: Provider proprietary format -> Unified
  let unifiedResponse = response;
  if (provider.transformer?.use) {
    // Reverse order for response processing
    for (const t of [...provider.transformer.use].reverse()) {
      if (t.transformResponseOut) {
        unifiedResponse = await t.transformResponseOut(unifiedResponse, { req });
      }
    }
  }

  // Second: Unified -> Original Client Format (Anthropic)
  // This handles SSE streaming automatically if response is a stream
  return await gateway.transformResponseIn(unifiedResponse, { req });
}
```

---

## 5. Streaming and SSE

The library is designed to handle Server-Sent Events (SSE) seamlessly. When using `AnthropicTransformer.transformResponseIn()`, it will:
1. Detect if the input `Response` is a stream (`text/event-stream`).
2. Wrap the `ReadableStream`.
3. Perform on-the-fly chunk transformation (e.g., converting OpenAI `chat.completion.chunk` to Anthropic `message_delta`).

```typescript
// Example of manually triggering a stream transformation
const transformer = new AnthropicTransformer();
const providerResponse = await fetch(...);

const clientResponse = await transformer.transformResponseIn(providerResponse, {
    req: { id: "my-request-id" }
});

// clientResponse is now a Fetch Response object with a transformed 
// ReadableStream ready to be sent to an Anthropic client.
```

---

## 6. Context and Logging

The `TransformerContext` is passed to every transformation method. It is essential for:
- Correlating logs with request IDs.
- Passing data between transformers in a chain.

```typescript
// Passing context
const context = {
  req: { id: "abc-123" },
  startTime: Date.now(),
  user: "matt"
};

const result = await transformer.transformRequestIn(req, provider, context);

// Using context in a custom transformer
async transformRequestIn(request, provider, context) {
  this.logger.info({ reqId: context.req.id }, "Transforming request...");
  return request;
}
```

---

## 7. Built-in Feature Transformers

| Transformer | Key Option | Behavior |
| :--- | :--- | :--- |
| `maxtoken` | `max_tokens` | Clamps the request's `max_tokens` to a specific limit. |
| `cleancache` | N/A | Strips Anthropic cache headers for providers that don't support them. |
| `reasoning` | N/A | Maps "thinking" blocks between models like DeepSeek R1 and OpenAI o1. |
| `tooluse` | N/A | Translates between Anthropic's tool schema and OpenAI's tool schema. |
| `sampling` | `temperature` | Overrides or adjusts sampling parameters. |
