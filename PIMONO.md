# OAuth Provider Integration Plan - Pi-AI Library

## Executive Summary

This document outlines the implementation plan for integrating OAuth-based LLM providers (Anthropic Claude Pro/Max, OpenAI Codex, Antigravity, GitHub Copilot, Google Gemini CLI) into Plexus using the `@mariozechner/pi-ai` library. The implementation uses a single OAuth transformer that consumes pi-ai's unified shapes while maintaining Plexus's existing architecture.

**Key Decision Summary:**
- **Approach:** Single OAuth transformer using pi-ai unified shapes
- **AUTH_JSON Location:** `./auth.json` (configurable via `AUTH_JSON` environment variable)
- **Error Handling:** Auto-refresh tokens with graceful fallback and clear error messages

---

## 1. Architecture Overview

### 1.1 High-Level Flow

```
Client Request (OpenAI/Anthropic format)
    ↓
Plexus parseRequest() → UnifiedChatRequest
    ↓
Convert to pi-ai Context
    ↓
pi-ai stream() or complete()
    ↓
Convert events/response to UnifiedChatStreamChunk or UnifiedChatResponse
    ↓
Plexus formatResponse() → Client format
```

### 1.2 Key Components

1. **OAuth Auth Manager** (`src/services/oauth-auth-manager.ts`)
   - Loads and manages `auth.json` credentials
   - Provides API keys to the transformer via `getOAuthApiKey()`
   - Handles token refresh automatically
   - Writes updated credentials back to `auth.json`

2. **OAuth Transformer**
   - `OAuthTransformer` - Single transformer for all OAuth-backed providers

3. **Type Mappers** (`src/transformers/oauth/type-mappers.ts`)
   - `unifiedToContext()` - UnifiedChatRequest → pi-ai Context
   - `contextToUnified()` - pi-ai AssistantMessage → UnifiedChatResponse
   - `eventToChunk()` - pi-ai AssistantMessageEvent → UnifiedChatStreamChunk

---

## 2. Type Mapping Reference

### 2.1 Pi-AI Types → Plexus Types

| Pi-AI Type | Plexus Type | Notes |
|------------|-------------|-------|
| `Context` | `UnifiedChatRequest` | System prompt + messages + tools |
| `Message` | `UnifiedMessage` | User/assistant/toolResult messages |
| `Tool` | `UnifiedTool` | TypeBox schema → JSON schema conversion |
| `AssistantMessage` | `UnifiedChatResponse` | Complete response with usage |
| `AssistantMessageEvent` | `UnifiedChatStreamChunk` | Streaming chunks |
| `TextContent` | `MessageContent` (text) | Text content blocks |
| `ImageContent` | `MessageContent` (image_url) | Image inputs |
| `ToolCall` | `tool_calls` array | Function calls |
| `Usage` | `UnifiedUsage` | Token counts and costs |

### 2.2 Key Differences

| Aspect | Pi-AI | Plexus |
|--------|-------|--------|
| System Prompt | Separate `systemPrompt` field | First message with `role: "system"` |
| Tools | TypeBox `TSchema` | JSON Schema objects |
| Content Blocks | `content: Array<TextContent \| ThinkingContent \| ToolCall>` | Strings or arrays with `type` field |
| Images | `{ type: "image", data: base64, mimeType }` | `{ type: "image_url", image_url: { url } }` |
| Tool Results | Separate `ToolResultMessage` type | `role: "tool"` with `tool_call_id` |
| Thinking/Reasoning | `ThinkingContent` block | `thinking` or `reasoning_content` field |

---

## 3. Detailed Implementation Plan

### Phase 1: Foundation & Type Mappers

#### 3.1 Create OAuth Auth Manager

**File:** `packages/backend/src/services/oauth-auth-manager.ts`

```typescript
import { 
  getOAuthApiKey, 
  type OAuthProvider, 
  type OAuthCredentials 
} from '@mariozechner/pi-ai';
import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger';

export class OAuthAuthManager {
  private static instance: OAuthAuthManager;
  private authData: Record<string, any> = {};
  private authFilePath: string;

  private constructor() {
    this.authFilePath = process.env.AUTH_JSON || './auth.json';
    this.loadAuthFile();
  }

  static getInstance(): OAuthAuthManager {
    if (!this.instance) {
      this.instance = new OAuthAuthManager();
    }
    return this.instance;
  }

  private loadAuthFile(): void {
    try {
      if (fs.existsSync(this.authFilePath)) {
        const content = fs.readFileSync(this.authFilePath, 'utf-8');
        this.authData = JSON.parse(content);
        logger.info(`OAuth: Loaded credentials from ${this.authFilePath}`);
      } else {
        logger.warn(`OAuth: No auth.json found at ${this.authFilePath}. OAuth providers will not be available.`);
      }
    } catch (error) {
      logger.error(`OAuth: Failed to load ${this.authFilePath}:`, error);
      throw new Error(`Failed to load OAuth credentials: ${error.message}`);
    }
  }

  private saveAuthFile(): void {
    try {
      fs.writeFileSync(
        this.authFilePath, 
        JSON.stringify(this.authData, null, 2), 
        'utf-8'
      );
      logger.debug(`OAuth: Saved updated credentials to ${this.authFilePath}`);
    } catch (error) {
      logger.error(`OAuth: Failed to save ${this.authFilePath}:`, error);
    }
  }

  async getApiKey(provider: OAuthProvider): Promise<string> {
    const result = await getOAuthApiKey(provider, this.authData);
    
    if (!result) {
      throw new Error(
        `OAuth: Not authenticated for provider '${provider}'. ` +
        `Please run: npx @mariozechner/pi-ai login ${provider}`
      );
    }

    // Save refreshed credentials if they changed
    if (result.newCredentials) {
      this.authData[provider] = { type: 'oauth', ...result.newCredentials };
      this.saveAuthFile();
    }

    return result.apiKey;
  }

  hasProvider(provider: OAuthProvider): boolean {
    return !!this.authData[provider];
  }

  reload(): void {
    this.loadAuthFile();
  }
}
```

**Key Features:**
- Singleton pattern for centralized credential management
- Auto-refresh on token expiration
- Saves updated tokens back to auth.json
- Clear error messages for unauthenticated providers

---

#### 3.2 Create Type Mappers

**File:** `packages/backend/src/transformers/oauth/type-mappers.ts`

```typescript
import type { 
  Context, 
  Message as PiAiMessage,
  UserMessage,
  AssistantMessage,
  ToolResultMessage,
  AssistantMessageEvent,
  Tool as PiAiTool,
  Usage
} from '@mariozechner/pi-ai';
import { Type } from '@sinclair/typebox';
import { 
  UnifiedChatRequest, 
  UnifiedChatResponse, 
  UnifiedChatStreamChunk,
  UnifiedMessage,
  UnifiedTool,
  MessageContent,
  UnifiedUsage
} from '../../types/unified';

/**
 * Convert Plexus UnifiedChatRequest to pi-ai Context
 */
export function unifiedToContext(request: UnifiedChatRequest): Context {
  const context: Context = {
    messages: [],
    tools: request.tools ? request.tools.map(unifiedToolToPiAi) : undefined
  };

  for (const msg of request.messages) {
    if (msg.role === 'system') {
      // System messages become systemPrompt
      const content = extractTextContent(msg.content);
      if (content) {
        context.systemPrompt = content;
      }
      continue;
    }

    if (msg.role === 'user') {
      context.messages.push(unifiedMessageToUserMessage(msg));
    } else if (msg.role === 'assistant') {
      context.messages.push(unifiedMessageToAssistantMessage(msg));
    } else if (msg.role === 'tool') {
      context.messages.push(unifiedMessageToToolResult(msg));
    }
  }

  return context;
}

/**
 * Convert Plexus UnifiedMessage (role=user) to pi-ai UserMessage
 */
function unifiedMessageToUserMessage(msg: UnifiedMessage): UserMessage {
  if (typeof msg.content === 'string') {
    return {
      role: 'user',
      content: msg.content,
      timestamp: Date.now()
    };
  }

  const content = msg.content.map(block => {
    if (block.type === 'text') {
      return { type: 'text' as const, text: block.text };
    } else if (block.type === 'image_url') {
      // Convert Plexus image format to pi-ai format
      const url = block.image_url.url;
      const isBase64 = url.startsWith('data:');
      
      if (isBase64) {
        const [header, data] = url.split(',');
        const mimeMatch = header.match(/data:(.*?);base64/);
        const mimeType = mimeMatch ? mimeMatch[1] : 'image/png';
        
        return {
          type: 'image' as const,
          data,
          mimeType
        };
      } else {
        throw new Error('OAuth providers require base64-encoded images, not URLs');
      }
    }
    
    throw new Error(`Unsupported content type: ${(block as any).type}`);
  });

  return {
    role: 'user',
    content,
    timestamp: Date.now()
  };
}

/**
 * Convert Plexus UnifiedMessage (role=assistant) to pi-ai AssistantMessage
 * This is used when passing conversation history to pi-ai
 */
function unifiedMessageToAssistantMessage(msg: UnifiedMessage): AssistantMessage {
  const content: any[] = [];

  // Handle text content
  if (typeof msg.content === 'string' && msg.content) {
    content.push({ type: 'text', text: msg.content });
  } else if (Array.isArray(msg.content)) {
    for (const block of msg.content) {
      if (block.type === 'text') {
        content.push({ type: 'text', text: block.text });
      }
    }
  }

  // Handle tool calls
  if (msg.tool_calls && msg.tool_calls.length > 0) {
    for (const toolCall of msg.tool_calls) {
      content.push({
        type: 'toolCall',
        id: toolCall.id,
        name: toolCall.function.name,
        arguments: JSON.parse(toolCall.function.arguments)
      });
    }
  }

  // Handle thinking/reasoning content
  if (msg.thinking) {
    content.push({
      type: 'thinking',
      thinking: msg.thinking.content,
      thinkingSignature: msg.thinking.signature
    });
  }

  return {
    role: 'assistant',
    content,
    api: 'openai-completions', // Placeholder - will be overridden by actual API
    provider: 'unknown',
    model: 'unknown',
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
    },
    stopReason: 'stop',
    timestamp: Date.now()
  };
}

/**
 * Convert Plexus UnifiedMessage (role=tool) to pi-ai ToolResultMessage
 */
function unifiedMessageToToolResult(msg: UnifiedMessage): ToolResultMessage {
  const content: any[] = [];

  if (typeof msg.content === 'string') {
    content.push({ type: 'text', text: msg.content });
  } else if (Array.isArray(msg.content)) {
    for (const block of msg.content) {
      if (block.type === 'text') {
        content.push({ type: 'text', text: block.text });
      } else if (block.type === 'image_url') {
        // Convert to pi-ai image format
        const url = block.image_url.url;
        if (url.startsWith('data:')) {
          const [header, data] = url.split(',');
          const mimeMatch = header.match(/data:(.*?);base64/);
          const mimeType = mimeMatch ? mimeMatch[1] : 'image/png';
          content.push({ type: 'image', data, mimeType });
        }
      }
    }
  }

  return {
    role: 'toolResult',
    toolCallId: msg.tool_call_id!,
    toolName: msg.name || 'unknown',
    content,
    isError: false, // Plexus doesn't track this currently
    timestamp: Date.now()
  };
}

/**
 * Convert Plexus UnifiedTool to pi-ai Tool
 */
function unifiedToolToPiAi(tool: UnifiedTool): PiAiTool {
  // Convert JSON Schema to TypeBox schema
  // For now, we'll use Type.Unknown() and let pi-ai handle it
  // In practice, you might want to convert the JSON Schema properly
  const parameters = Type.Object(
    Object.fromEntries(
      Object.entries(tool.function.parameters.properties || {}).map(
        ([key, value]: [string, any]) => [
          key,
          Type.Any({ description: value.description })
        ]
      )
    ),
    { 
      additionalProperties: tool.function.parameters.additionalProperties ?? false 
    }
  );

  return {
    name: tool.function.name,
    description: tool.function.description || '',
    parameters
  };
}

/**
 * Convert pi-ai AssistantMessage to Plexus UnifiedChatResponse
 */
export function piAiMessageToUnified(
  message: AssistantMessage,
  provider: string,
  model: string
): UnifiedChatResponse {
  let textContent: string | null = null;
  let thinkingContent: string | null = null;
  const toolCalls: any[] = [];

  for (const block of message.content) {
    if (block.type === 'text') {
      textContent = (textContent || '') + block.text;
    } else if (block.type === 'thinking') {
      thinkingContent = (thinkingContent || '') + block.thinking;
    } else if (block.type === 'toolCall') {
      toolCalls.push({
        id: block.id,
        type: 'function',
        function: {
          name: block.name,
          arguments: JSON.stringify(block.arguments)
        }
      });
    }
  }

  const usage = piAiUsageToUnified(message.usage);

  return {
    id: `oauth-${Date.now()}`,
    model,
    created: Math.floor(message.timestamp / 1000),
    content: textContent,
    reasoning_content: thinkingContent,
    thinking: thinkingContent ? { content: thinkingContent } : undefined,
    tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
    usage,
    plexus: {
      provider,
      model,
      apiType: 'oauth',
    },
    finishReason: mapStopReason(message.stopReason)
  };
}

/**
 * Convert pi-ai AssistantMessageEvent to Plexus UnifiedChatStreamChunk
 */
export function piAiEventToChunk(
  event: AssistantMessageEvent,
  model: string
): UnifiedChatStreamChunk | null {
  const baseChunk = {
    id: `oauth-${Date.now()}`,
    model,
    created: Math.floor(Date.now() / 1000),
    delta: {},
    finish_reason: null,
    usage: undefined
  };

  switch (event.type) {
    case 'start':
      return {
        ...baseChunk,
        delta: { role: 'assistant' }
      };

    case 'text_delta':
      return {
        ...baseChunk,
        delta: { content: event.delta }
      };

    case 'thinking_delta':
      return {
        ...baseChunk,
        delta: { 
          reasoning_content: event.delta,
          thinking: { content: event.delta }
        }
      };

    case 'toolcall_start':
      // Start of a new tool call
      return {
        ...baseChunk,
        delta: {
          tool_calls: [{
            index: event.contentIndex,
            id: '', // Will be filled in subsequent events
            type: 'function',
            function: { name: '', arguments: '' }
          }]
        }
      };

    case 'toolcall_delta':
      // Progressive tool call arguments
      const toolCall = event.partial.content[event.contentIndex];
      if (toolCall.type === 'toolCall') {
        return {
          ...baseChunk,
          delta: {
            tool_calls: [{
              index: event.contentIndex,
              id: toolCall.id,
              type: 'function',
              function: {
                name: toolCall.name,
                arguments: event.delta
              }
            }]
          }
        };
      }
      return null;

    case 'toolcall_end':
      // Complete tool call
      return {
        ...baseChunk,
        delta: {
          tool_calls: [{
            index: event.contentIndex,
            id: event.toolCall.id,
            type: 'function',
            function: {
              name: event.toolCall.name,
              arguments: JSON.stringify(event.toolCall.arguments)
            }
          }]
        }
      };

    case 'done':
      return {
        ...baseChunk,
        finish_reason: mapStopReason(event.reason),
        usage: piAiUsageToUnified(event.message.usage)
      };

    case 'error':
      return {
        ...baseChunk,
        finish_reason: event.reason === 'aborted' ? 'aborted' : 'error',
        usage: piAiUsageToUnified(event.error.usage)
      };

    // Events we don't need to map to chunks
    case 'text_start':
    case 'text_end':
    case 'thinking_start':
    case 'thinking_end':
      return null;

    default:
      return null;
  }
}

/**
 * Convert pi-ai Usage to Plexus UnifiedUsage
 */
function piAiUsageToUnified(usage: Usage): UnifiedUsage {
  return {
    input_tokens: usage.input,
    output_tokens: usage.output,
    total_tokens: usage.totalTokens,
    reasoning_tokens: 0, // Pi-ai doesn't expose this separately yet
    cached_tokens: usage.cacheRead,
    cache_creation_tokens: usage.cacheWrite
  };
}

/**
 * Map pi-ai stop reason to Plexus finish reason
 */
function mapStopReason(reason: string): string {
  switch (reason) {
    case 'stop': return 'stop';
    case 'length': return 'length';
    case 'toolUse': return 'tool_calls';
    case 'error': return 'error';
    case 'aborted': return 'aborted';
    default: return 'stop';
  }
}

/**
 * Extract text content from mixed content (string or array)
 */
function extractTextContent(content: string | null | MessageContent[]): string | null {
  if (typeof content === 'string') {
    return content;
  }
  
  if (Array.isArray(content)) {
    const textBlocks = content.filter(b => b.type === 'text');
    return textBlocks.map(b => (b as any).text).join('');
  }
  
  return null;
}
```

**Key Features:**
- Bidirectional conversion between Plexus and pi-ai types
- Handles all content types: text, images, tool calls, thinking
- Preserves as much information as possible during conversion
- Streaming event mapping with proper tool call accumulation

---

### Phase 2: Create OAuth Transformer

#### 3.3 OAuth Transformer

**File:** `packages/backend/src/transformers/oauth/oauth-transformer.ts`

```typescript
import { Transformer } from '../../types/transformer';
import { UnifiedChatRequest, UnifiedChatResponse, UnifiedChatStreamChunk } from '../../types/unified';
import { 
  getModel, 
  stream, 
  complete, 
  type OAuthProvider,
  type Model as PiAiModel,
  type AssistantMessageEventStream
} from '@mariozechner/pi-ai';
import { OAuthAuthManager } from '../../services/oauth-auth-manager';
import { unifiedToContext, piAiMessageToUnified, piAiEventToChunk } from './type-mappers';
import { logger } from '../../utils/logger';

// Bun does not support ReadableStream.from(), so wrap AsyncIterable manually.
function streamFromAsyncIterable<T>(iterable: AsyncIterable<T>): ReadableStream<T> {
  const iterator = iterable[Symbol.asyncIterator]();

  return new ReadableStream<T>({
    async pull(controller) {
      try {
        const { value, done } = await iterator.next();
        if (done) {
          controller.close();
        } else {
          controller.enqueue(value);
        }
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel(reason) {
      await iterator.return?.(reason);
    }
  });
}

export class OAuthTransformer implements Transformer {
  readonly name = 'oauth';
  readonly defaultEndpoint = '/v1/chat/completions';
  readonly defaultModel = 'gpt-5-mini';

  /**
   * Get the pi-ai model for the provider + model ID
   */
  protected getPiAiModel(provider: OAuthProvider, modelId: string): PiAiModel<any> {
    return getModel(provider, modelId);
  }

  /**
   * Parse incoming request - OAuth transformer doesn't accept direct requests,
   * they only work with unified format
   */
  async parseRequest(input: any): Promise<UnifiedChatRequest> {
    throw new Error(
      `${this.name}: OAuth transformer cannot parse direct client requests. ` +
      `Use OpenAI or Anthropic transformers as entry points.`
    );
  }

  /**
   * Transform unified request to pi-ai Context
   */
  async transformRequest(request: UnifiedChatRequest): Promise<any> {
    const context = unifiedToContext(request);
    
    logger.debug(`${this.name}: Converted UnifiedChatRequest to pi-ai Context`, {
      messageCount: context.messages.length,
      hasSystemPrompt: !!context.systemPrompt,
      toolCount: context.tools?.length || 0
    });

    return context;
  }

  /**
   * Transform pi-ai response to unified format
   */
  async transformResponse(response: any): Promise<UnifiedChatResponse> {
    // Response is already a pi-ai AssistantMessage from complete()
    const unified = piAiMessageToUnified(
      response,
      response.provider,
      response.model
    );

    logger.debug(`${this.name}: Converted pi-ai response to unified`, {
      hasContent: !!unified.content,
      hasToolCalls: !!unified.tool_calls,
      usageTokens: unified.usage?.total_tokens
    });

    return unified;
  }

  /**
   * Format unified response - OAuth transformer doesn't format responses,
   * the original entry transformer (OpenAI/Anthropic) handles that
   */
  async formatResponse(response: UnifiedChatResponse): Promise<any> {
    throw new Error(
      `${this.name}: OAuth transformer cannot format responses. ` +
      `Use the original entry transformer for formatting.`
    );
  }

  /**
   * Transform pi-ai event stream to unified chunks
   */
  transformStream(stream: AsyncIterable<any>): ReadableStream {
    // The input stream is an AsyncIterable from pi-ai
    // Convert it to UnifiedChatStreamChunk format
    const mapped = (async function* () {
      for await (const event of stream) {
        const chunk = piAiEventToChunk(event, event.partial?.model || 'unknown');
        if (chunk) {
          yield chunk;
        }
      }
    })();

    return streamFromAsyncIterable(mapped);
  }


  /**
   * Format unified stream - not used by OAuth transformer
   */
  formatStream?(stream: ReadableStream): ReadableStream {
    throw new Error(
      `${this.name}: OAuth transformer cannot format streams. ` +
      `Use the original entry transformer for formatting.`
    );
  }

  /**
   * Extract usage from event data
   * Pi-ai events have usage in the AssistantMessage
   */
  extractUsage(eventData: string): {
    input_tokens?: number;
    output_tokens?: number;
    cached_tokens?: number;
    reasoning_tokens?: number;
  } | undefined {
    try {
      const event = JSON.parse(eventData);
      
      if (event.type === 'done' && event.message?.usage) {
        return {
          input_tokens: event.message.usage.input,
          output_tokens: event.message.usage.output,
          cached_tokens: event.message.usage.cacheRead,
          reasoning_tokens: 0 // Not exposed by pi-ai yet
        };
      }
    } catch (e) {
      // Ignore parse errors
    }

    return undefined;
  }

  /**
   * Execute the actual pi-ai request
   * This is called by the Dispatcher when making the provider request
   */
  async executeRequest(
    context: any, // pi-ai Context
    provider: OAuthProvider,
    modelId: string,
    streaming: boolean
  ): Promise<any> {
    const authManager = OAuthAuthManager.getInstance();
    const apiKey = await authManager.getApiKey(provider);
    const model = this.getPiAiModel(provider, modelId);

    logger.info(`${this.name}: Executing ${streaming ? 'streaming' : 'complete'} request`, {
      model: model.id,
      provider
    });

    if (streaming) {
      const eventStream = stream(model, context, { apiKey });
      
      // Return the async iterable directly
      // transformStream() will convert it to UnifiedChatStreamChunk
      return eventStream;
    } else {
      const response = await complete(model, context, { apiKey });
      return response;
    }
  }
}
```

**Key Features:**
- OAuth transformer implementation
- Implements the Transformer interface
- Handles authentication via OAuthAuthManager
- Converts between Plexus and pi-ai formats
- Uses a helper to wrap AsyncIterable into ReadableStream (Bun lacks ReadableStream.from)
- Provides executeRequest() method for Dispatcher integration

### Phase 3: Integration with Plexus Infrastructure

#### 3.9 Register OAuth Transformer

**File:** `packages/backend/src/transformers/index.ts`

Add OAuth transformer export:

```typescript
// Existing exports...
export { OpenAITransformer } from './openai';
export { AnthropicTransformer } from './anthropic/index';
// ... other transformers

// OAuth transformer
export { OAuthTransformer } from './oauth/oauth-transformer';
```

---

#### 3.10 Update TransformerFactory

**File:** `packages/backend/src/services/transformer-factory.ts`

Add OAuth transformer to the factory:

```typescript
import { OAuthTransformer } from '../transformers';

export class TransformerFactory {
  private static transformers: Map<string, Transformer> = new Map([
    // Existing transformers
    ['chat', new OpenAITransformer()],
    ['messages', new AnthropicTransformer()],
    ['gemini', new GeminiTransformer()],
    ['responses', new ResponsesTransformer()],
    
    // OAuth transformer
    ['oauth', new OAuthTransformer()],
  ]);

  static getTransformer(type: string): Transformer {
    const transformer = this.transformers.get(type.toLowerCase());
    if (!transformer) {
      throw new Error(`Unsupported transformer type: ${type}`);
    }
    return transformer;
  }
}
```

---

#### 3.11 Update Dispatcher for OAuth Execution

**File:** `packages/backend/src/services/Dispatcher.ts`

Keep Dispatcher changes minimal. OAuth requests should bypass HTTP and invoke the transformer directly, using the provider + model resolved by routing. The payload should carry a small marker so the dispatcher can detect OAuth and call `executeRequest()` with `{ context, provider, modelId, streaming }`, then wrap the AsyncIterable or response in a standard `Response`.

---

#### 3.12 Update Configuration Schema

**File:** `packages/backend/src/config.ts`

Add AUTH_JSON to environment variable handling:

```typescript
// Add after other environment variable checks
export function getAuthJsonPath(): string {
  return process.env.AUTH_JSON || './auth.json';
}

// Export for use in OAuthAuthManager
export const CONFIG_DEFAULTS = {
  AUTH_JSON_PATH: getAuthJsonPath()
};
```

---

### Phase 4: Configuration Examples

#### 4.1 Example plexus.yaml Configuration

**File:** `config/plexus.example.yaml`

Add OAuth provider examples:

```yaml
providers:
  # Anthropic Claude (via OAuth - Pro/Max subscription)
  # Requires: npx @mariozechner/pi-ai login anthropic
  anthropic-oauth:
    display_name: Anthropic Claude (OAuth)
    api_base_url: oauth://  # Special URL format for OAuth
    api_key: oauth  # Placeholder - actual auth from auth.json
    models:
      - claude-3-5-sonnet-20241022
      - claude-3-5-haiku-20241022
      - claude-3-opus-20240229
      - claude-sonnet-4-20250514

  # OpenAI Codex (via OAuth)
  # Requires: npx @mariozechner/pi-ai login openai-codex
  codex:
    display_name: OpenAI Codex
    api_base_url: oauth://  # Special URL format for OAuth
    api_key: oauth  # Placeholder - actual auth from auth.json
    models:
      - gpt-5-mini
      - gpt-5
      - gpt-5-preview

  # Google Antigravity (Free via OAuth)
  # Requires: npx @mariozechner/pi-ai login google-antigravity
  antigravity:
    display_name: Google Antigravity
    api_base_url: oauth://
    api_key: oauth
    models:
      - gemini-3-flash
      - gemini-2.5-flash
      - claude-3-5-sonnet-20241022
      - gpt-oss-70b

  # GitHub Copilot
  # Requires: npx @mariozechner/pi-ai login github-copilot
  github-copilot:
    display_name: GitHub Copilot
    api_base_url: oauth://
    api_key: oauth
    models:
      - gpt-4o
      - gpt-4o-mini
      - o1-preview
      - claude-3-5-sonnet-20241022

  # Google Gemini CLI (Cloud Code Assist)
  # Requires: npx @mariozechner/pi-ai login google-gemini-cli
  gemini-cli:
    display_name: Google Gemini CLI
    api_base_url: oauth://
    api_key: oauth
    models:
      - gemini-2.5-flash
      - gemini-2.0-flash

```

---

#### 4.2 Example auth.json Structure

**File:** `auth.json.example`

```json
{
  "anthropic": {
    "type": "oauth",
    "accessToken": "ey...",
    "refreshToken": "ey...",
    "expiresAt": 1738627200000
  },
  "openai-codex": {
    "type": "oauth",
    "accessToken": "ey...",
    "refreshToken": "ey...",
    "expiresAt": 1738627200000
  },
  "google-antigravity": {
    "type": "oauth",
    "accessToken": "ya29...",
    "refreshToken": "1//...",
    "expiresAt": 1738627200000,
    "projectId": "your-project-id"
  },
  "github-copilot": {
    "type": "oauth",
    "accessToken": "ghu_...",
    "refreshToken": "ghr_...",
    "expiresAt": 1738627200000
  },
  "google-gemini-cli": {
    "type": "oauth",
    "accessToken": "ya29...",
    "refreshToken": "1//...",
    "expiresAt": 1738627200000,
    "projectId": "your-project-id"
  }
}
```

**Note:** This file is auto-generated and updated by the pi-ai library. Users should not edit it manually.

---

### Phase 5: Error Handling & Edge Cases

#### 5.1 Authentication Error Handling

**Error Scenarios:**

1. **Missing auth.json**
   - **Detection:** File doesn't exist at AUTH_JSON path
   - **Response:** HTTP 401 with clear message
   - **Message:** "OAuth provider '{provider}' not authenticated. Run: npx @mariozechner/pi-ai login {provider}"

2. **Expired Token (Refresh Succeeds)**
   - **Detection:** getOAuthApiKey() refreshes token
   - **Response:** Request proceeds normally
   - **Side Effect:** Updated auth.json written to disk

3. **Expired Token (Refresh Fails)**
   - **Detection:** getOAuthApiKey() throws error
   - **Response:** HTTP 401
   - **Message:** "OAuth authentication expired for '{provider}'. Please re-authenticate: npx @mariozechner/pi-ai login {provider}"

4. **Invalid Provider Configuration**
   - **Detection:** getModel() throws for unknown model
   - **Response:** HTTP 400
   - **Message:** "Model '{model}' not available for provider '{provider}'"

#### 5.2 Error Handler Implementation

**File:** `packages/backend/src/services/oauth-error-handler.ts`

```typescript
export class OAuthErrorHandler {
  static handleAuthError(error: Error, provider: string): Response {
    if (error.message.includes('Not authenticated')) {
      return new Response(JSON.stringify({
        error: {
          message: `OAuth provider '${provider}' not authenticated. ` +
                   `Please run: npx @mariozechner/pi-ai login ${provider}`,
          type: 'authentication_error',
          code: 'oauth_not_authenticated'
        }
      }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (error.message.includes('expired')) {
      return new Response(JSON.stringify({
        error: {
          message: `OAuth authentication expired for '${provider}'. ` +
                   `Please re-authenticate: npx @mariozechner/pi-ai login ${provider}`,
          type: 'authentication_error',
          code: 'oauth_token_expired'
        }
      }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Generic error
    return new Response(JSON.stringify({
      error: {
        message: error.message,
        type: 'oauth_error',
        code: 'unknown'
      }
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
```

---
