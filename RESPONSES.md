# OpenAI Responses API Implementation Guide

This document provides comprehensive documentation for implementing the `/v1/responses` API, based on the OpenAI Responses API specification. This guide details all expected inputs, output formats, transformations, and mappings required to implement a compatible API.

## Overview

The OpenAI Responses API is an advanced interface for generating model responses that supports text and image inputs, text outputs, stateful multi-turn conversations, and tool integration. Unlike the Chat Completions API, the Responses API uses a structured item-based input/output system that provides better traceability and state management.

## HTTP Endpoint

**POST** `/v1/responses`

The API accepts JSON request bodies and returns JSON responses. When streaming is enabled, it returns Server-Sent Events (SSE).

---

## Request Structure

### Top-Level Request Fields

A request to the Responses API consists of the following fields:

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `model` | string | Yes* | - | The model ID to use for generation (e.g., "gpt-4o", "o3"). Models with different capabilities and price points are available. |
| `input` | string or array | Yes | - | Text, image, or file inputs to generate a response. Can be a simple string or an array of structured input items. |
| `instructions` | string | No | null | A system or developer message inserted into the model's context. Does not carry over when using `previous_response_id`. |
| `tools` | array | No | [] | An array of tools the model may call. Supports built-in tools, MCP tools, and custom function calls. |
| `tool_choice` | string or object | No | "auto" | How the model should select which tool(s) to use. Can be "none", "auto", "required", or a specific tool specification. |
| `parallel_tool_calls` | boolean | No | true | Whether to allow the model to run tool calls in parallel. |
| `temperature` | number | No | 1 | Sampling temperature between 0 and 2. Higher values (0.8) make output more random; lower values (0.2) make it more focused. |
| `top_p` | number | No | 1 | Nucleus sampling parameter. Considers tokens with top_p probability mass. Recommend changing either this or temperature, not both. |
| `max_output_tokens` | integer | No | null | Upper bound for total tokens generated (including visible output and reasoning tokens). |
| `max_tool_calls` | integer | No | null | Maximum total calls to built-in tools in a response. Further attempts are ignored. |
| `top_logprobs` | integer | No | null | Number between 0 and 20 specifying most likely tokens to return with log probabilities. |
| `text` | object | No | null | Configuration options for text response format (plain text or structured JSON). |
| `reasoning` | object | No | null | Configuration for reasoning models (gpt-5 and o-series only). |
| `stream` | boolean | No | false | If true, response is streamed using Server-Sent Events. |
| `stream_options` | object | No | null | Options for streaming responses (only when stream=true). |
| `store` | boolean | No | true | Whether to store the response for later retrieval via API. |
| `background` | boolean | No | false | Whether to run the response generation in the background. |
| `previous_response_id` | string | No | null | Unique ID of a previous response to continue a multi-turn conversation. Cannot use with `conversation`. |
| `conversation` | string or object | No | null | The conversation this response belongs to. Items from the conversation are prepended to input_items. |
| `include` | array | No | null | Additional output data to include (e.g., "web_search_call.action.sources", "file_search_call.results"). |
| `metadata` | map | No | {} | 16 key-value pairs (keys max 64 chars, values max 512 chars) for storing additional information. |
| `user` | string | No | null | **Deprecated** - being replaced by `safety_identifier` and `prompt_cache_key`. |
| `safety_identifier` | string | No | null | Stable identifier for detecting policy violations. Recommend hashing username or email. |
| `prompt_cache_key` | string | No | null | Used for caching responses to similar requests. Replaces the `user` field. |
| `prompt_cache_retention` | string | No | null | Retention policy for prompt cache. Set to "24h" for extended caching (max 24 hours). |
| `service_tier` | string | No | "auto" | Processing type: "auto" (project settings), "default" (standard pricing/performance), "flex" (flex processing), or "priority" (priority processing). |
| `truncation` | string | No | "disabled" | Truncation strategy: "auto" (truncate from conversation start if exceeds context), "disabled" (fail with 400 error if exceeds). |

### Input Format

The `input` field can be provided in two formats:

#### Simple String Format
```json
{
  "input": "Tell me a three sentence bedtime story about a unicorn."
}
```

#### Array of Items Format
```json
{
  "input": [
    {
      "role": "user",
      "content": [
        {
          "type": "input_text",
          "text": "Tell me a story about a unicorn."
        }
      ]
    }
  ]
}
```

**Note:** When `input` is a single string, it is converted to a user message. When an array is provided, each item is processed according to its type.

### Input Item Types

Input items in the array format can be of several types:

#### Message Item
```json
{
  "type": "message",
  "role": "user",
  "content": [
    {
      "type": "input_text",
      "text": "User message text"
    }
  ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `type` | string | Always "message" |
| `id` | string | Optional unique identifier |
| `role` | string | Message role: "user", "assistant", "system", "developer" |
| `content` | array | Array of content parts (input_text, input_image, input_audio) |

#### Input Text Content Part
```json
{
  "type": "input_text",
  "text": "Text content here"
}
```

#### Input Image Content Part
```json
{
  "type": "input_image",
  "image_url": "https://example.com/image.jpg",
  "detail": "high"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `type` | string | Always "input_image" |
| `image_url` | string | URL of the image (http, https, or data URL with base64) |
| `detail` | string | Image detail level: "low", "high", or "auto" |

#### Input Audio Content Part
```json
{
  "type": "input_audio",
  "audio_url": "https://example.com/audio.mp3",
  "transcript": "Optional transcript"
}
```

#### Reasoning Item
```json
{
  "type": "reasoning",
  "summary": [
    {
      "type": "summary_text",
      "text": "Reasoning text"
    }
  ]
}
```

#### Function Call Item (Output in Multi-turn)
```json
{
  "type": "function_call",
  "call_id": "call_123",
  "name": "function_name",
  "arguments": "{\"param\": \"value\"}"
}
```

#### Function Call Output Item
```json
{
  "type": "function_call_output",
  "call_id": "call_123",
  "output": {
    "text": "Function result"
  }
}
```

---

## Tools Specification

### Function Tool (Custom Tools)
```json
{
  "type": "function",
  "name": "get_weather",
  "description": "Get the weather for a location",
  "parameters": {
    "type": "object",
    "properties": {
      "location": {
        "type": "string",
        "description": "The city and state"
      }
    },
    "required": ["location"]
  },
  "strict": true
}
```

| Field | Type | Description |
|-------|------|-------------|
| `type` | string | "function" for custom tools |
| `name` | string | Name of the function |
| `description` | string | Description of what the function does |
| `parameters` | object | JSON Schema defining the function parameters |
| `strict` | boolean | If true, model must follow the schema exactly |

### Image Generation Tool
```json
{
  "type": "image_generation",
  "model": "dall-e-3",
  "size": "1024x1024",
  "quality": "standard",
  "output_format": "png",
  "background": "opaque"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `type` | string | "image_generation" |
| `model` | string | Image generation model to use |
| `size` | string | Image dimensions (e.g., "1024x1024", "1792x1024", "1024x1792") |
| `quality` | string | Image quality: "standard" or "hd" |
| `output_format` | string | Output format: "png", "jpeg", "webp" |
| `output_compression` | integer | Compression level for output (0-100) |
| `background` | string | Background style: "opaque" or "transparent" |
| `input_fidelity` | string | Fidelity to input image (for variations) |
| `partial_images` | integer | Number of partial images to generate |
| `moderation` | string | Moderation behavior: "auto" or "none" |

### Built-in Tools

Built-in tools are provided by OpenAI and extend the model's capabilities for specific use cases. Each built-in tool has its own configuration options and output item types.

#### Web Search Tool
```json
{
  "type": "web_search"
}
```

The web search tool allows the model to search the internet for current information. When enabled, the model automatically invokes this tool when queries require up-to-date information beyond the training cutoff.

**Configuration:** No additional configuration required.

**Output Item Type:** `web_search_call`
```json
{
  "type": "web_search_call",
  "id": "ws_abc123",
  "status": "completed"
}
```

**Include Options:** Use `"web_search_call.action.sources"` in the `include` parameter to include search results and citation URLs.

---

#### File Search Tool
```json
{
  "type": "file_search",
  "vector_store_ids": ["vs_abc123", "vs_def456"]
}
```

The file search tool searches uploaded files in vector stores for relevant context.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `vector_store_ids` | array | Yes | IDs of vector stores to search. Files must be uploaded to OpenAI first. |

**Output Item Type:** `file_search_call`
```json
{
  "type": "file_search_call",
  "id": "fs_abc123",
  "status": "completed"
}
```

**Include Options:** Use `"file_search_call.results"` to include search result snippets with citations.

---

#### Code Interpreter (Python Execution)
```json
{
  "type": "code_interpreter"
}
```

The code interpreter tool executes Python code in a secure sandbox for data analysis, calculations, and visualizations.

**Configuration:** No additional configuration required.

**Output Item Type:** `code_interpreter_call`
```json
{
  "type": "code_interpreter_call",
  "id": "ci_abc123",
  "status": "completed"
}
```

**Include Options:** Use `"code_interpreter_call.outputs"` to include execution results, printed output, generated files, and charts.

**Output Structure:**
```json
{
  "type": "code_interpreter_call",
  "id": "ci_abc123",
  "status": "completed",
  "outputs": [
    {
      "type": "logs",
      "logs": ["Analysis complete. Mean value: 42.5"]
    },
    {
      "type": "image",
      "image": "base64_encoded_image_data"
    }
  ]
}
```

---

#### Computer Use Tool
```json
{
  "type": "computer_use"
}
```

The computer use tool enables the model to control a computer interface for agentic workflows involving GUI interaction.

**Configuration:** No additional configuration required.

**Output Item Type:** `computer_call`
```json
{
  "type": "computer_call",
  "id": "cu_abc123",
  "status": "completed"
}
```

**Include Options:** Use `"computer_call_output.output.image_url"` to include screenshots captured during execution.

**Output Structure:**
```json
{
  "type": "computer_call",
  "id": "cu_abc123",
  "status": "completed",
  "action": {
    "type": "click",
    "x": 150,
    "y": 300
  },
  "output": {
    "image_url": "https://api.openai.com/v1/images/generations/base64..."
  }
}
```

---

#### Image Generation Tool
```json
{
  "type": "image_generation",
  "model": "gpt-image-1",
  "size": "1024x1024",
  "quality": "standard",
  "output_format": "png",
  "background": "opaque"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | Yes | Must be "image_generation" |
| `model` | string | No | Image generation model (defaults to best available) |
| `size` | string | No | Image dimensions (e.g., "1024x1024", "1792x1024", "1024x1792") |
| `quality` | string | No | "standard" or "hd" |
| `output_format` | string | No | "png", "jpeg", "webp", "auto" |
| `background` | string | No | "opaque" or "transparent" |
| `output_compression` | integer | No | Compression level 0-100 |

**Output Item Type:** `image_generation_call`
```json
{
  "type": "image_generation_call",
  "id": "ig_abc123",
  "status": "completed",
  "result": "base64_encoded_image_data",
  "output_format": "png",
  "size": "1024x1024"
}
```

---

#### MCP (Model Context Protocol) Tools
```json
{
  "type": "mcp",
  "server_label": "database_connector",
  "server_description": "Access to company PostgreSQL database",
  "server_url": "https://mcp-server.company.com/sse",
  "require_approval": "never"
}
```

MCP tools integrate with third-party systems via the Model Context Protocol.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | Yes | Must be "mcp" |
| `server_label` | string | Yes | Human-readable label for the server |
| `server_description` | string | Yes | Description of server capabilities |
| `server_url` | string | Yes | URL of MCP server (must support SSE transport) |
| `require_approval` | string | No | "never" (default), "always", or "once" |

**Output Item Type:** `mcp_call`
```json
{
  "type": "mcp_call",
  "id": "mcp_abc123",
  "status": "completed",
  "name": "query_database",
  "arguments": "{\"query\": \"SELECT * FROM users LIMIT 10\"}"
}
```

---

### Tool Call Return Handling Rules

When implementing tool calls, the following patterns and rules must be followed:

#### 1. Tool Call Response Sequence

Tool interactions follow a consistent pattern:

1. **Model Decision:** Model outputs a `function_call` item (or tool-specific item type)
2. **Tool Execution:** The tool executes with the provided arguments
3. **Result Return:** Result is returned as a `function_call_output` item
4. **Model Continuation:** Model incorporates the result and continues generation

#### 2. Function Call Item Structure

```json
{
  "type": "function_call",
  "id": "fc_abc123",
  "call_id": "call_abc123",
  "name": "get_weather",
  "arguments": "{\"location\": \"San Francisco, CA\", \"unit\": \"celsius\"}",
  "status": "in_progress"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `type` | string | Always "function_call" |
| `id` | string | Unique item ID (prefixed with "fc_") |
| `call_id` | string | Correlation ID linking call to output |
| `name` | string | Name of the function being called |
| `arguments` | string | JSON string of arguments |
| `status` | string | "in_progress" while streaming, "completed" when done |

#### 3. Function Call Output Item Structure

```json
{
  "type": "function_call_output",
  "id": "fco_abc123",
  "call_id": "call_abc123",
  "output": {
    "text": "Sunny with temperature 22°C",
    "humidity": 65
  },
  "status": "completed"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `type` | string | Always "function_call_output" |
| `id` | string | Unique item ID (prefixed with "fco_") |
| `call_id` | string | Must match the corresponding function_call's call_id |
| `output` | object | Result from tool execution (text, structured data, files) |
| `status` | string | "completed", "failed", or "in_progress" |

#### 4. Parallel Tool Calls Rule

When `parallel_tool_calls` is `true` (default), the model can generate multiple tool calls simultaneously:

```json
{
  "output": [
    {
      "type": "function_call",
      "id": "fc_1",
      "call_id": "call_1",
      "name": "get_weather",
      "arguments": "{\"location\": \"San Francisco\"}"
    },
    {
      "type": "function_call",
      "id": "fc_2",
      "call_id": "call_2",
      "name": "get_time",
      "arguments": "{\"timezone\": \"America/Los_Angeles\"}"
    }
  ]
}
```

**Rules:**
- Each tool call must have a **unique** `call_id`
- Tool outputs must reference their corresponding `call_id`
- Output order does not need to match call order
- All parallel calls complete before model continues

#### 5. Tool Call Streaming Events

During streaming, tool calls generate these events:

| Event Type | Description |
|------------|-------------|
| `response.output_item.added` | New function_call item appears in output |
| `response.function_call_arguments.delta` | Arguments streamed token by token |
| `response.function_call_arguments.done` | Arguments complete (includes function name) |
| `response.output_item.done` | Tool call item marked completed |

**Streaming Example:**
```json
{"type":"response.output_item.added","output_index":0,"item":{"id":"fc_123","type":"function_call","status":"in_progress","name":"get_weather"},"sequence_number":2}
{"type":"response.function_call_arguments.delta","item_id":"fc_123","output_index":0,"delta":"{\"location","sequence_number":3}
{"type":"response.function_call_arguments.delta","item_id":"fc_123","output_index":0,"delta":": \"San","sequence_number":4}
{"type":"response.function_call_arguments.done","item_id":"fc_123","output_index":0,"name":"get_weather","arguments":"{\"location\":\"San Francisco\"}","sequence_number":5}
{"type":"response.output_item.done","output_index":0,"item":{"id":"fc_123","type":"function_call","status":"completed","name":"get_weather","arguments":"{\"location\":\"San Francisco\"}"},"sequence_number":6}
```

#### 6. Tool Call Result Passing Rule

Tool results must be passed to subsequent requests when continuing conversations:

```json
{
  "model": "gpt-4o",
  "previous_response_id": "resp_abc123",
  "input": [
    {
      "type": "function_call",
      "call_id": "call_1",
      "name": "get_weather",
      "arguments": "{\"location\": \"San Francisco\"}"
    },
    {
      "type": "function_call_output",
      "call_id": "call_1",
      "output": {"text": "Sunny, 72°F"}
    },
    {
      "type": "message",
      "role": "user",
      "content": [{"type": "input_text", "text": "What's the weather there?"}]
    }
  ]
}
```

**Rules:**
- **Include ALL** tool calls and outputs from previous responses
- The `call_id` **must match** between call and output items
- Outputs can contain text, structured JSON, or base64-encoded files
- Missing tool calls or outputs will cause context loss

#### 7. max_tool_calls Limit Rule

The `max_tool_calls` parameter limits total built-in tool calls:

```json
{
  "model": "gpt-4o",
  "tools": [{"type": "web_search"}],
  "max_tool_calls": 5,
  "input": "Summarize the latest news from 10 different sources"
}
```

**Rules:**
- **Only applies** to built-in tools (web_search, file_search, code_interpreter, computer_use, image_generation)
- **Does NOT limit** custom function calls
- Further attempts after the limit are silently ignored
- The model receives internal signal about the limit being reached

#### 8. Built-in Tool Include Mapping

| Tool Type | Output Item Type | Include Parameter |
|-----------|-----------------|-------------------|
| `web_search` | `web_search_call` | `"web_search_call.action.sources"` |
| `file_search` | `file_search_call` | `"file_search_call.results"` |
| `code_interpreter` | `code_interpreter_call` | `"code_interpreter_call.outputs"` |
| `computer_use` | `computer_call` | `"computer_call_output.output.image_url"` |
| `image_generation` | `image_generation_call` | (result included by default) |

**Example with Included Data:**
```json
{
  "model": "gpt-4o",
  "tools": [{"type": "web_search"}],
  "include": ["web_search_call.action.sources"],
  "input": "Latest AI news today"
}
```

Response with included sources:
```json
{
  "output": [
    {
      "type": "web_search_call",
      "id": "ws_123",
      "status": "completed",
      "action": {
        "type": "search",
        "sources": [
          {"url": "https://news.example.com/ai-breakthrough", "title": "AI Research Breakthrough"},
          {"url": "https://news.example.com/new-model", "title": "New LLM Released"}
        ]
      }
    }
  ]
}
```

#### 9. Tool Call Error Handling

When tool execution fails:

```json
{
  "type": "function_call_output",
  "id": "fco_abc123",
  "call_id": "call_1",
  "output": {
    "error": "Database connection failed: timeout after 30s"
  },
  "status": "failed"
}
```

**Rules:**
- Set `status` to `"failed"` when execution errors occur
- Include error details in the `output` field
- Model will receive the failure and can decide to retry or continue

### Tool Choice

**String Format:**
```json
"tool_choice": "auto"
```

**Object Format:**
```json
{
  "mode": "required",
  "type": "function",
  "name": "get_weather"
}
```

| Mode | Description |
|------|-------------|
| `"none"` | Model should not call any tools |
| `"auto"` | Model can choose to call tools or not |
| `"required"` | Model must call at least one tool |

---

## Text Format Configuration

```json
{
  "text": {
    "format": {
      "type": "text"
    }
  }
}
```

### Format Types

| Type | Description |
|------|-------------|
| `"text"` | Plain text output (default) |
| `"json_object"` | JSON object output |
| `"json_schema"` | JSON output matching a specific schema |

### JSON Schema Example
```json
{
  "text": {
    "format": {
      "type": "json_schema",
      "name": "weather_result",
      "schema": {
        "type": "object",
        "properties": {
          "temperature": {"type": "number"},
          "condition": {"type": "string"}
        },
        "required": ["temperature", "condition"]
      }
    }
  }
}
```

### Verbosity
```json
{
  "text": {
    "verbosity": "high"
  }
}
```

| Value | Description |
|-------|-------------|
| `"low"` | Minimal output |
| `"medium"` | Standard output |
| `"high"` | Verbose output |

---

## Reasoning Configuration

For reasoning models (gpt-5 and o-series):

```json
{
  "reasoning": {
    "effort": "medium",
    "summary": "auto",
    "max_tokens": 4096
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `effort` | string | Reasoning effort level: "low", "medium", "high", "minimal", "xhigh" |
| `summary` | string | Summary type: "auto", "concise", "detailed" |
| `max_tokens` | integer | Maximum reasoning tokens to generate |

**Note:** Only one of `effort` and `max_tokens` can be specified. When `effort` is present, `max_tokens` is ignored.

---

## Stream Options

```json
{
  "stream": true,
  "stream_options": {
    "include_obfuscation": true
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `include_obfuscation` | boolean | When true, adds obfuscation fields to streaming deltas for security against side-channel attacks. Adds small bandwidth overhead. |

---

## Response Structure

### Response Object Fields

```json
{
  "id": "resp_67ccd2bed1ec8190b14f964abc0542670bb6a6b452d3795b",
  "object": "response",
  "created_at": 1741476542,
  "status": "completed",
  "completed_at": 1741476543,
  "model": "gpt-4.1-2025-04-14",
  "output": [],
  "instructions": null,
  "temperature": 1.0,
  "top_p": 1.0,
  "max_output_tokens": null,
  "top_logprobs": null,
  "parallel_tool_calls": true,
  "tool_choice": "auto",
  "tools": [],
  "text": {
    "format": {
      "type": "text"
    }
  },
  "reasoning": {
    "effort": null,
    "summary": null
  },
  "usage": {
    "input_tokens": 36,
    "input_tokens_details": {
      "cached_tokens": 0
    },
    "output_tokens": 87,
    "output_tokens_details": {
      "reasoning_tokens": 0
    },
    "total_tokens": 123
  },
  "previous_response_id": null,
  "conversation": null,
  "store": true,
  "background": false,
  "truncation": "disabled",
  "incomplete_details": null,
  "error": null,
  "safety_identifier": null,
  "service_tier": null,
  "prompt_cache_key": null,
  "prompt_cache_retention": null,
  "user": null,
  "metadata": {}
}
```

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier for this response (prefixed with "resp_") |
| `object` | string | Always "response" |
| `created_at` | integer | Unix timestamp when response was created |
| `completed_at` | integer | Unix timestamp when response completed (only when status="completed") |
| `status` | string | Response status: "completed", "failed", "in_progress", "cancelled", "queued", "incomplete" |
| `model` | string | Model ID used to generate response |
| `output` | array | Array of content items generated by the model |
| `instructions` | string | Instructions provided in the request |
| `temperature` | number | Temperature setting from request |
| `top_p` | number | Top P setting from request |
| `max_output_tokens` | integer | Max output tokens from request |
| `top_logprobs` | integer | Top logprobs from request |
| `parallel_tool_calls` | boolean | Parallel tool calls setting |
| `tool_choice` | string or object | Tool choice setting |
| `tools` | array | Tools provided in request |
| `text` | object | Text format configuration |
| `reasoning` | object | Reasoning configuration and summary |
| `usage` | object | Token usage statistics |
| `previous_response_id` | string | Previous response ID for multi-turn |
| `conversation` | object | Conversation context |
| `store` | boolean | Store setting from request |
| `background` | boolean | Background setting from request |
| `truncation` | string | Truncation strategy |
| `incomplete_details` | object | Details when status="incomplete" |
| `error` | object | Error information when status="failed" |
| `safety_identifier` | string | Safety identifier from request |
| `service_tier` | string | Service tier used |
| `prompt_cache_key` | string | Prompt cache key |
| `prompt_cache_retention` | string | Prompt cache retention |
| `user` | string | User field (deprecated) |
| `metadata` | object | Metadata from request |

### Usage Object

```json
{
  "input_tokens": 100,
  "input_tokens_details": {
    "cached_tokens": 50
  },
  "output_tokens": 200,
  "output_tokens_details": {
    "reasoning_tokens": 50
  },
  "total_tokens": 300
}
```

| Field | Type | Description |
|-------|------|-------------|
| `input_tokens` | integer | Total input tokens |
| `input_tokens_details.cached_tokens` | integer | Input tokens served from cache |
| `output_tokens` | integer | Total output tokens |
| `output_tokens_details.reasoning_tokens` | integer | Tokens used for reasoning |
| `total_tokens` | integer | Sum of input and output tokens |

### Output Item Types

The `output` array contains items generated by the model:

#### Message Item (Assistant Response)
```json
{
  "type": "message",
  "id": "msg_67ccd2bf17f0819081ff3bb2cf6508e60bb6a6b452d3795b",
  "status": "completed",
  "role": "assistant",
  "content": [
    {
      "type": "output_text",
      "text": "The model response text here",
      "annotations": []
    }
  ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `type` | string | Always "message" |
| `id` | string | Unique identifier (prefixed with "msg_") |
| `status` | string | Item status: "in_progress", "completed", "incomplete" |
| `role` | string | "assistant" |
| `content` | array | Array of content parts |

#### Output Text Content Part
```json
{
  "type": "output_text",
  "text": "Response text",
  "annotations": []
}
```

| Field | Type | Description |
|-------|------|-------------|
| `type` | string | "output_text" |
| `text` | string | The text content |
| `annotations` | array | Array of text annotations (e.g., URLs, citations) |
| `logprobs` | array | Log probabilities (when requested via include) |

#### Reasoning Item
```json
{
  "type": "reasoning",
  "id": "reason_123",
  "status": "completed",
  "summary": [
    {
      "type": "summary_text",
      "text": "Reasoning summary text"
    }
  ],
  "encrypted_content": null
}
```

| Field | Type | Description |
|-------|------|-------------|
| `type` | string | "reasoning" |
| `id` | string | Unique identifier |
| `status` | string | "in_progress" or "completed" |
| `summary` | array | Array of summary text items |
| `reasoning_content` | array | Array of reasoning text items |
| `encrypted_content` | string | Encrypted reasoning content (when requested via include) |

#### Function Call Item
```json
{
  "type": "function_call",
  "id": "fc_123",
  "status": "completed",
  "call_id": "call_123",
  "name": "get_weather",
  "arguments": "{\"location\": \"San Francisco\"}"
}
```

#### Function Call Output Item
```json
{
  "type": "function_call_output",
  "id": "fco_123",
  "call_id": "call_123",
  "output": {
    "text": "Sunny, 72°F"
  }
}
```

#### Image Generation Call Item
```json
{
  "type": "image_generation_call",
  "id": "ig_123",
  "status": "completed",
  "result": "base64_encoded_image_data"
}
```

---

## Error Response Format

```json
{
  "error": {
    "message": "Error description",
    "type": "invalid_request_error",
    "code": "invalid_model",
    "param": "model"
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `message` | string | Human-readable error message |
| `type` | string | Error type: "invalid_request_error", "authentication_error", "rate_limit_error", "server_error", "invalid_model_error" |
| `code` | string | Specific error code |
| `param` | string | Parameter that caused the error |

### Common Error Types

| Type | HTTP Status | Description |
|------|-------------|-------------|
| `invalid_request_error` | 400 | Request has invalid or missing required parameters |
| `authentication_error` | 401 | Invalid or missing API key |
| `rate_limit_error` | 429 | Rate limit exceeded |
| `server_error` | 500 | Internal server error |
| `invalid_model_error` | 422 | Model not found or not available |

---

## Streaming Events

When `stream: true` is set, the API returns Server-Sent Events (SSE). Each event is a JSON object prefixed with "data: ".

### Event Types

#### Response Lifecycle Events

| Event Type | Description |
|------------|-------------|
| `response.created` | Emitted when a response is created |
| `response.in_progress` | Emitted when response generation is in progress |
| `response.completed` | Emitted when response generation is complete |
| `response.failed` | Emitted when response generation fails |
| `response.incomplete` | Emitted when response finishes incomplete |
| `response.queued` | Emitted when response is queued |
| `response.cancelled` | Emitted when response is cancelled |

#### Output Item Events

| Event Type | Description |
|------------|-------------|
| `response.output_item.added` | New output item is added |
| `response.output_item.done` | Output item is marked done |

#### Content Part Events

| Event Type | Description |
|------------|-------------|
| `response.content_part.added` | New content part is added |
| `response.content_part.done` | Content part is done |

#### Text Streaming Events

| Event Type | Description |
|------------|-------------|
| `response.output_text.delta` | Text delta (chunk) is available |
| `response.output_text.done` | Text content is finalized |
| `response.refusal.delta` | Refusal text delta |
| `response.refusal.done` | Refusal is finalized |

#### Function Call Events

| Event Type | Description |
|------------|-------------|
| `response.function_call_arguments.delta` | Function call arguments delta |
| `response.function_call_arguments.done` | Function call arguments complete |

#### Reasoning Events

| Event Type | Description |
|------------|-------------|
| `response.reasoning_summary_part.added` | Reasoning summary part added |
| `response.reasoning_summary_part.done` | Reasoning summary part done |
| `response.reasoning_summary_text.delta` | Reasoning text delta |
| `response.reasoning_summary_text.done` | Reasoning text complete |

#### Tool Call Events

| Event Type | Description |
|------------|-------------|
| `response.file_search_call.in_progress` | File search started |
| `response.file_search_call.searching` | File search in progress |
| `response.file_search_call.completed` | File search completed |
| `response.web_search_call.in_progress` | Web search started |
| `response.web_search_call.searching` | Web search in progress |
| `response.web_search_call.completed` | Web search completed |

#### Image Generation Events

| Event Type | Description |
|------------|-------------|
| `response.image_generation_call.generating` | Image generation started |
| `response.image_generation_call.in_progress` | Image generation in progress |
| `response.image_generation_call.partial_image` | Partial image available |
| `response.image_generation_call.completed` | Image generation completed |

### Streaming Event Structure

**Response Created Event:**
```json
{
  "type": "response.created",
  "response": {
    "id": "resp_123",
    "object": "response",
    "created_at": 1741487325,
    "status": "in_progress",
    "model": "gpt-4o",
    "output": []
  },
  "sequence_number": 1
}
```

**Text Delta Event:**
```json
{
  "type": "response.output_text.delta",
  "item_id": "msg_123",
  "output_index": 0,
  "content_index": 0,
  "delta": "Hello ",
  "sequence_number": 5
}
```

**Text Done Event:**
```json
{
  "type": "response.output_text.done",
  "item_id": "msg_123",
  "output_index": 0,
  "content_index": 0,
  "text": "Hello, world!",
  "sequence_number": 6
}
```

**Output Item Added Event:**
```json
{
  "type": "response.output_item.added",
  "output_index": 0,
  "item": {
    "id": "msg_123",
    "status": "in_progress",
    "type": "message",
    "role": "assistant",
    "content": []
  },
  "sequence_number": 2
}
```

**Output Item Done Event:**
```json
{
  "type": "response.output_item.done",
  "output_index": 0,
  "item": {
    "id": "msg_123",
    "status": "completed",
    "type": "message",
    "role": "assistant",
    "content": [
      {
        "type": "output_text",
        "text": "Hello, world!",
        "annotations": []
      }
    ]
  },
  "sequence_number": 6
}
```

**Function Call Arguments Delta:**
```json
{
  "type": "response.function_call_arguments.delta",
  "item_id": "fc_123",
  "output_index": 1,
  "delta": "{\"location\": \"",
  "sequence_number": 3
}
```

**Function Call Arguments Done:**
```json
{
  "type": "response.function_call_arguments.done",
  "item_id": "fc_123",
  "output_index": 1,
  "name": "get_weather",
  "arguments": "{\"location\": \"San Francisco\"}",
  "sequence_number": 4
}
```

### Stream Termination

The stream ends with either:
- `[DONE]` marker
- Or an error event

---

## Input/Output Transformations

### Message Role Mappings

When converting from other API formats (like Chat Completions):

| Chat Role | Input Item Type | Notes |
|-----------|----------------|-------|
| `user` | `message` with `role: "user"` | Content becomes `input_text` items |
| `assistant` | `message` with `role: "assistant"` | Content becomes `output_text` items |
| `tool` | `function_call_output` | Contains tool results |
| `system` | `instructions` (top-level field) | Not an input item, but sets instructions |
| `developer` | `instructions` (top-level field) | Treated same as system |

### Content Part Transformations

| Source Format | Target Format | Notes |
|---------------|----------------|-------|
| `{"content": "text"}` | `{"type": "input_text", "text": "text"}` | Simple string to input_text |
| `{"content": [{"type": "text", "text": "..."}]}` | `{"type": "input_text", "text": "..."}` | Text content parts |
| `{"content": [{"type": "image_url", "image_url": "..."}]}` | `{"type": "input_image", "image_url": "..."}` | Image content |
| `{"multiple_content": [{"type": "text", "text": "..."}]}` | Multiple content items | Preserved as array |

### Tool Call Transformations

| Scenario | Transformation |
|----------|----------------|
| Assistant message with tool_calls | Becomes separate `function_call` items followed by assistant `message` |
| Tool result message | Becomes `function_call_output` item |
| Function call arguments | Accumulated across streaming deltas |

### Reasoning Content Transformations

| Source | Target | Notes |
|--------|--------|-------|
| `{"reasoning_content": "thinking..."}` | `{"type": "reasoning", "summary": [{"type": "summary_text", "text": "..."}]}` | Single reasoning item with summary |

### Streaming Delta Transformations

| Source Delta | Streaming Event | Notes |
|--------------|-----------------|-------|
| Text delta | `response.output_text.delta` | Accumulates text until done |
| Reasoning delta | `response.reasoning_summary_text.delta` | Accumulates reasoning |
| Tool call start | `response.output_item.added` (function_call) | New tool call item |
| Tool call arguments | `response.function_call_arguments.delta` | Accumulates arguments |
| Tool call done | `response.function_call_arguments.done` | Arguments complete, includes name |

---

## Multi-Turn Conversations

---

## Multi-Turn Conversations

The Responses API supports stateful multi-turn conversations through two mechanisms: `previous_response_id` and `conversation`. These allow the model to maintain context across multiple requests.

### Using previous_response_id

The `previous_response_id` parameter continues a conversation by referencing a specific previous response:

```json
{
  "model": "gpt-4o",
  "previous_response_id": "resp_abc123def456",
  "input": "Continue the story from where we left off."
}
```

**How It Works:**
1. The API automatically retrieves the previous response
2. All items from the previous `output` array are prepended to this request's context
3. The model can reference information from the entire conversation history
4. This response receives a new ID (e.g., "resp_xyz789")

**Critical Rules:**

| Rule | Description |
|------|-------------|
| **Instructions Isolation** | `instructions` from the previous response are **NOT** carried over. This is intentional to allow swapping system/developer messages without affecting previous turns. |
| **Mutual Exclusion** | Cannot use `previous_response_id` and `conversation` in the same request. Use one or the other. |
| **Output Inclusion** | The previous response's entire `output` array (messages, reasoning, tool calls, tool results) is included automatically. You do NOT need to manually include output items. |
| **Unique References** | Each response has a unique ID. You must use the ID of the most recent response to continue the chain. |
| **Order Preservation** | Items are prepended in chronological order (earliest first). |

**Example Multi-Turn Flow:**

**Turn 1 - Initial Request:**
```json
{
  "model": "gpt-4o",
  "input": "Tell me a short story about a robot."
}
```
**Response 1:**
```json
{
  "id": "resp_001",
  "status": "completed",
  "output": [
    {
      "type": "message",
      "role": "assistant",
      "content": [{"type": "output_text", "text": "In a factory far away, Unit-7 woke up..."}]
    }
  ]
}
```

**Turn 2 - Continue with previous_response_id:**
```json
{
  "model": "gpt-4o",
  "previous_response_id": "resp_001",
  "input": "What happened next?"
}
```
**Response 2:**
```json
{
  "id": "resp_002",
  "status": "completed",
  "output": [
    {
      "type": "message",
      "role": "assistant", 
      "content": [{"type": "output_text", "text": "Unit-7 discovered it could dream..."}]
    }
  ]
}
```

**Turn 3 - Continue the conversation:**
```json
{
  "model": "gpt-4o",
  "previous_response_id": "resp_002",
  "input": "Make the ending happy."
}
```

**Important: Instructions Behavior**

```json
// Turn 1: Initial request with system instructions
{
  "model": "gpt-4o",
  "instructions": "You are a science fiction writer.",
  "input": "Write about space exploration."
}

// Turn 2: Changing instructions - previous instructions do NOT carry over
{
  "model": "gpt-4o",
  "instructions": "You are a fantasy writer instead.",  // New instructions, not inherited
  "previous_response_id": "resp_prev",
  "input": "Continue with dragons."
}
```

### Using conversation

The `conversation` parameter manages a persistent conversation context:

```json
{
  "model": "gpt-4o",
  "conversation": "conv_abc123",
  "input": "User message here"
}
```

**How It Works:**
1. A conversation ID references a persistent collection of items
2. Items from the conversation are prepended to each request
3. New input and output items are automatically appended to the conversation
4. The same conversation ID can be used across multiple responses

**Behavior:**

| Feature | Description |
|---------|-------------|
| **Persistent Context** | Conversation maintains all items across requests |
| **Automatic Addition** | New input/output items are added after each response |
| **Reference by ID** | Use the conversation ID to continue any time |
| **Isolation** | Different conversations are completely isolated |

**Comparison: previous_response_id vs conversation**

| Feature | previous_response_id | conversation |
|---------|---------------------|-------------|
| **Scope** | Single response chain | Persistent collection |
| **Items Included** | Output from specific response | All items in conversation |
| **State Management** | Manual chain tracking | Automatic by ID |
| **Use Case** | Linear conversation flows | Long-running sessions |
| **Item Addition** | Via output array | Automatic |

### Conversation ID Format

- Conversation IDs are prefixed with `conv_`
- Response IDs are prefixed with `resp_`
- Item IDs have their own prefixes (`msg_`, `fc_`, etc.)

### Continuing from Arbitrary Points

You can continue from any previous response in a chain:

```json
// Original conversation chain: resp_A -> resp_B -> resp_C
// You can continue from resp_A instead of resp_C:
{
  "model": "gpt-4o",
  "previous_response_id": "resp_A",  // Branching from earlier point
  "input": "Different direction for the story."
}
```

**Note:** This creates a branch. The chain resp_A -> resp_B -> resp_C remains unchanged. The new response gets its own ID.

---

## Status Values and Meanings

| Status | Meaning | When It Occurs |
|--------|---------|----------------|
| `queued` | Response is queued for processing | Initial state when background=true |
| `in_progress` | Model is generating response | Normal active state |
| `completed` | Response generation finished successfully | Final state on success |
| `failed` | Response generation failed with error | When model or system encounters error |
| `incomplete` | Response finished but truncated | When max_tokens reached or content filtered |
| `cancelled` | Response was cancelled | When background=true and cancelled endpoint called |

---

## Incomplete Details

When status is "incomplete", the `incomplete_details` field provides context:

```json
{
  "incomplete_details": {
    "reason": "max_output_tokens"
  }
}
```

| Reason | Description |
|--------|-------------|
| `max_output_tokens` | Response hit max_output_tokens limit |
| `content_filter` | Content was filtered by safety systems |

---

## Implementation Checklist

### Request Validation

- [ ] Validate required fields: `model` and `input`
- [ ] Validate `model` is a valid model ID
- [ ] Check `input` is either string or array
- [ ] If `input` is array, validate each item has valid structure
- [ ] Validate `tools` array items have required fields
- [ ] Check `temperature` is between 0 and 2
- [ ] Check `top_p` is between 0 and 1
- [ ] Validate `max_output_tokens` is positive
- [ ] Check mutually exclusive fields: `previous_response_id` vs `conversation`
- [ ] Validate `reasoning` configuration for appropriate models

### Response Building

- [ ] Generate unique response ID with "resp_" prefix
- [ ] Set `object` to "response"
- [ ] Set `created_at` to current Unix timestamp
- [ ] Populate `output` array with generated items
- [ ] Set `status` appropriately based on completion
- [ ] Calculate and include `usage` statistics
- [ ] Include relevant request parameters in response
- [ ] Set `completed_at` when status is "completed"

### Output Item Generation

- [ ] Generate unique item IDs with appropriate prefixes:
  - Messages: "msg_"
  - Function calls: "fc_"
  - Reasoning: "reason_"
- [ ] Set `status` to "completed" for finished items
- [ ] Include content array with proper content types
- [ ] Accumulate streaming deltas into complete items

### Streaming Implementation

- [ ] Start with `response.created` event
- [ ] Follow with `response.in_progress` event
- [ ] Emit events for each content delta
- [ ] Emit completion events when items are finished
- [ ] End with `response.completed` event
- [ ] Include `sequence_number` in each event (monotonically increasing)

### Error Handling

- [ ] Parse error responses from upstream
- [ ] Map upstream errors to appropriate HTTP status codes
- [ ] Transform error format to API specification
- [ ] Include relevant error details without sensitive information

---

## Complete Request/Response Examples

### Simple Text Request/Response

**Request:**
```json
{
  "model": "gpt-4.1",
  "input": "Tell me a three sentence bedtime story about a unicorn."
}
```

**Response:**
```json
{
  "id": "resp_67ccd2bed1ec8190b14f964abc0542670bb6a6b452d3795b",
  "object": "response",
  "created_at": 1741476542,
  "status": "completed",
  "completed_at": 1741476543,
  "model": "gpt-4.1-2025-04-14",
  "output": [
    {
      "type": "message",
      "id": "msg_67ccd2bf17f0819081ff3bb2cf6508e60bb6a6b452d3795b",
      "status": "completed",
      "role": "assistant",
      "content": [
        {
          "type": "output_text",
          "text": "In a peaceful grove beneath a silver moon, a unicorn named Lumina discovered a hidden pool that reflected the stars. As she dipped her horn into the water, the pool began to shimmer, revealing a pathway to a magical realm of endless night skies. Filled with wonder, Lumina whispered a wish for all who dream to find their own hidden magic, and as she glanced back, her hoofprints sparkled like stardust.",
          "annotations": []
        }
      ]
    }
  ],
  "parallel_tool_calls": true,
  "previous_response_id": null,
  "reasoning": {"effort": null, "summary": null},
  "store": true,
  "temperature": 1.0,
  "text": {"format": {"type": "text"}},
  "tool_choice": "auto",
  "tools": [],
  "top_p": 1.0,
  "truncation": "disabled",
  "usage": {
    "input_tokens": 36,
    "input_tokens_details": {"cached_tokens": 0},
    "output_tokens": 87,
    "output_tokens_details": {"reasoning_tokens": 0},
    "total_tokens": 123
  },
  "user": null,
  "metadata": {}
}
```

### Multi-turn Conversation

**Request 1:**
```json
{
  "model": "gpt-4o",
  "input": [
    {
      "type": "message",
      "role": "user",
      "content": [
        {"type": "input_text", "text": "What's the weather in San Francisco?"}
      ]
    }
  ]
}
```

**Response 1:**
```json
{
  "id": "resp_001",
  "object": "response",
  "status": "completed",
  "output": [
    {
      "type": "function_call",
      "id": "fc_001",
      "name": "get_weather",
      "arguments": "{\"location\": \"San Francisco\"}"
    }
    // Plus tool result and response...
  ],
  "previous_response_id": null
}
```

**Request 2 (continuation):**
```json
{
  "model": "gpt-4o",
  "previous_response_id": "resp_001",
  "input": "What's the temperature in Celsius?"
}
```

### Request with Tools

**Request:**
```json
{
  "model": "gpt-4o",
  "input": "What's the weather in Tokyo?",
  "tools": [
    {
      "type": "function",
      "name": "get_weather",
      "description": "Get the weather for a location",
      "parameters": {
        "type": "object",
        "properties": {
          "location": {"type": "string", "description": "City name"}
        },
        "required": ["location"]
      }
    }
  ],
  "tool_choice": "auto"
}
```

### Structured Output Request

**Request:**
```json
{
  "model": "gpt-4o",
  "input": "Extract contact information from this business card",
  "text": {
    "format": {
      "type": "json_schema",
      "name": "contact_info",
      "schema": {
        "type": "object",
        "properties": {
          "name": {"type": "string"},
          "email": {"type": "string", "format": "email"},
          "phone": {"type": "string"},
          "company": {"type": "string"}
        },
        "required": ["name", "email"]
      }
    }
  }
}
```

### Reasoning Model Request

**Request:**
```json
{
  "model": "o3",
  "input": "Solve this complex math problem step by step",
  "reasoning": {
    "effort": "high",
    "summary": "auto"
  }
}
```

**Response with Reasoning:**
```json
{
  "id": "resp_reasoning",
  "status": "completed",
  "output": [
    {
      "type": "reasoning",
      "summary": [
        {"type": "summary_text", "text": "First, I identify the problem is asking for..."}
      ]
    },
    {
      "type": "message",
      "content": [
        {"type": "output_text", "text": "The answer is 42."}
      ]
    }
  ],
  "reasoning": {
    "effort": "high",
    "summary": "auto"
  }
}
```

### Streaming Request

**Request:**
```json
{
  "model": "gpt-4o",
  "input": "Write a poem about the ocean",
  "stream": true,
  "stream_options": {
    "include_obfuscation": false
  }
}
```

**Streaming Events:**
```
data: {"type":"response.created","response":{"id":"resp_stream","status":"in_progress"},"sequence_number":0}
data: {"type":"response.in_progress","response":{"id":"resp_stream","status":"in_progress"},"sequence_number":1}
data: {"type":"response.output_item.added","output_index":0,"item":{"id":"msg_1","type":"message","status":"in_progress","role":"assistant","content":[]},"sequence_number":2}
data: {"type":"response.content_part.added","item_id":"msg_1","output_index":0,"content_index":0,"part":{"type":"output_text"},"sequence_number":3}
data: {"type":"response.output_text.delta","item_id":"msg_1","output_index":0,"content_index":0,"delta":"The ","sequence_number":4}
data: {"type":"response.output_text.delta","item_id":"msg_1","output_index":0,"content_index":0,"delta":"waves ","sequence_number":5}
data: {"type":"response.output_text.done","item_id":"msg_1","output_index":0,"content_index":0,"text":"The waves crash against the shore...","sequence_number":6}
data: {"type":"response.output_item.done","output_index":0,"item":{"id":"msg_1","type":"message","status":"completed","role":"assistant","content":[{"type":"output_text","text":"The waves crash against the shore..."}]},"sequence_number":7}
data: {"type":"response.completed","response":{"id":"resp_stream","status":"completed","output":[...],"usage":{"input_tokens":15,"output_tokens":50}},"sequence_number":8}
```

---

## References

This documentation is based on the OpenAI Responses API specification:
- https://platform.openai.com/docs/api-reference/responses
- https://platform.openai.com/docs/api-reference/responses-streaming
- https://platform.openai.com/docs/api-reference/responses/input-items

For the most current API specification, always refer to the official OpenAI documentation.