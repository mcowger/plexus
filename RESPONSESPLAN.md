# OpenAI Responses API Implementation Plan

## Executive Summary

This document provides a comprehensive implementation plan for adding OpenAI Responses API (`/v1/responses`) support to Plexus. The Responses API is OpenAI's next-generation interface designed for agentic applications, featuring stateful conversations, built-in tools (web search, file search, code interpreter, computer use), and a structured item-based input/output system.

**Implementation Complexity:** High (8-10 weeks)
**Priority Features:** Core API, Streaming, Multi-turn Conversations, Function Calling
**Deferred Features:** Built-in tools (web search, file search, code interpreter, computer use), MCP integration

---

## 1. Architecture Overview

### 1.1 Key Differences from Chat Completions API

| Feature | Chat Completions | Responses API |
|---------|-----------------|---------------|
| **Input Format** | Array of messages | String or array of items (messages, tool results, reasoning) |
| **Output Format** | Single message in choices array | Array of output items (messages, function calls, reasoning) |
| **State Management** | Stateless | Stateful via `previous_response_id` or `conversation` |
| **Tool Integration** | Function calling only | Function calling + built-in tools (web search, file search, etc.) |
| **Response Storage** | None | Automatic storage with `store: true` |
| **Streaming Events** | Simple deltas | Rich event system with sequence numbers |
| **Instructions** | System messages in conversation | Top-level `instructions` field (not carried over in multi-turn) |

### 1.2 Implementation Strategy

The implementation will follow Plexus's existing transformer architecture:

1. **New Transformer:** `ResponsesTransformer` for OpenAI Responses API format
2. **Unified Types:** Extend existing unified types to support Responses API structures
3. **Request/Response Transformation:** Bidirectional transformation between Responses API and Chat Completions formats
4. **Streaming Support:** New streaming event types with sequence numbers
5. **State Management:** Database-backed storage for responses and conversations
6. **Provider Translation:** Transform Responses API requests to provider-specific formats (OpenAI Chat, Anthropic Messages)

---

## 2. Database Schema Changes

### 2.1 New Drizzle Schema Definitions

We'll create three new tables using Drizzle ORM schema definitions for both SQLite and PostgreSQL.

#### SQLite Schema: `packages/backend/drizzle/schema/sqlite/responses.ts`

```typescript
import { sqliteTable, integer, text, real, index } from 'drizzle-orm/sqlite-core';

export const responses = sqliteTable('responses', {
  id: text('id').primaryKey(),                    // resp_xxx format
  object: text('object').notNull(),               // Always 'response'
  createdAt: integer('created_at').notNull(),     // Unix timestamp
  completedAt: integer('completed_at'),           // Unix timestamp when completed
  status: text('status').notNull(),               // 'completed', 'failed', 'in_progress', etc.
  model: text('model').notNull(),
  outputItems: text('output_items').notNull(),    // JSON array of output items
  instructions: text('instructions'),
  temperature: real('temperature'),
  topP: real('top_p'),
  maxOutputTokens: integer('max_output_tokens'),
  topLogprobs: integer('top_logprobs'),
  parallelToolCalls: integer('parallel_tool_calls'),  // Boolean as integer
  toolChoice: text('tool_choice'),                    // JSON string
  tools: text('tools'),                               // JSON array
  textConfig: text('text_config'),                    // JSON object
  reasoningConfig: text('reasoning_config'),          // JSON object
  usageInputTokens: integer('usage_input_tokens'),
  usageOutputTokens: integer('usage_output_tokens'),
  usageReasoningTokens: integer('usage_reasoning_tokens'),
  usageCachedTokens: integer('usage_cached_tokens'),
  usageTotalTokens: integer('usage_total_tokens'),
  previousResponseId: text('previous_response_id'),
  conversationId: text('conversation_id').references(() => conversations.id, { onDelete: 'cascade' }),
  store: integer('store').notNull().default(1),      // Boolean as integer
  background: integer('background').notNull().default(0),
  truncation: text('truncation'),
  incompleteDetails: text('incomplete_details'),      // JSON object
  error: text('error'),                               // JSON object
  safetyIdentifier: text('safety_identifier'),
  serviceTier: text('service_tier'),
  promptCacheKey: text('prompt_cache_key'),
  promptCacheRetention: text('prompt_cache_retention'),
  metadata: text('metadata'),                         // JSON object
  
  // Plexus-specific fields
  plexusProvider: text('plexus_provider'),
  plexusTargetModel: text('plexus_target_model'),
  plexusApiType: text('plexus_api_type'),
  plexusCanonicalModel: text('plexus_canonical_model'),
}, (table) => ({
  conversationIdx: index('idx_responses_conversation').on(table.conversationId),
  createdAtIdx: index('idx_responses_created_at').on(table.createdAt),
  statusIdx: index('idx_responses_status').on(table.status),
  previousIdx: index('idx_responses_previous').on(table.previousResponseId),
}));

export const conversations = sqliteTable('conversations', {
  id: text('id').primaryKey(),                    // conv_xxx format
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  items: text('items').notNull(),                 // JSON array of all conversation items
  metadata: text('metadata'),                     // JSON object
  
  // Plexus-specific
  plexusAccountId: text('plexus_account_id'),
}, (table) => ({
  updatedIdx: index('idx_conversations_updated').on(table.updatedAt),
}));

export const responseItems = sqliteTable('response_items', {
  id: text('id').primaryKey(),                    // msg_xxx, fc_xxx, reason_xxx, etc.
  responseId: text('response_id').notNull().references(() => responses.id, { onDelete: 'cascade' }),
  itemIndex: integer('item_index').notNull(),
  itemType: text('item_type').notNull(),          // 'message', 'function_call', 'reasoning', etc.
  itemData: text('item_data').notNull(),          // JSON object
}, (table) => ({
  responseIdx: index('idx_response_items_response').on(table.responseId, table.itemIndex),
  typeIdx: index('idx_response_items_type').on(table.itemType),
}));
```

#### PostgreSQL Schema: `packages/backend/drizzle/schema/postgres/responses.ts`

```typescript
import { pgTable, text, bigint, integer, real, index } from 'drizzle-orm/pg-core';

export const responses = pgTable('responses', {
  id: text('id').primaryKey(),                    // resp_xxx format
  object: text('object').notNull(),               // Always 'response'
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  completedAt: bigint('completed_at', { mode: 'number' }),
  status: text('status').notNull(),
  model: text('model').notNull(),
  outputItems: text('output_items').notNull(),    // JSON array of output items
  instructions: text('instructions'),
  temperature: real('temperature'),
  topP: real('top_p'),
  maxOutputTokens: integer('max_output_tokens'),
  topLogprobs: integer('top_logprobs'),
  parallelToolCalls: integer('parallel_tool_calls'),
  toolChoice: text('tool_choice'),
  tools: text('tools'),
  textConfig: text('text_config'),
  reasoningConfig: text('reasoning_config'),
  usageInputTokens: integer('usage_input_tokens'),
  usageOutputTokens: integer('usage_output_tokens'),
  usageReasoningTokens: integer('usage_reasoning_tokens'),
  usageCachedTokens: integer('usage_cached_tokens'),
  usageTotalTokens: integer('usage_total_tokens'),
  previousResponseId: text('previous_response_id'),
  conversationId: text('conversation_id').references(() => conversations.id, { onDelete: 'cascade' }),
  store: integer('store').notNull().default(1),
  background: integer('background').notNull().default(0),
  truncation: text('truncation'),
  incompleteDetails: text('incomplete_details'),
  error: text('error'),
  safetyIdentifier: text('safety_identifier'),
  serviceTier: text('service_tier'),
  promptCacheKey: text('prompt_cache_key'),
  promptCacheRetention: text('prompt_cache_retention'),
  metadata: text('metadata'),
  
  // Plexus-specific fields
  plexusProvider: text('plexus_provider'),
  plexusTargetModel: text('plexus_target_model'),
  plexusApiType: text('plexus_api_type'),
  plexusCanonicalModel: text('plexus_canonical_model'),
}, (table) => ({
  conversationIdx: index('idx_responses_conversation').on(table.conversationId),
  createdAtIdx: index('idx_responses_created_at').on(table.createdAt),
  statusIdx: index('idx_responses_status').on(table.status),
  previousIdx: index('idx_responses_previous').on(table.previousResponseId),
}));

export const conversations = pgTable('conversations', {
  id: text('id').primaryKey(),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
  items: text('items').notNull(),
  metadata: text('metadata'),
  plexusAccountId: text('plexus_account_id'),
}, (table) => ({
  updatedIdx: index('idx_conversations_updated').on(table.updatedAt),
}));

export const responseItems = pgTable('response_items', {
  id: text('id').primaryKey(),
  responseId: text('response_id').notNull().references(() => responses.id, { onDelete: 'cascade' }),
  itemIndex: integer('item_index').notNull(),
  itemType: text('item_type').notNull(),
  itemData: text('item_data').notNull(),
}, (table) => ({
  responseIdx: index('idx_response_items_response').on(table.responseId, table.itemIndex),
  typeIdx: index('idx_response_items_type').on(table.itemType),
}));
```

### 2.2 Migration Strategy

**CRITICAL:** Follow the Drizzle migration workflow exactly:

1. **Create schema files** in both `packages/backend/drizzle/schema/sqlite/responses.ts` and `packages/backend/drizzle/schema/postgres/responses.ts`
2. **Export from index files** - Add exports to `sqlite/index.ts` and `postgres/index.ts`:
   ```typescript
   export * from './responses';
   ```
3. **Generate migrations for BOTH databases**:
   ```bash
   cd packages/backend
   
   # Generate SQLite migration
   bunx drizzle-kit generate
   
   # Generate PostgreSQL migration
   bunx drizzle-kit generate --config drizzle.config.pg.ts
   ```
4. **Review the generated migrations**:
   - Check `drizzle/migrations/XXXX_responses_api.sql` (SQLite)
   - Check `drizzle/migrations_pg/XXXX_responses_api.sql` (PostgreSQL)
   - Verify both the SQL file AND the journal entry were created
5. **Test migrations** - Restart the server and verify no errors
6. **Commit all generated files** - SQL, snapshots, and journal changes

**NEVER:**
- Write SQL manually
- Edit `meta/_journal.json` manually
- Skip generating migrations for both databases
- Modify the database directly with SQL commands

---

## 3. Type System Extensions

### 3.1 New Unified Types

Create `packages/backend/src/types/responses.ts`:

```typescript
// ============================================================================
// Input Types
// ============================================================================

export interface ResponsesInputItem {
  type: 'message' | 'function_call' | 'function_call_output' | 'reasoning';
  id?: string;
}

export interface ResponsesMessageItem extends ResponsesInputItem {
  type: 'message';
  role: 'user' | 'assistant' | 'system' | 'developer';
  content: ResponsesContentPart[];
}

export interface ResponsesContentPart {
  type: 'input_text' | 'input_image' | 'input_audio' | 'output_text' | 'summary_text';
  text?: string;
  image_url?: string;
  audio_url?: string;
  detail?: 'low' | 'high' | 'auto';
  transcript?: string;
}

export interface ResponsesFunctionCallItem extends ResponsesInputItem {
  type: 'function_call';
  call_id: string;
  name: string;
  arguments: string;
  status?: 'in_progress' | 'completed' | 'failed';
}

export interface ResponsesFunctionCallOutputItem extends ResponsesInputItem {
  type: 'function_call_output';
  call_id: string;
  output: any;
  status?: 'completed' | 'failed';
}

export interface ResponsesReasoningItem extends ResponsesInputItem {
  type: 'reasoning';
  summary: ResponsesContentPart[];
  reasoning_content?: ResponsesContentPart[];
  encrypted_content?: string;
}

// ============================================================================
// Tool Types
// ============================================================================

export interface ResponsesFunctionTool {
  type: 'function';
  name: string;
  description?: string;
  parameters: any; // JSON Schema
  strict?: boolean;
}

export interface ResponsesWebSearchTool {
  type: 'web_search';
}

export interface ResponsesFileSearchTool {
  type: 'file_search';
  vector_store_ids: string[];
}

export interface ResponsesCodeInterpreterTool {
  type: 'code_interpreter';
}

export interface ResponsesComputerUseTool {
  type: 'computer_use';
}

export interface ResponsesImageGenerationTool {
  type: 'image_generation';
  model?: string;
  size?: string;
  quality?: 'standard' | 'hd';
  output_format?: 'png' | 'jpeg' | 'webp';
  background?: 'opaque' | 'transparent';
}

export interface ResponsesMCPTool {
  type: 'mcp';
  server_label: string;
  server_description: string;
  server_url: string;
  require_approval?: 'never' | 'always' | 'once';
}

export type ResponsesTool = 
  | ResponsesFunctionTool 
  | ResponsesWebSearchTool 
  | ResponsesFileSearchTool 
  | ResponsesCodeInterpreterTool
  | ResponsesComputerUseTool
  | ResponsesImageGenerationTool
  | ResponsesMCPTool;

// ============================================================================
// Request Type
// ============================================================================

export interface UnifiedResponsesRequest {
  requestId?: string;
  model: string;
  input: string | ResponsesInputItem[];
  instructions?: string;
  tools?: ResponsesTool[];
  tool_choice?: 'none' | 'auto' | 'required' | {
    mode: 'required' | 'auto';
    type: string;
    name: string;
  };
  parallel_tool_calls?: boolean;
  temperature?: number;
  top_p?: number;
  max_output_tokens?: number;
  max_tool_calls?: number;
  top_logprobs?: number;
  text?: {
    format?: {
      type: 'text' | 'json_object' | 'json_schema';
      name?: string;
      schema?: any;
    };
    verbosity?: 'low' | 'medium' | 'high';
  };
  reasoning?: {
    effort?: 'low' | 'medium' | 'high' | 'minimal' | 'xhigh';
    summary?: 'auto' | 'concise' | 'detailed';
    max_tokens?: number;
  };
  stream?: boolean;
  stream_options?: {
    include_obfuscation?: boolean;
  };
  store?: boolean;
  background?: boolean;
  previous_response_id?: string;
  conversation?: string | {
    id: string;
    [key: string]: any;
  };
  include?: string[];
  metadata?: Record<string, string>;
  safety_identifier?: string;
  prompt_cache_key?: string;
  prompt_cache_retention?: string;
  service_tier?: 'auto' | 'default' | 'flex' | 'priority';
  truncation?: 'auto' | 'disabled';
  
  // Internal tracking
  incomingApiType?: string;
  originalBody?: any;
}

// ============================================================================
// Response Type
// ============================================================================

export interface UnifiedResponsesResponse {
  id: string;
  object: 'response';
  created_at: number;
  completed_at?: number;
  status: 'completed' | 'failed' | 'in_progress' | 'cancelled' | 'queued' | 'incomplete';
  model: string;
  output: ResponsesOutputItem[];
  instructions?: string;
  temperature?: number;
  top_p?: number;
  max_output_tokens?: number;
  top_logprobs?: number;
  parallel_tool_calls?: boolean;
  tool_choice?: any;
  tools?: ResponsesTool[];
  text?: any;
  reasoning?: {
    effort?: string;
    summary?: string;
  };
  usage?: {
    input_tokens: number;
    input_tokens_details?: {
      cached_tokens: number;
    };
    output_tokens: number;
    output_tokens_details?: {
      reasoning_tokens: number;
    };
    total_tokens: number;
  };
  previous_response_id?: string;
  conversation?: any;
  store?: boolean;
  background?: boolean;
  truncation?: string;
  incomplete_details?: {
    reason: 'max_output_tokens' | 'content_filter';
  };
  error?: {
    message: string;
    type: string;
    code?: string;
    param?: string;
  };
  safety_identifier?: string;
  service_tier?: string;
  prompt_cache_key?: string;
  prompt_cache_retention?: string;
  metadata?: Record<string, string>;
  
  // Plexus metadata
  plexus?: {
    provider?: string;
    model?: string;
    apiType?: string;
    pricing?: any;
    providerDiscount?: number;
    canonicalModel?: string;
    config?: any;
  };
  
  // Internal
  rawResponse?: any;
  stream?: ReadableStream;
  bypassTransformation?: boolean;
}

export type ResponsesOutputItem = 
  | ResponsesMessageItem 
  | ResponsesFunctionCallItem 
  | ResponsesFunctionCallOutputItem 
  | ResponsesReasoningItem
  | ResponsesBuiltInToolCallItem;

export interface ResponsesBuiltInToolCallItem extends ResponsesInputItem {
  type: 'web_search_call' | 'file_search_call' | 'code_interpreter_call' | 'computer_call' | 'image_generation_call' | 'mcp_call';
  id: string;
  status: 'in_progress' | 'completed' | 'failed';
  [key: string]: any; // Tool-specific fields
}

// ============================================================================
// Streaming Types
// ============================================================================

export interface ResponsesStreamEvent {
  type: string;
  sequence_number: number;
  [key: string]: any;
}

export interface ResponsesCreatedEvent extends ResponsesStreamEvent {
  type: 'response.created';
  response: Partial<UnifiedResponsesResponse>;
}

export interface ResponsesOutputItemAddedEvent extends ResponsesStreamEvent {
  type: 'response.output_item.added';
  output_index: number;
  item: Partial<ResponsesOutputItem>;
}

export interface ResponsesOutputTextDeltaEvent extends ResponsesStreamEvent {
  type: 'response.output_text.delta';
  item_id: string;
  output_index: number;
  content_index: number;
  delta: string;
}

export interface ResponsesOutputTextDoneEvent extends ResponsesStreamEvent {
  type: 'response.output_text.done';
  item_id: string;
  output_index: number;
  content_index: number;
  text: string;
}

export interface ResponsesFunctionCallArgumentsDeltaEvent extends ResponsesStreamEvent {
  type: 'response.function_call_arguments.delta';
  item_id: string;
  output_index: number;
  delta: string;
}

export interface ResponsesFunctionCallArgumentsDoneEvent extends ResponsesStreamEvent {
  type: 'response.function_call_arguments.done';
  item_id: string;
  output_index: number;
  name: string;
  arguments: string;
}

export interface ResponsesCompletedEvent extends ResponsesStreamEvent {
  type: 'response.completed';
  response: UnifiedResponsesResponse;
}
```

---

## 4. Transformer Implementation

### 4.1 ResponsesTransformer

Create `packages/backend/src/transformers/responses.ts`:

#### 4.1.1 Core Structure

```typescript
import { Transformer } from "../types/transformer";
import { UnifiedResponsesRequest, UnifiedResponsesResponse, ResponsesStreamEvent } from "../types/responses";
import { UnifiedChatRequest, UnifiedChatResponse } from "../types/unified";
import { createParser } from "eventsource-parser";
import { encode } from "eventsource-encoder";

export class ResponsesTransformer implements Transformer {
  name = "responses";
  defaultEndpoint = "/responses";

  /**
   * Parses incoming Responses API request into unified format
   */
  async parseRequest(input: any): Promise<UnifiedResponsesRequest> {
    // Validate required fields
    if (!input.model) {
      throw new Error("Missing required field: model");
    }
    if (!input.input) {
      throw new Error("Missing required field: input");
    }

    // Normalize input to array format
    const normalizedInput = this.normalizeInput(input.input);

    return {
      requestId: input.requestId,
      model: input.model,
      input: normalizedInput,
      instructions: input.instructions,
      tools: input.tools,
      tool_choice: input.tool_choice || 'auto',
      parallel_tool_calls: input.parallel_tool_calls ?? true,
      temperature: input.temperature ?? 1.0,
      top_p: input.top_p ?? 1.0,
      max_output_tokens: input.max_output_tokens,
      max_tool_calls: input.max_tool_calls,
      top_logprobs: input.top_logprobs,
      text: input.text,
      reasoning: input.reasoning,
      stream: input.stream ?? false,
      stream_options: input.stream_options,
      store: input.store ?? true,
      background: input.background ?? false,
      previous_response_id: input.previous_response_id,
      conversation: input.conversation,
      include: input.include,
      metadata: input.metadata,
      safety_identifier: input.safety_identifier,
      prompt_cache_key: input.prompt_cache_key,
      prompt_cache_retention: input.prompt_cache_retention,
      service_tier: input.service_tier || 'auto',
      truncation: input.truncation || 'disabled',
      incomingApiType: 'responses',
      originalBody: input,
    };
  }

  /**
   * Normalizes input to array of items
   */
  private normalizeInput(input: string | any[]): any[] {
    if (typeof input === 'string') {
      // Convert simple string to message item
      return [{
        type: 'message',
        role: 'user',
        content: [{
          type: 'input_text',
          text: input
        }]
      }];
    }
    return input;
  }

  /**
   * Transforms Responses API request to Chat Completions format
   * This allows routing to providers that only support Chat Completions
   */
  async transformRequest(request: UnifiedResponsesRequest): Promise<UnifiedChatRequest> {
    // Convert input items to messages
    const messages = this.convertInputItemsToMessages(request.input as any[]);

    // Add instructions as system message if present
    if (request.instructions) {
      messages.unshift({
        role: 'system',
        content: request.instructions
      });
    }

    // Convert tools (filter out built-in tools that Chat Completions doesn't support)
    const tools = this.convertToolsForChatCompletions(request.tools || []);

    return {
      model: request.model,
      messages,
      max_tokens: request.max_output_tokens,
      temperature: request.temperature,
      stream: request.stream,
      tools: tools.length > 0 ? tools : undefined,
      tool_choice: this.convertToolChoiceForChatCompletions(request.tool_choice),
      reasoning: request.reasoning,
      response_format: request.text?.format ? {
        type: request.text.format.type,
        json_schema: request.text.format.schema
      } : undefined,
      metadata: request.metadata,
      incomingApiType: 'responses',
      originalBody: request.originalBody,
    };
  }

  /**
   * Converts Responses API input items to Chat Completions messages
   */
  private convertInputItemsToMessages(items: any[]): any[] {
    const messages: any[] = [];

    for (const item of items) {
      switch (item.type) {
        case 'message':
          messages.push({
            role: item.role,
            content: this.convertContentParts(item.content)
          });
          break;

        case 'function_call':
          // Add assistant message with tool call
          messages.push({
            role: 'assistant',
            content: null,
            tool_calls: [{
              id: item.call_id,
              type: 'function',
              function: {
                name: item.name,
                arguments: item.arguments
              }
            }]
          });
          break;

        case 'function_call_output':
          // Add tool message with result
          messages.push({
            role: 'tool',
            tool_call_id: item.call_id,
            content: typeof item.output === 'string' 
              ? item.output 
              : JSON.stringify(item.output)
          });
          break;

        case 'reasoning':
          // Convert reasoning to assistant message (limited support)
          if (item.summary && item.summary.length > 0) {
            const reasoningText = item.summary
              .map((part: any) => part.text)
              .join('\n');
            messages.push({
              role: 'assistant',
              content: reasoningText
            });
          }
          break;
      }
    }

    return messages;
  }

  /**
   * Converts Responses API content parts to Chat Completions format
   */
  private convertContentParts(parts: any[]): string | any[] {
    if (parts.length === 1 && parts[0].type === 'input_text') {
      return parts[0].text;
    }

    return parts.map(part => {
      switch (part.type) {
        case 'input_text':
        case 'output_text':
        case 'summary_text':
          return { type: 'text', text: part.text };
        
        case 'input_image':
          return {
            type: 'image_url',
            image_url: {
              url: part.image_url,
              detail: part.detail
            }
          };
        
        default:
          return part;
      }
    });
  }

  /**
   * Filters out built-in tools and converts function tools
   */
  private convertToolsForChatCompletions(tools: any[]): any[] {
    return tools
      .filter(tool => tool.type === 'function')
      .map(tool => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
          strict: tool.strict
        }
      }));
  }

  /**
   * Converts tool_choice to Chat Completions format
   */
  private convertToolChoiceForChatCompletions(toolChoice: any): any {
    if (typeof toolChoice === 'string') {
      return toolChoice;
    }
    if (toolChoice?.type === 'function') {
      return {
        type: 'function',
        function: { name: toolChoice.name }
      };
    }
    return 'auto';
  }

  /**
   * Transforms Chat Completions response to Responses API format
   */
  async transformResponse(response: UnifiedChatResponse): Promise<UnifiedResponsesResponse> {
    const outputItems = this.convertChatResponseToOutputItems(response);

    return {
      id: this.generateResponseId(),
      object: 'response',
      created_at: response.created || Math.floor(Date.now() / 1000),
      completed_at: Math.floor(Date.now() / 1000),
      status: 'completed',
      model: response.model,
      output: outputItems,
      usage: response.usage ? {
        input_tokens: response.usage.input_tokens,
        input_tokens_details: {
          cached_tokens: response.usage.cached_tokens
        },
        output_tokens: response.usage.output_tokens,
        output_tokens_details: {
          reasoning_tokens: response.usage.reasoning_tokens
        },
        total_tokens: response.usage.total_tokens
      } : undefined,
      plexus: response.plexus,
      rawResponse: response.rawResponse,
    };
  }

  /**
   * Converts Chat Completions response to output items array
   */
  private convertChatResponseToOutputItems(response: UnifiedChatResponse): any[] {
    const items: any[] = [];

    // Add reasoning if present
    if (response.reasoning_content) {
      items.push({
        type: 'reasoning',
        id: this.generateItemId('reason'),
        status: 'completed',
        summary: [{
          type: 'summary_text',
          text: response.reasoning_content
        }]
      });
    }

    // Add tool calls if present
    if (response.tool_calls && response.tool_calls.length > 0) {
      for (const toolCall of response.tool_calls) {
        items.push({
          type: 'function_call',
          id: this.generateItemId('fc'),
          status: 'completed',
          call_id: toolCall.id,
          name: toolCall.function.name,
          arguments: toolCall.function.arguments
        });
      }
    }

    // Add main message
    items.push({
      type: 'message',
      id: this.generateItemId('msg'),
      status: 'completed',
      role: 'assistant',
      content: [{
        type: 'output_text',
        text: response.content || '',
        annotations: response.annotations || []
      }]
    });

    return items;
  }

  /**
   * Formats Responses API response for client
   */
  async formatResponse(response: UnifiedResponsesResponse): Promise<any> {
    // Responses API format is already in the correct shape
    return response;
  }

  /**
   * Transforms streaming response from Chat Completions to Responses API SSE
   */
  transformStream(stream: ReadableStream): ReadableStream {
    const decoder = new TextDecoder();
    let sequenceNumber = 0;
    let responseId = this.generateResponseId();
    let currentItemId: string | null = null;
    let currentOutputIndex = 0;
    let accumulatedText = '';
    let accumulatedArgs = '';
    let toolCallName = '';

    return new ReadableStream({
      async start(controller) {
        // Send initial response.created event
        const createdEvent: ResponsesStreamEvent = {
          type: 'response.created',
          sequence_number: sequenceNumber++,
          response: {
            id: responseId,
            object: 'response',
            created_at: Math.floor(Date.now() / 1000),
            status: 'in_progress',
            output: []
          }
        };
        controller.enqueue(encode(createdEvent, { event: undefined }));

        const reader = stream.getReader();
        const parser = createParser((event) => {
          if (event.type === 'event') {
            if (event.data === '[DONE]') {
              // Send response.completed event
              const completedEvent: ResponsesStreamEvent = {
                type: 'response.completed',
                sequence_number: sequenceNumber++,
                response: {
                  id: responseId,
                  object: 'response',
                  status: 'completed',
                  completed_at: Math.floor(Date.now() / 1000)
                }
              };
              controller.enqueue(encode(completedEvent, { event: undefined }));
              controller.close();
              return;
            }

            try {
              const chunk = JSON.parse(event.data);
              
              // Handle Chat Completions streaming chunks
              if (chunk.choices && chunk.choices[0]) {
                const delta = chunk.choices[0].delta;

                // New message started
                if (!currentItemId) {
                  currentItemId = `msg_${Date.now()}`;
                  const addedEvent: ResponsesStreamEvent = {
                    type: 'response.output_item.added',
                    sequence_number: sequenceNumber++,
                    output_index: currentOutputIndex,
                    item: {
                      id: currentItemId,
                      type: 'message',
                      status: 'in_progress',
                      role: 'assistant',
                      content: []
                    }
                  };
                  controller.enqueue(encode(addedEvent, { event: undefined }));

                  // Add content part
                  const partEvent: ResponsesStreamEvent = {
                    type: 'response.content_part.added',
                    sequence_number: sequenceNumber++,
                    item_id: currentItemId,
                    output_index: currentOutputIndex,
                    content_index: 0,
                    part: { type: 'output_text' }
                  };
                  controller.enqueue(encode(partEvent, { event: undefined }));
                }

                // Text delta
                if (delta.content) {
                  accumulatedText += delta.content;
                  const textDelta: ResponsesStreamEvent = {
                    type: 'response.output_text.delta',
                    sequence_number: sequenceNumber++,
                    item_id: currentItemId,
                    output_index: currentOutputIndex,
                    content_index: 0,
                    delta: delta.content
                  };
                  controller.enqueue(encode(textDelta, { event: undefined }));
                }

                // Tool calls
                if (delta.tool_calls && delta.tool_calls[0]) {
                  const toolCall = delta.tool_calls[0];
                  
                  if (toolCall.function?.name) {
                    toolCallName = toolCall.function.name;
                    currentItemId = `fc_${Date.now()}`;
                    
                    const fcAddedEvent: ResponsesStreamEvent = {
                      type: 'response.output_item.added',
                      sequence_number: sequenceNumber++,
                      output_index: currentOutputIndex,
                      item: {
                        id: currentItemId,
                        type: 'function_call',
                        status: 'in_progress',
                        name: toolCallName
                      }
                    };
                    controller.enqueue(encode(fcAddedEvent, { event: undefined }));
                  }

                  if (toolCall.function?.arguments) {
                    accumulatedArgs += toolCall.function.arguments;
                    const argsDelta: ResponsesStreamEvent = {
                      type: 'response.function_call_arguments.delta',
                      sequence_number: sequenceNumber++,
                      item_id: currentItemId!,
                      output_index: currentOutputIndex,
                      delta: toolCall.function.arguments
                    };
                    controller.enqueue(encode(argsDelta, { event: undefined }));
                  }
                }

                // Finish reason
                if (chunk.choices[0].finish_reason) {
                  if (chunk.choices[0].finish_reason === 'tool_calls') {
                    // Tool call done
                    const fcDone: ResponsesStreamEvent = {
                      type: 'response.function_call_arguments.done',
                      sequence_number: sequenceNumber++,
                      item_id: currentItemId!,
                      output_index: currentOutputIndex,
                      name: toolCallName,
                      arguments: accumulatedArgs
                    };
                    controller.enqueue(encode(fcDone, { event: undefined }));
                  } else {
                    // Text done
                    const textDone: ResponsesStreamEvent = {
                      type: 'response.output_text.done',
                      sequence_number: sequenceNumber++,
                      item_id: currentItemId!,
                      output_index: currentOutputIndex,
                      content_index: 0,
                      text: accumulatedText
                    };
                    controller.enqueue(encode(textDone, { event: undefined }));
                  }

                  // Item done
                  const itemDone: ResponsesStreamEvent = {
                    type: 'response.output_item.done',
                    sequence_number: sequenceNumber++,
                    output_index: currentOutputIndex,
                    item: {
                      id: currentItemId!,
                      status: 'completed'
                    }
                  };
                  controller.enqueue(encode(itemDone, { event: undefined }));
                }
              }
            } catch (e) {
              console.error('Error parsing streaming chunk:', e);
            }
          }
        });

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            parser.feed(decoder.decode(value, { stream: true }));
          }
        } catch (error) {
          console.error('Stream reading error:', error);
          controller.error(error);
        }
      }
    });
  }

  /**
   * Generates unique response ID
   */
  private generateResponseId(): string {
    return `resp_${Date.now().toString(36)}${Math.random().toString(36).substring(2, 15)}`;
  }

  /**
   * Generates unique item ID with prefix
   */
  private generateItemId(prefix: string): string {
    return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).substring(2, 15)}`;
  }
}
```

### 4.2 Integration with TransformerFactory

Update `packages/backend/src/services/transformer-factory.ts`:

```typescript
import { ResponsesTransformer } from "../transformers/responses";

export class TransformerFactory {
  static getTransformer(type: string): any {
    const normalizedType = type.toLowerCase();
    
    switch (normalizedType) {
      case "responses":
        return new ResponsesTransformer();
      case "chat":
      case "completions":
        return new OpenAITransformer();
      // ... existing cases
      default:
        throw new Error(`Unknown transformer type: ${type}`);
    }
  }
}
```

---

## 5. API Route Implementation

### 5.1 Create Responses Route Handler

Create `packages/backend/src/routes/inference/responses.ts`:

```typescript
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Dispatcher } from '../../services/dispatcher';
import { UsageStorageService } from '../../services/usage-storage';
import { ResponsesStorageService } from '../../services/responses-storage';
import { logger } from '../../utils/logger';
import { ResponseHandler } from '../../services/response-handler';
import { v4 as uuidv4 } from 'uuid';

/**
 * Registers /v1/responses routes
 */
export async function registerResponsesRoutes(
  fastify: FastifyInstance,
  dispatcher: Dispatcher,
  usageStorage: UsageStorageService
) {
  const responsesStorage = new ResponsesStorageService();
  
  /**
   * POST /v1/responses
   * Creates a new response
   */
  fastify.post('/v1/responses', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as any;
    const requestId = uuidv4();

    try {
      // Parse incoming request
      const { ResponsesTransformer } = await import('../../transformers/responses');
      const transformer = new ResponsesTransformer();
      const unifiedRequest = await transformer.parseRequest({
        ...body,
        requestId,
        incomingApiType: 'responses'
      });

      // Check for previous_response_id and load context
      if (unifiedRequest.previous_response_id) {
        const previousResponse = await responsesStorage.getResponse(unifiedRequest.previous_response_id);
        if (!previousResponse) {
          return reply.code(404).send({
            error: {
              message: `Previous response not found: ${unifiedRequest.previous_response_id}`,
              type: 'invalid_request_error',
              code: 'response_not_found',
              param: 'previous_response_id'
            }
          });
        }

        // Prepend previous output items to input
        const previousItems = JSON.parse(previousResponse.output_items);
        unifiedRequest.input = [...previousItems, ...unifiedRequest.input as any[]];
      }

      // Check for conversation and load context
      if (unifiedRequest.conversation) {
        const conversationId = typeof unifiedRequest.conversation === 'string' 
          ? unifiedRequest.conversation 
          : unifiedRequest.conversation.id;
        
        const conversation = await responsesStorage.getConversation(conversationId);
        if (!conversation) {
          return reply.code(404).send({
            error: {
              message: `Conversation not found: ${conversationId}`,
              type: 'invalid_request_error',
              code: 'conversation_not_found',
              param: 'conversation'
            }
          });
        }

        // Prepend conversation items to input
        const conversationItems = JSON.parse(conversation.items);
        unifiedRequest.input = [...conversationItems, ...unifiedRequest.input as any[]];
      }

      // Dispatch request
      const startTime = Date.now();
      const unifiedResponse = await dispatcher.dispatch(unifiedRequest as any);
      const duration = Date.now() - startTime;

      // Store response if requested
      if (unifiedRequest.store !== false) {
        await responsesStorage.storeResponse(unifiedResponse, unifiedRequest);
      }

      // Update conversation if specified
      if (unifiedRequest.conversation) {
        const conversationId = typeof unifiedRequest.conversation === 'string'
          ? unifiedRequest.conversation
          : unifiedRequest.conversation.id;
        
        await responsesStorage.updateConversation(
          conversationId,
          unifiedResponse.output,
          unifiedRequest.input as any[]
        );
      }

      // Track usage
      await usageStorage.trackUsage(requestId, unifiedRequest, unifiedResponse, duration);

      // Handle streaming vs non-streaming
      if (unifiedRequest.stream) {
        return ResponseHandler.handleStreamingResponse(
          reply,
          unifiedResponse,
          transformer,
          requestId,
          usageStorage
        );
      } else {
        const formattedResponse = await transformer.formatResponse(unifiedResponse);
        return reply.send(formattedResponse);
      }

    } catch (error: any) {
      logger.error('Error in /v1/responses:', error);
      
      const statusCode = error.routingContext?.statusCode || 500;
      return reply.code(statusCode).send({
        error: {
          message: error.message || 'Internal server error',
          type: statusCode >= 500 ? 'server_error' : 'invalid_request_error',
          ...(error.routingContext && {
            routing_context: {
              provider: error.routingContext.provider,
              target_model: error.routingContext.targetModel,
              target_api_type: error.routingContext.targetApiType
            }
          })
        }
      });
    }
  });

  /**
   * GET /v1/responses/:response_id
   * Retrieves a stored response
   */
  fastify.get('/v1/responses/:response_id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { response_id } = request.params as { response_id: string };

    try {
      const response = await responsesStorage.getResponse(response_id);
      
      if (!response) {
        return reply.code(404).send({
          error: {
            message: `Response not found: ${response_id}`,
            type: 'invalid_request_error',
            code: 'response_not_found'
          }
        });
      }

      return reply.send(responsesStorage.formatStoredResponse(response));
    } catch (error: any) {
      logger.error(`Error retrieving response ${response_id}:`, error);
      return reply.code(500).send({
        error: {
          message: 'Internal server error',
          type: 'server_error'
        }
      });
    }
  });

  /**
   * DELETE /v1/responses/:response_id
   * Deletes a stored response
   */
  fastify.delete('/v1/responses/:response_id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { response_id } = request.params as { response_id: string };

    try {
      const deleted = await responsesStorage.deleteResponse(response_id);
      
      if (!deleted) {
        return reply.code(404).send({
          error: {
            message: `Response not found: ${response_id}`,
            type: 'invalid_request_error',
            code: 'response_not_found'
          }
        });
      }

      return reply.send({ deleted: true, id: response_id });
    } catch (error: any) {
      logger.error(`Error deleting response ${response_id}:`, error);
      return reply.code(500).send({
        error: {
          message: 'Internal server error',
          type: 'server_error'
        }
      });
    }
  });

  /**
   * GET /v1/conversations/:conversation_id
   * Retrieves a conversation
   */
  fastify.get('/v1/conversations/:conversation_id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { conversation_id } = request.params as { conversation_id: string };

    try {
      const conversation = await responsesStorage.getConversation(conversation_id);
      
      if (!conversation) {
        return reply.code(404).send({
          error: {
            message: `Conversation not found: ${conversation_id}`,
            type: 'invalid_request_error',
            code: 'conversation_not_found'
          }
        });
      }

      return reply.send(responsesStorage.formatStoredConversation(conversation));
    } catch (error: any) {
      logger.error(`Error retrieving conversation ${conversation_id}:`, error);
      return reply.code(500).send({
        error: {
          message: 'Internal server error',
          type: 'server_error'
        }
      });
    }
  });
}
```

### 5.2 Register Routes in Main Router

Update `packages/backend/src/routes/inference/index.ts`:

```typescript
import { registerResponsesRoutes } from './responses';

export async function registerInferenceRoutes(
  fastify: FastifyInstance,
  dispatcher: Dispatcher,
  usageStorage: UsageStorageService
) {
  // ... existing routes
  
  // Responses API
  await registerResponsesRoutes(fastify, dispatcher, usageStorage);
}
```

---

## 6. Storage Service Implementation

### 6.1 ResponsesStorageService

Create `packages/backend/src/services/responses-storage.ts`:

```typescript
import { getDatabase } from '../db/client';
import * as schema from '../../drizzle/schema';
import { eq, desc } from 'drizzle-orm';
import { logger } from '../utils/logger';

export class ResponsesStorageService {
  private db = getDatabase();

  /**
   * Stores a response in the database
   */
  async storeResponse(response: any, request: any): Promise<void> {
    try {
      const responseRecord = {
        id: response.id,
        object: 'response',
        created_at: response.created_at,
        completed_at: response.completed_at,
        status: response.status,
        model: response.model,
        output_items: JSON.stringify(response.output),
        instructions: request.instructions || null,
        temperature: request.temperature,
        top_p: request.top_p,
        max_output_tokens: request.max_output_tokens,
        top_logprobs: request.top_logprobs,
        parallel_tool_calls: request.parallel_tool_calls ? 1 : 0,
        tool_choice: request.tool_choice ? JSON.stringify(request.tool_choice) : null,
        tools: request.tools ? JSON.stringify(request.tools) : null,
        text_config: request.text ? JSON.stringify(request.text) : null,
        reasoning_config: request.reasoning ? JSON.stringify(request.reasoning) : null,
        usage_input_tokens: response.usage?.input_tokens || 0,
        usage_output_tokens: response.usage?.output_tokens || 0,
        usage_reasoning_tokens: response.usage?.output_tokens_details?.reasoning_tokens || 0,
        usage_cached_tokens: response.usage?.input_tokens_details?.cached_tokens || 0,
        usage_total_tokens: response.usage?.total_tokens || 0,
        previous_response_id: request.previous_response_id || null,
        conversation_id: typeof request.conversation === 'string' 
          ? request.conversation 
          : request.conversation?.id || null,
        store: request.store !== false ? 1 : 0,
        background: request.background ? 1 : 0,
        truncation: request.truncation || 'disabled',
        incomplete_details: response.incomplete_details ? JSON.stringify(response.incomplete_details) : null,
        error: response.error ? JSON.stringify(response.error) : null,
        safety_identifier: request.safety_identifier || null,
        service_tier: request.service_tier || 'auto',
        prompt_cache_key: request.prompt_cache_key || null,
        prompt_cache_retention: request.prompt_cache_retention || null,
        metadata: request.metadata ? JSON.stringify(request.metadata) : null,
        plexus_provider: response.plexus?.provider || null,
        plexus_target_model: response.plexus?.model || null,
        plexus_api_type: response.plexus?.apiType || null,
        plexus_canonical_model: response.plexus?.canonicalModel || null,
      };

      await this.db.insert(schema.responses).values(responseRecord);

      // Store individual output items for efficient querying
      for (let i = 0; i < response.output.length; i++) {
        const item = response.output[i];
        await this.db.insert(schema.responseItems).values({
          id: item.id,
          response_id: response.id,
          item_index: i,
          item_type: item.type,
          item_data: JSON.stringify(item)
        });
      }

      logger.debug(`Stored response ${response.id}`);
    } catch (error) {
      logger.error('Error storing response:', error);
      throw error;
    }
  }

  /**
   * Retrieves a response from the database
   */
  async getResponse(responseId: string): Promise<any | null> {
    try {
      const results = await this.db
        .select()
        .from(schema.responses)
        .where(eq(schema.responses.id, responseId))
        .limit(1);

      return results[0] || null;
    } catch (error) {
      logger.error(`Error retrieving response ${responseId}:`, error);
      throw error;
    }
  }

  /**
   * Deletes a response from the database
   */
  async deleteResponse(responseId: string): Promise<boolean> {
    try {
      const result = await this.db
        .delete(schema.responses)
        .where(eq(schema.responses.id, responseId));

      return true;
    } catch (error) {
      logger.error(`Error deleting response ${responseId}:`, error);
      throw error;
    }
  }

  /**
   * Creates or updates a conversation
   */
  async updateConversation(
    conversationId: string,
    outputItems: any[],
    inputItems: any[]
  ): Promise<void> {
    try {
      // Check if conversation exists
      const existing = await this.db
        .select()
        .from(schema.conversations)
        .where(eq(schema.conversations.id, conversationId))
        .limit(1);

      const now = Math.floor(Date.now() / 1000);
      const allItems = [...inputItems, ...outputItems];

      if (existing.length === 0) {
        // Create new conversation
        await this.db.insert(schema.conversations).values({
          id: conversationId,
          created_at: now,
          updated_at: now,
          items: JSON.stringify(allItems),
          metadata: null
        });
      } else {
        // Update existing conversation
        const existingItems = JSON.parse(existing[0].items);
        const updatedItems = [...existingItems, ...allItems];

        await this.db
          .update(schema.conversations)
          .set({
            updated_at: now,
            items: JSON.stringify(updatedItems)
          })
          .where(eq(schema.conversations.id, conversationId));
      }

      logger.debug(`Updated conversation ${conversationId}`);
    } catch (error) {
      logger.error(`Error updating conversation ${conversationId}:`, error);
      throw error;
    }
  }

  /**
   * Retrieves a conversation
   */
  async getConversation(conversationId: string): Promise<any | null> {
    try {
      const results = await this.db
        .select()
        .from(schema.conversations)
        .where(eq(schema.conversations.id, conversationId))
        .limit(1);

      return results[0] || null;
    } catch (error) {
      logger.error(`Error retrieving conversation ${conversationId}:`, error);
      throw error;
    }
  }

  /**
   * Formats stored response for API output
   */
  formatStoredResponse(record: any): any {
    return {
      id: record.id,
      object: 'response',
      created_at: record.created_at,
      completed_at: record.completed_at,
      status: record.status,
      model: record.model,
      output: JSON.parse(record.output_items),
      instructions: record.instructions,
      temperature: record.temperature,
      top_p: record.top_p,
      max_output_tokens: record.max_output_tokens,
      top_logprobs: record.top_logprobs,
      parallel_tool_calls: record.parallel_tool_calls === 1,
      tool_choice: record.tool_choice ? JSON.parse(record.tool_choice) : undefined,
      tools: record.tools ? JSON.parse(record.tools) : undefined,
      text: record.text_config ? JSON.parse(record.text_config) : undefined,
      reasoning: record.reasoning_config ? JSON.parse(record.reasoning_config) : undefined,
      usage: {
        input_tokens: record.usage_input_tokens,
        input_tokens_details: {
          cached_tokens: record.usage_cached_tokens
        },
        output_tokens: record.usage_output_tokens,
        output_tokens_details: {
          reasoning_tokens: record.usage_reasoning_tokens
        },
        total_tokens: record.usage_total_tokens
      },
      previous_response_id: record.previous_response_id,
      conversation: record.conversation_id,
      store: record.store === 1,
      background: record.background === 1,
      truncation: record.truncation,
      incomplete_details: record.incomplete_details ? JSON.parse(record.incomplete_details) : undefined,
      error: record.error ? JSON.parse(record.error) : undefined,
      safety_identifier: record.safety_identifier,
      service_tier: record.service_tier,
      prompt_cache_key: record.prompt_cache_key,
      prompt_cache_retention: record.prompt_cache_retention,
      metadata: record.metadata ? JSON.parse(record.metadata) : undefined
    };
  }

  /**
   * Formats stored conversation for API output
   */
  formatStoredConversation(record: any): any {
    return {
      id: record.id,
      object: 'conversation',
      created_at: record.created_at,
      updated_at: record.updated_at,
      items: JSON.parse(record.items),
      metadata: record.metadata ? JSON.parse(record.metadata) : undefined
    };
  }
}
```

---

## 7. Implementation Phases

### Phase 1: Foundation (Weeks 1-2)
- [ ] **Database Schema**
  - [ ] Create Drizzle schema definitions for `responses`, `conversations`, `response_items`
  - [ ] Generate migrations for SQLite and PostgreSQL
  - [ ] Test migrations in development environment
  - [ ] Add indexes for performance

- [ ] **Type Definitions**
  - [ ] Create `packages/backend/src/types/responses.ts` with all Responses API types
  - [ ] Add streaming event types
  - [ ] Update `unified.ts` for compatibility

- [ ] **Storage Service**
  - [ ] Implement `ResponsesStorageService` with CRUD operations
  - [ ] Add response storage methods
  - [ ] Add conversation management methods
  - [ ] Write unit tests for storage service

### Phase 2: Core Transformer (Weeks 3-4)
- [ ] **ResponsesTransformer**
  - [ ] Implement `parseRequest()` for incoming Responses API requests
  - [ ] Implement `transformRequest()` to convert to Chat Completions format
  - [ ] Implement `transformResponse()` to convert from Chat Completions to Responses format
  - [ ] Implement input item to message conversion
  - [ ] Implement output item generation from Chat Completions response
  - [ ] Add tool conversion logic (function tools only, filter built-in tools)
  - [ ] Write unit tests for all transformations

- [ ] **TransformerFactory Integration**
  - [ ] Add `responses` case to TransformerFactory
  - [ ] Test transformer selection logic

### Phase 3: API Routes (Week 5)
- [ ] **POST /v1/responses**
  - [ ] Implement request parsing
  - [ ] Add `previous_response_id` context loading
  - [ ] Add `conversation` context loading
  - [ ] Integrate with Dispatcher
  - [ ] Add response storage logic
  - [ ] Add conversation update logic
  - [ ] Add usage tracking
  - [ ] Add error handling

- [ ] **GET /v1/responses/:response_id**
  - [ ] Implement response retrieval
  - [ ] Format stored response for output
  - [ ] Add error handling

- [ ] **DELETE /v1/responses/:response_id**
  - [ ] Implement response deletion
  - [ ] Add cascade delete for items
  - [ ] Add error handling

- [ ] **GET /v1/conversations/:conversation_id**
  - [ ] Implement conversation retrieval
  - [ ] Format stored conversation for output
  - [ ] Add error handling

### Phase 4: Streaming Support (Week 6)
- [ ] **Stream Transformation**
  - [ ] Implement `transformStream()` in ResponsesTransformer
  - [ ] Add sequence number tracking
  - [ ] Implement `response.created` event
  - [ ] Implement `response.output_item.added` event
  - [ ] Implement `response.content_part.added` event
  - [ ] Implement `response.output_text.delta` event
  - [ ] Implement `response.output_text.done` event
  - [ ] Implement `response.function_call_arguments.delta` event
  - [ ] Implement `response.function_call_arguments.done` event
  - [ ] Implement `response.output_item.done` event
  - [ ] Implement `response.completed` event
  - [ ] Test streaming with Chat Completions backend

- [ ] **Stream Usage Tracking**
  - [ ] Accumulate usage from streaming chunks
  - [ ] Track final usage in database
  - [ ] Test usage accuracy

### Phase 5: Provider-Specific Transformations (Weeks 7-8)
- [ ] **Anthropic Messages Support**
  - [ ] Implement Responses → Messages transformation
  - [ ] Implement Messages → Responses transformation
  - [ ] Test with Claude models
  - [ ] Test tool use with Anthropic

- [ ] **Backward Compatibility Testing**
  - [ ] Test pass-through optimization when Responses → Responses
  - [ ] Test transformation when Responses → Chat Completions
  - [ ] Test transformation when Responses → Messages
  - [ ] Verify metadata preservation

### Phase 6: Testing & Documentation (Weeks 9-10)
- [ ] **Integration Tests**
  - [ ] Test simple text request/response
  - [ ] Test multi-turn with `previous_response_id`
  - [ ] Test conversations
  - [ ] Test function calling
  - [ ] Test streaming
  - [ ] Test error handling
  - [ ] Test response retrieval
  - [ ] Test conversation retrieval
  - [ ] Test response deletion

- [ ] **Documentation**
  - [ ] Update README with Responses API support
  - [ ] Add Responses API examples to docs
  - [ ] Document multi-turn conversation patterns
  - [ ] Document function calling patterns
  - [ ] Add streaming examples
  - [ ] Document limitations (no built-in tools initially)

- [ ] **Configuration**
  - [ ] Add example Responses API models to plexus.yaml
  - [ ] Document access_via configuration for responses

---

## 8. Testing Strategy

### 8.1 Unit Tests

Create `packages/backend/src/transformers/responses.test.ts`:

```typescript
import { describe, test, expect } from 'bun:test';
import { ResponsesTransformer } from './responses';

describe('ResponsesTransformer', () => {
  const transformer = new ResponsesTransformer();

  describe('parseRequest', () => {
    test('should parse simple string input', async () => {
      const input = {
        model: 'gpt-4o',
        input: 'Hello, world!'
      };

      const result = await transformer.parseRequest(input);

      expect(result.model).toBe('gpt-4o');
      expect(Array.isArray(result.input)).toBe(true);
      expect(result.input[0].type).toBe('message');
      expect(result.input[0].role).toBe('user');
      expect(result.input[0].content[0].type).toBe('input_text');
      expect(result.input[0].content[0].text).toBe('Hello, world!');
    });

    test('should parse array input', async () => {
      const input = {
        model: 'gpt-4o',
        input: [
          {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'Hello' }]
          }
        ]
      };

      const result = await transformer.parseRequest(input);

      expect(result.input).toEqual(input.input);
    });

    test('should apply defaults', async () => {
      const input = {
        model: 'gpt-4o',
        input: 'Test'
      };

      const result = await transformer.parseRequest(input);

      expect(result.temperature).toBe(1.0);
      expect(result.top_p).toBe(1.0);
      expect(result.parallel_tool_calls).toBe(true);
      expect(result.store).toBe(true);
      expect(result.background).toBe(false);
      expect(result.stream).toBe(false);
      expect(result.tool_choice).toBe('auto');
      expect(result.service_tier).toBe('auto');
      expect(result.truncation).toBe('disabled');
    });
  });

  describe('transformRequest', () => {
    test('should convert to Chat Completions format', async () => {
      const request = {
        model: 'gpt-4o',
        input: [
          {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'Hello' }]
          }
        ],
        instructions: 'You are helpful',
        max_output_tokens: 100,
        temperature: 0.7
      };

      const result = await transformer.transformRequest(request as any);

      expect(result.model).toBe('gpt-4o');
      expect(result.messages[0].role).toBe('system');
      expect(result.messages[0].content).toBe('You are helpful');
      expect(result.messages[1].role).toBe('user');
      expect(result.messages[1].content).toBe('Hello');
      expect(result.max_tokens).toBe(100);
      expect(result.temperature).toBe(0.7);
    });

    test('should convert function call items to messages', async () => {
      const request = {
        model: 'gpt-4o',
        input: [
          {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'What is the weather?' }]
          },
          {
            type: 'function_call',
            call_id: 'call_123',
            name: 'get_weather',
            arguments: '{"location":"SF"}'
          },
          {
            type: 'function_call_output',
            call_id: 'call_123',
            output: { text: 'Sunny, 72°F' }
          }
        ]
      };

      const result = await transformer.transformRequest(request as any);

      expect(result.messages.length).toBe(3);
      expect(result.messages[1].role).toBe('assistant');
      expect(result.messages[1].tool_calls[0].id).toBe('call_123');
      expect(result.messages[2].role).toBe('tool');
      expect(result.messages[2].tool_call_id).toBe('call_123');
    });

    test('should filter out built-in tools', async () => {
      const request = {
        model: 'gpt-4o',
        input: 'Test',
        tools: [
          {
            type: 'function',
            name: 'my_function',
            description: 'My custom function',
            parameters: { type: 'object', properties: {} }
          },
          {
            type: 'web_search'
          }
        ]
      };

      const result = await transformer.transformRequest(request as any);

      expect(result.tools?.length).toBe(1);
      expect(result.tools![0].type).toBe('function');
      expect(result.tools![0].function.name).toBe('my_function');
    });
  });

  describe('transformResponse', () => {
    test('should convert Chat Completions to Responses format', async () => {
      const response = {
        id: 'chatcmpl-123',
        model: 'gpt-4o',
        created: 1234567890,
        content: 'Hello, how can I help?',
        usage: {
          input_tokens: 10,
          output_tokens: 20,
          total_tokens: 30,
          reasoning_tokens: 0,
          cached_tokens: 0,
          cache_creation_tokens: 0
        }
      };

      const result = await transformer.transformResponse(response as any);

      expect(result.object).toBe('response');
      expect(result.status).toBe('completed');
      expect(result.output.length).toBe(1);
      expect(result.output[0].type).toBe('message');
      expect(result.output[0].role).toBe('assistant');
      expect(result.output[0].content[0].type).toBe('output_text');
      expect(result.output[0].content[0].text).toBe('Hello, how can I help?');
      expect(result.usage?.input_tokens).toBe(10);
      expect(result.usage?.output_tokens).toBe(20);
    });

    test('should include reasoning content', async () => {
      const response = {
        id: 'chatcmpl-123',
        model: 'o1',
        content: 'Answer is 42',
        reasoning_content: 'First, I analyzed...',
        usage: {
          input_tokens: 10,
          output_tokens: 20,
          total_tokens: 30,
          reasoning_tokens: 15,
          cached_tokens: 0,
          cache_creation_tokens: 0
        }
      };

      const result = await transformer.transformResponse(response as any);

      expect(result.output.length).toBe(2);
      expect(result.output[0].type).toBe('reasoning');
      expect(result.output[0].summary[0].text).toBe('First, I analyzed...');
      expect(result.output[1].type).toBe('message');
    });

    test('should include tool calls', async () => {
      const response = {
        id: 'chatcmpl-123',
        model: 'gpt-4o',
        content: null,
        tool_calls: [
          {
            id: 'call_123',
            type: 'function',
            function: {
              name: 'get_weather',
              arguments: '{"location":"SF"}'
            }
          }
        ],
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          total_tokens: 15,
          reasoning_tokens: 0,
          cached_tokens: 0,
          cache_creation_tokens: 0
        }
      };

      const result = await transformer.transformResponse(response as any);

      expect(result.output.length).toBe(2);
      expect(result.output[0].type).toBe('function_call');
      expect(result.output[0].call_id).toBe('call_123');
      expect(result.output[0].name).toBe('get_weather');
    });
  });
});
```

### 8.2 Integration Tests

Create test scripts in `testcommands/` directory:

```bash
# testcommands/test-responses-simple.ts
# Simple text request
bun run testcommands/test-responses-simple.ts

# testcommands/test-responses-multiturn.ts
# Multi-turn conversation with previous_response_id
bun run testcommands/test-responses-multiturn.ts

# testcommands/test-responses-streaming.ts
# Streaming response
bun run testcommands/test-responses-streaming.ts

# testcommands/test-responses-tools.ts
# Function calling
bun run testcommands/test-responses-tools.ts
```

---

## 9. Configuration Examples

### 9.1 plexus.yaml Configuration

```yaml
providers:
  openai:
    api_base_url:
      chat: "https://api.openai.com/v1"
      responses: "https://api.openai.com/v1"
    api_key: "${OPENAI_API_KEY}"
    
    models:
      gpt-4o:
        access_via: ["chat", "responses"]
        pricing:
          input: 0.005
          output: 0.015
      
      o1:
        access_via: ["chat", "responses"]
        pricing:
          input: 0.015
          output: 0.060

  anthropic:
    api_base_url: "https://api.anthropic.com/v1"
    api_key: "${ANTHROPIC_API_KEY}"
    
    models:
      claude-3-5-sonnet-20241022:
        access_via: ["messages", "responses"]
        pricing:
          input: 0.003
          output: 0.015

model_aliases:
  gpt-4o-responses:
    - provider: openai
      model: gpt-4o
      access_via: responses
  
  claude-responses:
    - provider: anthropic
      model: claude-3-5-sonnet-20241022
```

---

## 10. Limitations & Future Work

### 10.1 Phase 1 Limitations

The initial implementation will **NOT** include:

1. **Built-in Tools** (Deferred to Phase 2)
   - Web search (`web_search`)
   - File search (`file_search`)
   - Code interpreter (`code_interpreter`)
   - Computer use (`computer_use`)
   - Image generation tool (within Responses API)

2. **MCP Integration** (Deferred to Phase 3)
   - Remote MCP server support
   - MCP tool discovery
   - MCP tool execution

3. **Background Processing** (Deferred)
   - `background: true` for async responses
   - Response cancellation endpoint

4. **Advanced Features** (Deferred)
   - Conversation compaction
   - Response input items listing
   - Prompt caching integration
   - Service tier routing

### 10.2 Phase 2: Built-in Tools (Future)

**Estimated Timeline:** 4-6 weeks

Implement built-in tool support:

1. **Web Search Tool**
   - Integrate with Tavily or similar search API
   - Return `web_search_call` output items
   - Support `include: ["web_search_call.action.sources"]`

2. **Code Interpreter Tool**
   - Integrate Python execution sandbox (e.g., E2B, Modal)
   - Support code execution and output capture
   - Return `code_interpreter_call` items with logs and images

3. **File Search Tool**
   - Integrate vector database (e.g., Pinecone, Weaviate)
   - Support file upload and vector store creation
   - Return `file_search_call` items with citations

### 10.3 Phase 3: MCP Integration (Future)

**Estimated Timeline:** 6-8 weeks

Implement Model Context Protocol support:

1. **MCP Client**
   - SSE transport for remote MCP servers
   - Tool discovery from MCP servers
   - Tool invocation with approval flow

2. **MCP Server Integration**
   - Connect to user-configured MCP servers
   - Dynamic tool registration
   - Return `mcp_call` output items

---

## 11. Success Criteria

### 11.1 Functional Requirements

- [ ] POST /v1/responses accepts valid requests and returns responses
- [ ] Simple text requests work correctly
- [ ] Multi-turn conversations with `previous_response_id` work
- [ ] Conversation management works correctly
- [ ] Function calling (custom tools) works with Responses API
- [ ] Streaming returns correct SSE events with sequence numbers
- [ ] Responses are stored and retrievable via GET endpoint
- [ ] Responses can be deleted via DELETE endpoint
- [ ] Errors are handled gracefully with correct status codes
- [ ] Usage tracking works for Responses API requests

### 11.2 Performance Requirements

- [ ] Response storage adds < 50ms latency
- [ ] Response retrieval takes < 100ms
- [ ] Conversation context loading takes < 200ms
- [ ] Streaming latency is comparable to Chat Completions API
- [ ] Database queries use proper indexes

### 11.3 Compatibility Requirements

- [ ] Works with OpenAI models via Chat Completions backend
- [ ] Works with Anthropic models via Messages backend
- [ ] Pass-through optimization works when provider supports Responses API
- [ ] Backward compatible with existing Plexus features (cooldowns, pricing, usage tracking)
- [ ] Plexus metadata is preserved and attached to responses

---

## 12. Risk Analysis & Mitigation

### 12.1 High-Risk Areas

| Risk | Impact | Mitigation |
|------|--------|------------|
| **Streaming Complexity** | High - Complex event mapping from Chat Completions to Responses SSE format | - Extensive unit tests for stream transformation<br>- Test with multiple providers<br>- Reference OpenAI SDK streaming implementation |
| **State Management** | High - Incorrect conversation state could corrupt multi-turn sessions | - Thorough testing of `previous_response_id` and `conversation` logic<br>- Add database integrity checks<br>- Implement state validation |
| **Database Performance** | Medium - Large response storage could slow down API | - Use proper indexes<br>- Implement pagination for conversation listing<br>- Add response TTL/cleanup job |
| **Provider Compatibility** | Medium - Not all providers support all Responses API features | - Clearly document limitations per provider<br>- Add validation for unsupported features<br>- Return helpful error messages |
| **Type Safety** | Medium - Complex nested types could lead to runtime errors | - Comprehensive TypeScript types<br>- Zod validation for incoming requests<br>- Unit tests for type conversions |

### 12.2 Testing Strategy to Mitigate Risks

1. **Unit Tests:** Cover all transformation logic with edge cases
2. **Integration Tests:** Test end-to-end flows with real provider APIs
3. **Load Tests:** Verify database performance under concurrent requests
4. **Streaming Tests:** Validate event ordering and completeness
5. **Multi-turn Tests:** Verify conversation state integrity

---

## 13. Development Workflow

### 13.1 Git Branch Strategy

```bash
# Create feature branch
git checkout -b feature/responses-api

# Create sub-branches for each phase
git checkout -b feature/responses-api/phase1-foundation
git checkout -b feature/responses-api/phase2-transformer
git checkout -b feature/responses-api/phase3-routes
# etc.
```

### 13.2 Testing Commands

```bash
# Run unit tests
bun test packages/backend/src/transformers/responses.test.ts

# Run integration tests
bun run testcommands/test-responses-simple.ts
bun run testcommands/test-responses-multiturn.ts
bun run testcommands/test-responses-streaming.ts

# Run all tests
bun test

# Type check
cd packages/backend && bun run tsc --noEmit
```

### 13.3 Migration Commands

```bash
# Generate migrations
cd packages/backend
bunx drizzle-kit generate
bunx drizzle-kit generate --config drizzle.config.pg.ts

# View migrations
cat drizzle/migrations/XXXX_responses_api.sql
cat drizzle/migrations_pg/XXXX_responses_api.sql

# Apply migrations (automatic on startup)
bun run dev
```

---

## 14. Documentation Updates

### 14.1 README.md Updates

Add section to main README:

```markdown
## Responses API Support

Plexus now supports the OpenAI Responses API (`/v1/responses`), the next-generation interface for building agentic applications.

### Key Features

- **Stateful Conversations:** Use `previous_response_id` or `conversation` for multi-turn interactions
- **Structured Output:** Item-based input/output system with better traceability
- **Function Calling:** Full support for custom function tools
- **Streaming:** Rich SSE events with sequence numbers
- **Response Storage:** Automatic storage and retrieval of responses

### Example Usage

**Simple Request:**
```bash
curl -X POST http://localhost:4000/v1/responses \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o",
    "input": "Tell me a short story about a robot."
  }'
```

**Multi-turn Conversation:**
```bash
# First request
curl -X POST http://localhost:4000/v1/responses \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o",
    "input": "What is 2+2?"
  }'

# Second request (using previous response ID)
curl -X POST http://localhost:4000/v1/responses \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o",
    "previous_response_id": "resp_xxx",
    "input": "Now multiply that by 3."
  }'
```

### Limitations

- Built-in tools (web_search, file_search, code_interpreter) are not yet supported
- MCP integration is not yet available
- Background processing is not yet implemented
```

---

## 15. Conclusion

This implementation plan provides a comprehensive roadmap for adding OpenAI Responses API support to Plexus. The phased approach allows for incremental development and testing, with the initial phase focusing on core functionality (text generation, function calling, multi-turn conversations, streaming) and deferring advanced features (built-in tools, MCP) to future phases.

**Estimated Total Timeline:** 8-10 weeks for Phase 1 (core implementation)

**Next Steps:**
1. Review and approve this plan
2. Begin Phase 1: Foundation (database schema and types)
3. Set up CI/CD pipeline for automated testing
4. Schedule regular progress reviews

---

**Document Version:** 1.0  
**Last Updated:** 2026-02-03  
**Author:** OpenCode AI Assistant  
**Status:** Draft for Review
