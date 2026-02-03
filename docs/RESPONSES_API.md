# OpenAI Responses API Implementation

Plexus now supports the **OpenAI Responses API** (`/v1/responses`), a next-generation interface for agentic applications with stateful conversations, built-in tools, and structured item-based input/output.

## Features

### ✅ Core Functionality
- **Simple and structured input formats** - Use plain strings or array of items
- **Item-based output** - Responses return structured arrays of messages, tool calls, and reasoning
- **Full streaming support** - SSE events with sequence numbers and granular deltas
- **Multi-turn conversations** - Stateful conversations via `previous_response_id` or `conversation` parameters
- **Response storage** - Automatic storage and retrieval of responses
- **Function calling** - Complete support for custom function tools
- **Provider flexibility** - Routes to any configured provider (OpenAI, Anthropic, etc.)

### 🔄 Transformation Architecture
The Responses API uses Plexus's transformer architecture to seamlessly convert between formats:
- **Request transformation** - Converts Responses API format → Chat Completions → Provider format
- **Response transformation** - Converts Provider format → Chat Completions → Responses API format
- **Stream transformation** - Real-time conversion of streaming responses with proper event types

## API Endpoints

### POST /v1/responses
Creates a new response.

**Simple Request:**
```bash
curl -X POST http://localhost:4000/v1/responses \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o",
    "input": "Tell me a short story about a robot."
  }'
```

**Structured Request:**
```bash
curl -X POST http://localhost:4000/v1/responses \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o",
    "input": [
      {
        "type": "message",
        "role": "user",
        "content": [
          {
            "type": "input_text",
            "text": "What is the weather like today?"
          }
        ]
      }
    ],
    "temperature": 0.7
  }'
```

**Response:**
```json
{
  "id": "resp_abc123",
  "object": "response",
  "created_at": 1234567890,
  "completed_at": 1234567891,
  "status": "completed",
  "model": "gpt-4o",
  "output": [
    {
      "type": "message",
      "id": "msg_xyz789",
      "status": "completed",
      "role": "assistant",
      "content": [
        {
          "type": "output_text",
          "text": "Once upon a time, there was a robot named Unit-7...",
          "annotations": []
        }
      ]
    }
  ],
  "usage": {
    "input_tokens": 15,
    "input_tokens_details": { "cached_tokens": 0 },
    "output_tokens": 87,
    "output_tokens_details": { "reasoning_tokens": 0 },
    "total_tokens": 102
  }
}
```

### GET /v1/responses/:response_id
Retrieves a stored response.

```bash
curl http://localhost:4000/v1/responses/resp_abc123 \
  -H "Authorization: Bearer YOUR_API_KEY"
```

### DELETE /v1/responses/:response_id
Deletes a stored response.

```bash
curl -X DELETE http://localhost:4000/v1/responses/resp_abc123 \
  -H "Authorization: Bearer YOUR_API_KEY"
```

### GET /v1/conversations/:conversation_id
Retrieves a conversation's history.

```bash
curl http://localhost:4000/v1/conversations/conv_abc123 \
  -H "Authorization: Bearer YOUR_API_KEY"
```

## Streaming

Enable streaming to receive real-time updates:

```bash
curl -X POST http://localhost:4000/v1/responses \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o",
    "input": "Count from 1 to 10.",
    "stream": true
  }'
```

**Streaming Events:**
- `response.created` - Response generation started
- `response.in_progress` - Generation in progress
- `response.output_item.added` - New output item (message, function call, etc.)
- `response.output_text.delta` - Text chunk received
- `response.output_text.done` - Text content complete
- `response.function_call_arguments.delta` - Function arguments streaming
- `response.function_call_arguments.done` - Function call complete
- `response.completed` - Response generation finished

## Multi-turn Conversations

### Using previous_response_id

Continue a conversation by referencing the previous response:

```bash
# First request
curl -X POST http://localhost:4000/v1/responses \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o",
    "input": "Tell me about Paris."
  }'
# Returns: { "id": "resp_001", ... }

# Continue the conversation
curl -X POST http://localhost:4000/v1/responses \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o",
    "previous_response_id": "resp_001",
    "input": "What is the population?"
  }'
```

**Note:** The `instructions` field is **not** carried over when using `previous_response_id`. This allows changing system messages between turns.

### Using conversation

Manage persistent conversations:

```bash
curl -X POST http://localhost:4000/v1/responses \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o",
    "conversation": "conv_my_session",
    "input": "Remember: my favorite color is blue."
  }'

# Later...
curl -X POST http://localhost:4000/v1/responses \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o",
    "conversation": "conv_my_session",
    "input": "What is my favorite color?"
  }'
```

## Function Calling

The Responses API supports custom function tools:

```bash
curl -X POST http://localhost:4000/v1/responses \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o",
    "input": "What is the weather in San Francisco?",
    "tools": [
      {
        "type": "function",
        "name": "get_weather",
        "description": "Get the weather for a location",
        "parameters": {
          "type": "object",
          "properties": {
            "location": {
              "type": "string",
              "description": "City and state"
            },
            "unit": {
              "type": "string",
              "enum": ["celsius", "fahrenheit"]
            }
          },
          "required": ["location"]
        }
      }
    ]
  }'
```

**Response with tool call:**
```json
{
  "id": "resp_abc123",
  "object": "response",
  "status": "completed",
  "output": [
    {
      "type": "function_call",
      "id": "fc_xyz789",
      "status": "completed",
      "call_id": "call_123",
      "name": "get_weather",
      "arguments": "{\"location\":\"San Francisco, CA\",\"unit\":\"fahrenheit\"}"
    }
  ]
}
```

**Providing tool results:**
```bash
curl -X POST http://localhost:4000/v1/responses \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o",
    "input": [
      {
        "type": "function_call",
        "call_id": "call_123",
        "name": "get_weather",
        "arguments": "{\"location\":\"San Francisco, CA\",\"unit\":\"fahrenheit\"}"
      },
      {
        "type": "function_call_output",
        "call_id": "call_123",
        "output": {
          "text": "Sunny, 72°F"
        }
      },
      {
        "type": "message",
        "role": "user",
        "content": [
          {
            "type": "input_text",
            "text": "What should I wear?"
          }
        ]
      }
    ]
  }'
```

## Supported Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `model` | string | Required. The model to use (e.g., "gpt-4o", "claude-3-5-sonnet") |
| `input` | string or array | Required. Text or structured input items |
| `instructions` | string | System/developer message (not carried over with previous_response_id) |
| `tools` | array | Function tools available to the model |
| `tool_choice` | string/object | "auto", "none", "required", or specific tool |
| `parallel_tool_calls` | boolean | Allow parallel tool calls (default: true) |
| `temperature` | number | Sampling temperature 0-2 (default: 1.0) |
| `top_p` | number | Nucleus sampling 0-1 (default: 1.0) |
| `max_output_tokens` | integer | Maximum tokens to generate |
| `stream` | boolean | Enable streaming (default: false) |
| `store` | boolean | Store response for retrieval (default: true) |
| `previous_response_id` | string | Continue from previous response |
| `conversation` | string | Conversation ID for persistent context |
| `metadata` | object | Key-value pairs for additional information |

## Testing

Run the test suite to verify the implementation:

```bash
# Make sure Plexus is running on port 4000
bun run dev

# In another terminal, run the tests
bun testcommands/test-responses-api.ts
```

## Database Schema

The implementation uses three new tables:

- **`responses`** - Stores response data, configuration, and usage
- **`conversations`** - Manages persistent conversation state
- **`response_items`** - Individual output items for efficient querying

Migrations are automatically applied on server startup.

## Architecture

```
Client Request (Responses API)
    ↓
ResponsesTransformer.parseRequest()
    ↓
Unified Chat Format
    ↓
Dispatcher → Router → Provider
    ↓
Provider Response
    ↓
ResponsesTransformer.transformResponse()
    ↓
ResponsesTransformer.formatResponse()
    ↓
Client Response (Responses API)
```

## Limitations

The following OpenAI Responses API features are **not yet implemented**:

- Built-in tools (web_search, file_search, code_interpreter, computer_use, image_generation)
- MCP (Model Context Protocol) tools
- Reasoning models configuration (effort, summary)
- Structured output with json_schema
- Background execution
- Image/audio inputs
- Top logprobs

These features can be added in future updates as needed.

## Related Documentation

- [OpenAI Responses API Reference](https://platform.openai.com/docs/api-reference/responses)
- [Plexus Configuration Guide](../README.md)
- [Transformer Architecture](../AGENTS.md)
