# Plexus API Documentation

This document describes all HTTP endpoints available in Plexus.

---

## Authentication

All inference endpoints (`/v1/*`, `/v1beta/*`) require authentication. Management endpoints (`/v0/*`) do not require API key auth.

### Accepted Credentials

Plexus accepts a key via any of the following, checked in this order:

| Method | Example |
|--------|---------|
| `Authorization` header | `Authorization: Bearer sk-my-key` |
| `Authorization` header (no prefix) | `Authorization: sk-my-key` (prefix added automatically) |
| `x-api-key` header | `x-api-key: sk-my-key` |
| `x-goog-api-key` header | `x-goog-api-key: sk-my-key` |
| `?key=` query parameter | `GET /v1/models?key=sk-my-key` |

Keys are matched against the `secret` field of entries in the `keys` section of `plexus.yaml`. See [CONFIGURATION.md](./CONFIGURATION.md) for how to define keys.

### Dynamic Key Attribution

To tag a request with an attribution label for usage tracking, append `:label` to the key:

```
Authorization: Bearer sk-my-key:copilot
```

The label is stored in `attribution` on every usage record for that request. See [CONFIGURATION.md — Dynamic Key Attribution](./CONFIGURATION.md#dynamic-key-attribution) for details.

### Auth Failure Response

Failed auth returns HTTP `401`:

```json
{
  "error": {
    "message": "...",
    "type": "auth_error",
    "code": 401
  }
}
```

### Public Endpoints (No Auth Required)

- `GET /health`
- `GET /v1/models`
- `GET /v1/openrouter/models`
- `GET /v1/metadata/search`
- All `/.well-known/*` and `/register` MCP discovery endpoints

---

## Health Check

- **Endpoint:** `GET /health`
- **Description:** Returns `OK` if the server is running.
- **Response:** `200 OK` with body `OK`

---

## Standard Inference APIs

All inference endpoints below require authentication (see above). Requests are routed to a backend provider based on the `model` field and `plexus.yaml` configuration.

### Chat Completions (OpenAI-compatible)

- **Endpoint:** `POST /v1/chat/completions`
- **Auth:** Required
- **Description:** Compatible with the OpenAI Chat Completions API.
- **Documentation:** [OpenAI Chat Completions Reference](https://platform.openai.com/docs/api-reference/chat)

### Messages (Anthropic-compatible)

- **Endpoint:** `POST /v1/messages`
- **Auth:** Required
- **Description:** Compatible with the Anthropic Messages API.
- **Documentation:** [Anthropic Messages Reference](https://docs.anthropic.com/en/api/messages)

### Responses (OpenAI Responses API-compatible)

- **Endpoint:** `POST /v1/responses`
- **Auth:** Required
- **Description:** Compatible with the OpenAI Responses API. Supports multi-turn conversations via `previous_response_id`, tool use, and reasoning. Plexus stores response state server-side so clients only need to send new input and a reference to the previous response.

#### Retrieve a Response

- **Endpoint:** `GET /v1/responses/:response_id`
- **Auth:** Required
- **Description:** Retrieves a previously stored response by ID.

#### Delete a Response

- **Endpoint:** `DELETE /v1/responses/:response_id`
- **Auth:** Required
- **Description:** Deletes a stored response.

#### Get Conversation

- **Endpoint:** `GET /v1/conversations/:conversation_id`
- **Auth:** Required
- **Description:** Retrieves all items in a stored conversation thread.

### Gemini (Google-compatible)

- **Endpoint:** `POST /v1beta/models/{model}:{action}`
- **Auth:** Required
- **Description:** Compatible with the Google Generative Language API (Gemini).
- **Supported Actions:** `generateContent`, `streamGenerateContent`
- **Documentation:** [Gemini API Reference](https://ai.google.dev/api/rest/v1beta/models/generateContent)

### Embeddings (OpenAI-compatible)

- **Endpoint:** `POST /v1/embeddings`
- **Auth:** Required
- **Description:** Compatible with the OpenAI Embeddings API. Works with any provider that supports OpenAI-compatible embeddings.
- **Model Type:** Models must be configured with `type: embeddings`.
- **Pass-through:** Always pass-through (no protocol transformation).
- **Documentation:** [OpenAI Embeddings Reference](https://platform.openai.com/docs/api-reference/embeddings)

### Audio Transcriptions (OpenAI-compatible)

- **Endpoint:** `POST /v1/audio/transcriptions`
- **Auth:** Required
- **Description:** Compatible with the OpenAI Audio Transcriptions API. Accepts `multipart/form-data` with audio files.
- **Model Type:** Models must be configured with `type: transcriptions`.
- **Supported Formats:** mp3, mp4, mpeg, mpga, m4a, ogg, wav, webm (max 25 MB)
- **Response Formats:** `json`, `text`
- **Pass-through:** Always pass-through.
- **Documentation:** [OpenAI Audio Reference](https://platform.openai.com/docs/api-reference/audio/createTranscription)

### Audio Speech (OpenAI-compatible)

- **Endpoint:** `POST /v1/audio/speech`
- **Auth:** Required
- **Description:** Compatible with the OpenAI Audio Speech API. Generates audio from text.
- **Model Type:** Models must be configured with `type: speech`.
- **Request Body (JSON):**
  - `model` (required): TTS model identifier
  - `input` (required): Text to convert (max 4096 chars)
  - `voice` (required): `alloy`, `ash`, `ballad`, `coral`, `echo`, `fable`, `onyx`, `nova`, `sage`, `shimmer`, `verse`, `marin`, `cedar`
  - `instructions` (optional): Voice style control (not supported on `tts-1` / `tts-1-hd`)
  - `response_format` (optional): `mp3`, `opus`, `aac`, `flac`, `wav`, `pcm` — default `mp3`
  - `speed` (optional): 0.25–4.0 — default `1.0`
  - `stream_format` (optional): `sse` or `audio` — default `audio`. Not supported on `tts-1` / `tts-1-hd`.
- **Response:** Binary audio with appropriate `Content-Type`, or SSE stream with `speech.audio.delta` / `speech.audio.done` events when `stream_format: "sse"`.
- **Pass-through:** Always pass-through.
- **Documentation:** [OpenAI Speech Reference](https://platform.openai.com/docs/api-reference/audio/createSpeech)

### Image Generation (OpenAI-compatible)

- **Endpoint:** `POST /v1/images/generations`
- **Auth:** Required
- **Description:** Compatible with the OpenAI Images Generation API.
- **Model Type:** Models must be configured with `type: image`.
- **Request Body (JSON):**
  - `model` (required): Image generation model identifier
  - `prompt` (required): Text description of the desired image
  - `n` (optional): Number of images, 1–10 — default `1`
  - `size` (optional): `256x256`, `512x512`, `1024x1024`, `1792x1024`, `1024x1792`
  - `response_format` (optional): `url` or `b64_json` — default `url`
  - `quality` (optional): `standard`, `hd`, `high`, `medium`, `low`
  - `style` (optional): `vivid` or `natural` (DALL-E 3 only)
  - `user` (optional): End-user tracking ID
- **Response:**
  ```json
  {
    "created": 1735689599,
    "data": [
      { "url": "https://...", "revised_prompt": "..." }
    ]
  }
  ```
- **Pass-through:** Always pass-through.
- **Documentation:** [OpenAI Images Reference](https://platform.openai.com/docs/api-reference/images/create)

### Image Editing (OpenAI-compatible)

- **Endpoint:** `POST /v1/images/edits`
- **Auth:** Required
- **Description:** Compatible with the OpenAI Images Edit API. Accepts `multipart/form-data`.
- **Model Type:** Models must be configured with `type: image`.
- **Request Body (multipart/form-data):**
  - `image` (required): PNG file, < 4 MB
  - `prompt` (required): Description of desired edit
  - `mask` (optional): PNG mask (transparent = edit here)
  - `model` (optional): Model identifier
  - `n` (optional): 1–10 — default `1`
  - `size` (optional): `256x256`, `512x512`, `1024x1024` — default `1024x1024`
  - `response_format` (optional): `url` or `b64_json` — default `url`
  - `quality` (optional): `standard`, `high`, `medium`, `low`
  - `user` (optional): End-user tracking ID
- **Pass-through:** Always pass-through.
- **Documentation:** [OpenAI Images Edit Reference](https://platform.openai.com/docs/api-reference/images/createEdit)

### List Models

#### GET /v1/models

- **Auth:** Not required
- **Description:** Returns all configured model aliases. When an alias has a `metadata` block in `plexus.yaml`, the response includes enriched fields following the OpenRouter model format.

- **Response:**
  ```json
  {
    "object": "list",
    "data": [
      {
        "id": "fast-model",
        "object": "model",
        "created": 1748000000,
    "owned_by": "plexus",
        "name": "OpenAI: GPT-4.1 Nano",
        "description": "GPT-4.1 Nano is a lightweight model for fast tasks.",
        "context_length": 1000000,
        "architecture": {
          "input_modalities": ["text", "image"],
          "output_modalities": ["text"],
          "tokenizer": "GPT"
     },
        "pricing": {
          "prompt": "0.0000001",
       "completion": "0.0000004",
          "input_cache_read": "0.000000025"
      },
        "supported_parameters": ["temperature", "tools", "tool_choice", "max_tokens"],
        "top_provider": {
          "context_length": 1000000,
          "max_completion_tokens": 32768
        }
      },
      {
        "id": "plain-model",
        "object": "model",
        "created": 1748000000,
        "owned_by": "plexus"
      }
    ]
  }
  ```

  Aliases without a `metadata` block return only: `id`, `object`, `created`, `owned_by`. Additional aliases (from `additional_aliases`) inherit the parent alias's metadata.

#### GET /v1/openrouter/models

- **Auth:** Not required
- **Description:** Returns models fetched from OpenRouter (requires an OpenRouter provider configured in `plexus.yaml`).

#### GET /v1/metadata/search

- **Auth:** Not required
- **Description:** Search a loaded metadata catalog for use in the admin UI autocomplete when assigning metadata to an alias.
- **Query Parameters:**
  - `source` (required): `openrouter`, `models.dev`, or `catwalk`
  - `q` (optional): Substring search string. Omit or leave empty to return all models (up to `limit`).
  - `limit` (optional, int): Maximum results to return. Default `50`, max `200`.
- **Response:**
  ```json
  {
    "data": [
      { "id": "openai/gpt-4.1-nano", "name": "OpenAI: GPT-4.1 Nano" },
      { "id": "openai/gpt-4o", "name": "OpenAI: GPT-4o" }
    ],
    "count": 2
  }
  ```
- **Error Responses:**
  - `400 Bad Request`: Missing or invalid `source` parameter.
  - `503 Service Unavailable`: The requested source has not been loaded (either still loading or failed at startup).

---
## Management APIs (`/v0/management`)

Management endpoints do **not** require API key authentication. They are intended for administrative use and should be network-restricted in production.

### Configuration

#### Get Configuration
- **Endpoint:** `GET /v0/management/config`
- **Description:** Returns the raw `plexus.yaml` configuration file.
- **Response Header:** `Content-Type: application/x-yaml`
- **Response Body:** Raw YAML content.

#### Update Configuration
- **Endpoint:** `POST /v0/management/config`
- **Description:** Replaces the configuration file. Validates the YAML against the full schema before writing.
- **Request Headers:** `Content-Type: application/x-yaml` or `text/plain`
- **Request Body:** Complete YAML configuration.
- **Responses:**
  - `200 OK`: Config written and reloaded. Returns new config as YAML.
  - `400 Bad Request`: Schema validation failed. Body contains `{ "error": "...", "details": [...] }`.
  - `500 Internal Server Error`: File write failed.

#### Delete Model Alias
- **Endpoint:** `DELETE /v0/management/models/:aliasId`
- **Path Parameters:** `aliasId` — the alias key to remove.
- **Responses:**
  - `200 OK`: `{ "success": true }`
  - `404 Not Found`: Config file or alias not found.
  - `500 Internal Server Error`: Write failed.

#### Delete All Model Aliases
- **Endpoint:** `DELETE /v0/management/models`
- **Responses:**
  - `200 OK`: `{ "success": true, "deletedCount": 18 }`
  - `404 Not Found`: Config file not found.

#### Delete Provider
- **Endpoint:** `DELETE /v0/management/providers/:providerId`
- **Path Parameters:** `providerId` — provider key from config.
- **Query Parameters:**
  - `cascade` (optional, `true`/`false`): When `true`, also removes all model targets that reference this provider.
- **Responses:**
  - `200 OK`:
    ```json
    {
      "success": true,
      "provider": "openai_direct",
      "removedTargets": 3,
      "affectedAliases": ["fast-model", "smart-model"]
    }
    ```
    `removedTargets` and `affectedAliases` are only present when `cascade=true`.
  - `404 Not Found`: Config file or provider not found.

---

### Usage Records

#### List Usage Records
- **Endpoint:** `GET /v0/management/usage`
- **Query Parameters:**
  - `limit` (optional, int): Records to return — default `50`.
  - `offset` (optional, int): Records to skip — default `0`.
  - `startDate` (optional): ISO date string, e.g. `2025-01-01`.
  - `endDate` (optional): ISO date string.
  - `apiKey` (optional): Filter by API key name.
  - `attribution` (optional): Filter by attribution label.
  - `incomingApiType` (optional): `chat`, `messages`, `responses`, etc.
  - `provider` (optional): Upstream provider name.
  - `incomingModelAlias` (optional): Model name requested by the client.
  - `selectedModelName` (optional): Actual upstream model used.
  - `outgoingApiType` (optional): API format used with the provider.
  - `responseStatus` (optional): `success` or `error`.
  - `minDurationMs` (optional, int): Minimum request duration.
  - `maxDurationMs` (optional, int): Maximum request duration.
  - `fields` (optional): Comma-separated list of field names to return. When provided, only those fields are included in each record. Valid values are any field names from the response object below.

- **Response Format:**
  ```json
  {
    "data": [ { ...UsageRecord... } ],
    "total": 1250
  }
  ```

- **UsageRecord Fields:**

| Field | Type | Description |
|-------|------|-------------|
| `requestId` | string | UUID for the request |
| `date` | string | ISO timestamp |
| `startTime` | number | Epoch ms when the request started |
| `sourceIp` | string\|null | Client IP address |
| `apiKey` | string\|null | API key name used |
| `attribution` | string\|null | Attribution label from Dynamic Key Attribution |
| `incomingApiType` | string | API format received (`chat`, `messages`, `responses`, etc.) |
| `provider` | string\|null | Provider key from config |
| `attemptCount` | number | Number of dispatch attempts (including retries) |
| `incomingModelAlias` | string\|null | Model name sent by the client |
| `canonicalModelName` | string\|null | Normalized model identifier |
| `selectedModelName` | string\|null | Actual model name sent to provider |
| `finalAttemptProvider` | string\|null | Provider used on the final attempt |
| `finalAttemptModel` | string\|null | Model used on the final attempt |
| `allAttemptedProviders` | string\|null | JSON array of all providers tried |
| `outgoingApiType` | string\|null | API format used with the provider |
| `tokensInput` | number\|null | Input tokens |
| `tokensOutput` | number\|null | Output tokens |
| `tokensReasoning` | number\|null | Reasoning/thinking tokens |
| `tokensCached` | number\|null | Cache read tokens |
| `tokensCacheWrite` | number\|null | Cache write tokens |
| `tokensEstimated` | number\|null | `1` if token counts were estimated |
| `costInput` | number\|null | Input cost in USD |
| `costOutput` | number\|null | Output cost in USD |
| `costCached` | number\|null | Cache read cost in USD |
| `costCacheWrite` | number\|null | Cache write cost in USD |
| `costTotal` | number\|null | Total cost in USD |
| `costSource` | string\|null | Pricing method used (see below) |
| `costMetadata` | string\|null | JSON string with pricing detail |
| `durationMs` | number | Total request duration in ms |
| `ttftMs` | number\|null | Time to first token in ms |
| `tokensPerSec` | number\|null | Output tokens per second |
| `isStreamed` | boolean | Whether the response was streamed |
| `isPassthrough` | boolean | Whether request was passed through untransformed |
| `responseStatus` | string | `success` or `error` |
| `toolsDefined` | number\|null | Number of tools defined in the request |
| `messageCount` | number\|null | Number of messages in the request |
| `parallelToolCallsEnabled` | boolean\|null | Whether parallel tool calls were enabled |
| `toolCallsCount` | number\|null | Number of tool calls in the response |
| `finishReason` | string\|null | Stop reason from the provider |
| `hasDebug` | boolean | Whether a debug log exists for this request |
| `hasError` | boolean | Whether an error log exists for this request |

- **`costSource` values:**
  - `default`: No pricing configured; all cost fields are zero.
  - `simple`: Per-token pricing from `input_price_per_million` / `output_price_per_million` on the model.
  - `openrouter`: Pricing fetched from OpenRouter at request time.
  - `defined`: Explicit pricing from `pricing.input` / `pricing.output` in model config.
  - `per_request`: Flat fee per call; full amount in `costInput`, others zero.

#### Usage Summary
- **Endpoint:** `GET /v0/management/usage/summary`
- **Description:** Returns aggregated time-series data and totals for a time range.
- **Query Parameters:**
  - `range` (optional): `hour`, `day`, `week`, `month` — default `day`
- **Response Format:**
  ```json
  {
    "range": "day",
    "series": [
      {
        "bucketStartMs": 1735689600000,
        "requests": 42,
        "inputTokens": 12500,
        "outputTokens": 8300,
        "cachedTokens": 1200,
        "cacheWriteTokens": 400,
        "tokens": 22400
      }
    ],
    "stats": {
      "totalRequests": 1250,
      "totalTokens": 580000,
      "avgDurationMs": 1340
    },
    "today": {
      "requests": 85,
      "inputTokens": 24000,
      "outputTokens": 16000,
      "reasoningTokens": 800,
      "cachedTokens": 2400,
      "cacheWriteTokens": 600,
      "totalCost": 0.42
    }
  }
  ```
  - `series`: Time-bucketed request counts and token totals for the requested range.
  - `stats`: Aggregated totals over the last 7 days.
  - `today`: Totals since midnight local time, including cost.

#### Delete All Usage Records
- **Endpoint:** `DELETE /v0/management/usage`
- **Query Parameters:**
  - `olderThanDays` (optional, int): Only delete records older than this many days. Omit to delete all records.
- **Response:** `{ "success": true }`

#### Delete Single Usage Record
- **Endpoint:** `DELETE /v0/management/usage/:requestId`
- **Path Parameters:** `requestId` — UUID of the record to delete.
- **Responses:**
  - `200 OK`: `{ "success": true }`
  - `404 Not Found`: Record not found.

---

### Debug Mode

#### Get Debug Status
- **Endpoint:** `GET /v0/management/debug`
- **Response:**
  ```json
  { "enabled": true, "providers": ["openai", "anthropic"] }
  ```
  - `providers`: List of provider IDs being logged, or `null` to log all.

#### Set Debug Mode
- **Endpoint:** `POST /v0/management/debug`
- **Request Body:**
  ```json
  { "enabled": true, "providers": ["openai"] }
  ```
  - `enabled` (required): Enable or disable debug logging.
  - `providers` (optional): Limit logging to specific provider IDs. Omit or set `null` for all providers.

#### List Debug Logs
- **Endpoint:** `GET /v0/management/debug/logs`
- **Query Parameters:**
  - `limit` (optional): Default `50`.
  - `offset` (optional): Default `0`.
- **Response:**
  ```json
  [{ "requestId": "uuid", "createdAt": 1735689599000 }]
  ```

#### Get Debug Log Detail
- **Endpoint:** `GET /v0/management/debug/logs/:requestId`
- **Response:**
  ```json
  {
    "requestId": "uuid",
    "rawRequest": {},
    "transformedRequest": {},
    "rawResponse": {},
    "transformedResponse": {},
    "rawResponseSnapshot": {},
    "transformedResponseSnapshot": {},
    "createdAt": 1735689599000
  }
  ```

#### Delete Debug Log
- **Endpoint:** `DELETE /v0/management/debug/logs/:requestId`
- **Response:** `{ "success": true }`

#### Delete All Debug Logs
- **Endpoint:** `DELETE /v0/management/debug/logs`
- **Response:** `{ "success": true }`

---

### Logging Level

Manage backend log verbosity at runtime without restarting.

#### Get Logging Level
- **Endpoint:** `GET /v0/management/logging/level`
- **Response:**
  ```json
  {
    "level": "debug",
    "startupLevel": "info",
    "supportedLevels": ["error", "warn", "info", "debug", "verbose", "silly"],
    "ephemeral": true
  }
  ```

#### Set Logging Level
- **Endpoint:** `POST /v0/management/logging/level`
- **Request Body:** `{ "level": "silly" }`
- **Notes:** Runtime-only. Resets on process restart.

#### Reset Logging Level
- **Endpoint:** `DELETE /v0/management/logging/level`
- **Description:** Resets back to the startup default (`LOG_LEVEL` env, `DEBUG=true`, or `info`).

---

### Cooldowns

#### List Active Cooldowns
- **Endpoint:** `GET /v0/management/cooldowns`
- **Response:**
  ```json
  [
    {
      "provider": "openai_direct",
      "model": "gpt-4o",
      "expiry": 1735689999000,
      "timeRemainingMs": 120000,
      "consecutiveFailures": 3
    }
  ]
  ```
  Providers configured with `disable_cooldown: true` never appear here.

#### Clear All Cooldowns
- **Endpoint:** `DELETE /v0/management/cooldowns`
- **Response:** `{ "success": true }`

#### Clear Cooldowns for a Provider
- **Endpoint:** `DELETE /v0/management/cooldowns/:provider`
- **Path Parameters:** `provider` — provider key from config.
- **Query Parameters:**
  - `model` (optional): Limit the clear to a single provider+model pair.
- **Response:** `{ "success": true }`

---

### Provider Test

Run a lightweight test inference request to verify a provider/model pair.

- **Endpoint:** `POST /v0/management/test`
- **Request Body:**
  ```json
  { "provider": "openai", "model": "gpt-4o", "apiType": "chat" }
  ```
  `apiType`: `chat`, `messages`, `gemini`, `responses`, `embeddings`, `images`, `speech`, `oauth`
- **Response:**
  ```json
  { "success": true, "durationMs": 420, "apiType": "chat", "response": "acknowledged" }
  ```

---

### Performance Metrics

#### Get Performance Metrics
- **Endpoint:** `GET /v0/management/performance`
- **Query Parameters:**
  - `provider` (optional): Filter by provider name.
  - `model` (optional): Filter by model name.
- **Response:**
  ```json
  [
    {
      "provider": "openai_direct",
      "model": "gpt-4o",
      "avg_ttft_ms": 320.5,
      "min_ttft_ms": 210.0,
      "max_ttft_ms": 550.2,
      "avg_tokens_per_sec": 65.4,
      "min_tokens_per_sec": 45.1,
      "max_tokens_per_sec": 88.9,
      "sample_count": 10,
      "last_updated": 1735689599000
    }
  ]
  ```

---

### OAuth Providers

Plexus exposes OAuth helpers for providers backed by pi-ai (Anthropic OAuth, GitHub Copilot, Gemini CLI, Antigravity, OpenAI Codex).

#### List OAuth Providers
- **Endpoint:** `GET /v0/management/oauth/providers`
- **Response:**
  ```json
  { "data": [{ "id": "openai-codex", "name": "OpenAI Codex", "usesCallbackServer": false }], "total": 1 }
  ```

#### Start OAuth Session
- **Endpoint:** `POST /v0/management/oauth/sessions`
- **Request Body:** `{ "providerId": "openai-codex", "accountId": "work" }`
- **Response:**
  ```json
  {
    "data": {
      "id": "session_123",
      "providerId": "openai-codex",
      "accountId": "work",
      "status": "waiting",
      "authInfo": { "url": "https://...", "instructions": "..." },
      "prompt": null,
      "progress": [],
      "createdAt": 1735689599000,
      "updatedAt": 1735689599000
    }
  }
  ```

#### Get OAuth Session
- **Endpoint:** `GET /v0/management/oauth/sessions/:id`
- **Description:** Poll for latest session status.

#### Submit OAuth Prompt
- **Endpoint:** `POST /v0/management/oauth/sessions/:id/prompt`
- **Request Body:** `{ "value": "yes" }`

#### Submit Manual Code
- **Endpoint:** `POST /v0/management/oauth/sessions/:id/manual-code`
- **Request Body:** `{ "value": "4/0Ad..." }`

#### Cancel OAuth Session
- **Endpoint:** `POST /v0/management/oauth/sessions/:id/cancel`

#### Delete OAuth Credentials
- **Endpoint:** `DELETE /v0/management/oauth/credentials`
- **Request Body:** `{ "providerId": "openai-codex", "accountId": "work" }`
- **Response:** `{ "data": { "deleted": true } }`

---
### Inference Error Logs

Error records are saved automatically whenever an inference request fails.

#### List Error Logs
- **Endpoint:** `GET /v0/management/errors`
- **Query Parameters:**
  - `limit` (optional): Default `50`.
  - `offset` (optional): Default `0`.
- **Response:** Array of error log objects.

#### Delete All Error Logs
- **Endpoint:** `DELETE /v0/management/errors`
- **Response:** `{ "success": true }`

#### Delete Single Error Log
- **Endpoint:** `DELETE /v0/management/errors/:requestId`
- **Path Parameters:** `requestId` — UUID of the error to delete.
- **Responses:**
  - `200 OK`: `{ "success": true }`
  - `404 Not Found`: Log not found.

---

### MCP Proxy Logs

Usage records for requests proxied through the MCP proxy.

#### List MCP Logs
- **Endpoint:** `GET /v0/management/mcp-logs`
- **Query Parameters:**
  - `limit` (optional): Default `20`.
  - `offset` (optional): Default `0`.
  - `serverName` (optional): Filter by MCP server name.
  - `apiKey` (optional): Filter by API key name.
- **Response:**
  ```json
  { "data": [ { ...McpRequestUsageRecord... } ], "total": 45 }
  ```

#### Delete All MCP Logs
- **Endpoint:** `DELETE /v0/management/mcp-logs`
- **Query Parameters:**
  - `olderThanDays` (optional, int): Only delete logs older than this many days. Omit to delete all.
- **Response:** `{ "success": true }`

#### Delete Single MCP Log
- **Endpoint:** `DELETE /v0/management/mcp-logs/:requestId`
- **Path Parameters:** `requestId` — UUID of the log to delete.
- **Responses:**
  - `200 OK`: `{ "success": true }`
  - `404 Not Found`: Log not found.

---

### MCP Server Configuration

Manage MCP server entries in `plexus.yaml` via the API.

#### List MCP Servers
- **Endpoint:** `GET /v0/management/mcp-servers`
- **Response:** Object mapping server names to their config:
  ```json
  {
    "my-server": {
      "upstream_url": "http://localhost:3001",
      "enabled": true,
      "headers": {}
    }
  }
  ```

#### Create or Update MCP Server
- **Endpoint:** `POST /v0/management/mcp-servers/:serverName`
- **Path Parameters:** `serverName` — slug (lowercase letters, numbers, hyphens, underscores, 2–63 chars).
- **Request Body (JSON):**
  - `upstream_url` (required): URL of the upstream MCP server.
  - `enabled` (optional, boolean): Default `true`.
  - `headers` (optional, object): Static headers to forward to the upstream server.
- **Responses:**
  - `200 OK`: `{ "success": true, "name": "my-server", "upstream_url": "...", "enabled": true, "headers": {} }`
  - `400 Bad Request`: Missing `upstream_url` or invalid server name.
  - `404 Not Found`: Config file not found.

#### Delete MCP Server
- **Endpoint:** `DELETE /v0/management/mcp-servers/:serverName`
- **Path Parameters:** `serverName` — name of the MCP server to remove.
- **Responses:**
  - `200 OK`: `{ "success": true }`
  - `404 Not Found`: Server or config file not found.

---

### User Quota Definitions

CRUD for per-key quota definitions stored in `plexus.yaml`. These define *what* a quota is — to assign a quota to a key, set `quota: <name>` on the key in config. See [CONFIGURATION.md — User Quotas](./CONFIGURATION.md#user-quotas).

#### List All Quota Definitions
- **Endpoint:** `GET /v0/management/user-quotas`
- **Response:** Object mapping quota names to their definitions:
  ```json
  {
    "premium_hourly": {
      "type": "rolling",
      "duration": "1h",
      "limit": 100000,
      "limitType": "tokens"
    }
  }
  ```

#### Get a Quota Definition
- **Endpoint:** `GET /v0/management/user-quotas/:name`
- **Path Parameters:** `name` — quota name.
- **Responses:**
  - `200 OK`: `{ "name": "premium_hourly", "type": "rolling", ... }`
  - `404 Not Found`: Quota not found.

#### Create or Replace a Quota Definition
- **Endpoint:** `POST /v0/management/user-quotas/:name`
- **Path Parameters:** `name` — slug (lowercase, numbers, hyphens/underscores, 2–63 chars).
- **Request Body (JSON):**
  - `type` (required): `rolling`, `daily`, or `weekly`.
  - `limitType` (required): `requests` or `tokens`.
  - `limit` (required, number): Maximum allowed value.
  - `duration` (required for `type: rolling`): Duration string, e.g. `1h`, `30m`, `1d`.
- **Responses:**
  - `200 OK`: `{ "success": true, "name": "...", "quota": { ... } }`
  - `400 Bad Request`: Invalid name, missing fields, or schema validation failure.

#### Partially Update a Quota Definition
- **Endpoint:** `PATCH /v0/management/user-quotas/:name`
- **Path Parameters:** `name` — quota name.
- **Request Body (JSON):** Any subset of quota fields to update. Merged with existing definition.
- **Responses:**
  - `200 OK`: `{ "success": true, "name": "...", "quota": { ... } }`
  - `404 Not Found`: Quota not found.

#### Delete a Quota Definition
- **Endpoint:** `DELETE /v0/management/user-quotas/:name`
- **Path Parameters:** `name` — quota name.
- **Notes:** Returns `409 Conflict` if any configured key is currently assigned this quota. Remove or reassign the key first.
- **Responses:**
  - `200 OK`: `{ "success": true, "name": "...", "message": "..." }`
  - `404 Not Found`: Quota not found.
  - `409 Conflict`: Quota is assigned to one or more keys.

---

### Quota Checker Types

#### List Valid Quota Checker Types
- **Endpoint:** `GET /v0/management/quota-checker-types`
- **Description:** Returns the list of built-in quota checker type strings that can be used in `plexus.yaml`.
- **Response:**
  ```json
  {
    "types": ["naga", "synthetic", "nanogpt", "zai", "moonshot", "minimax", "openrouter", "kilo", "openai-codex", "claude-code", "copilot", "wisdomgate", "apertis"],
    "count": 13
  }
  ```

---

### User Quota Enforcement

#### Clear Quota Usage
- **Endpoint:** `POST /v0/management/quota/clear`
- **Description:** Resets quota usage counters to zero for a specific API key.
- **Request Body:** `{ "key": "acme_corp" }`
- **Response:** `{ "success": true, "key": "acme_corp", "message": "Quota reset successfully" }`

#### Get Quota Status
- **Endpoint:** `GET /v0/management/quota/status/:key`
- **Path Parameters:** `key` — API key name.
- **Response (quota assigned):**
  ```json
  {
    "key": "acme_corp",
    "quota_name": "premium_hourly",
    "allowed": true,
    "current_usage": 45000,
    "limit": 100000,
    "remaining": 55000,
    "resets_at": "2026-02-19T01:00:00.000Z"
  }
  ```
- **Response (no quota assigned):**
  ```json
  {
    "key": "free_user",
    "quota_name": null,
    "allowed": true,
    "current_usage": 0,
    "limit": null,
    "remaining": null,
    "resets_at": null
  }
  ```

#### Quota Enforcement Behavior

When a quota is exceeded, inference requests receive HTTP `429`:

```json
{
  "error": {
    "message": "Quota exceeded: premium_hourly limit of 100000 reached",
    "type": "quota_exceeded",
    "quota_name": "premium_hourly",
    "current_usage": 125671,
    "limit": 100000,
    "resets_at": "2026-02-19T01:00:00.000Z"
  }
}
```

---
## Quota Management (`/v0/quotas`)

Monitor provider-level rate limits and account quotas. These are distinct from *user* quotas — they track the upstream provider's limits, not per-key limits.

### List All Quota Checkers
- **Endpoint:** `GET /v0/quotas`
- **Response:**
  ```json
  [
    {
      "checkerId": "synthetic-main",
      "checkerType": "synthetic",
      "latest": [
        {
          "provider": "synthetic",
          "checkerId": "synthetic-main",
          "windowType": "subscription",
          "limit": 1000.0,
          "used": 381.5,
          "remaining": 618.5,
          "utilizationPercent": 38.15,
          "unit": "dollars",
          "status": "ok"
        }
      ]
    }
  ]
  ```
  - `checkerId`: Configured checker identifier (may be a custom name).
  - `checkerType`: Checker implementation type (e.g. `naga`, `moonshot`). Use this for UI type routing, not `checkerId`.

### Get Latest Quota for a Checker
- **Endpoint:** `GET /v0/quotas/:checkerId`
- **Response:** Same shape as above but for a single checker.

### Get Quota History
- **Endpoint:** `GET /v0/quotas/:checkerId/history`
- **Query Parameters:**
  - `windowType` (optional): Filter by window type, e.g. `subscription`, `five_hour`, `daily`.
  - `since` (optional): Start date. ISO timestamp or relative format: `7d`, `30d`.
- **Response:**
  ```json
  {
    "checkerId": "anthropic-pro",
    "windowType": "five_hour",
    "since": "2026-01-26T00:00:00.000Z",
    "history": [
      {
        "id": 123,
        "provider": "anthropic",
        "checkerId": "anthropic-pro",
        "groupId": null,
        "windowType": "five_hour",
        "checkedAt": 1735689599000,
        "limit": 100,
        "used": 45,
        "remaining": 55,
        "utilizationPercent": 45.0,
        "unit": "percentage",
        "resetsAt": 1735704000000,
        "status": "ok",
        "success": 1,
        "errorMessage": null
      }
    ]
  }
  ```

### Trigger Immediate Check
- **Endpoint:** `POST /v0/quotas/:checkerId/check`
- **Description:** Forces an immediate quota check outside the normal polling interval.
- **Response:** The `QuotaCheckResult` for the checker.

---

## Server-Sent Event Streams

These endpoints use `text/event-stream` (SSE) for real-time data. Connect with an `EventSource` or `curl -N`. Each connection is kept alive with periodic `ping` events every 10 seconds.

### Live Usage Events
- **Endpoint:** `GET /v0/management/events`
- **Description:** Streams a `log` event for every completed inference request as it is saved to the database. Useful for real-time dashboards.
- **Event format:**
  ```
  event: log
  data: { ...UsageRecord... }
  id: 1735689599000
  ```

### System Log Stream
- **Endpoint:** `GET /v0/system/logs/stream`
- **Description:** Streams all backend log entries in real-time as `syslog` events.
- **Event format:**
  ```
  event: syslog
  data: { "level": "info", "message": "...", "timestamp": "..." }
  id: 1735689599000
  ```

---

## MCP Proxy (`/mcp/:name`)

Plexus can proxy MCP (Model Context Protocol) servers configured under `mcp_servers` in `plexus.yaml`.

### MCP Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/mcp/:name` | JSON-RPC message exchange |
| `GET`  | `/mcp/:name` | Server-Sent Events for streaming |
| `DELETE` | `/mcp/:name` | Session termination |

**Path Parameters:**
- `:name` — key from your `mcp_servers` configuration.

### Authentication

MCP endpoints require a valid Plexus API key:

```bash
curl -X POST http://localhost:4000/mcp/my-server \
  -H "Authorization: Bearer sk-your-plexus-key" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"initialize","params":{...},"id":0}'
```

**Important:** Client `Authorization` and `x-api-key` headers are **not** forwarded to the upstream MCP server. Only static headers from `plexus.yaml` are used for upstream authentication.

### OAuth Discovery Endpoints

Plexus exposes OAuth 2.0 discovery endpoints for MCP client compatibility. These are unauthenticated.

| Endpoint | Description |
|----------|-------------|
| `GET /.well-known/oauth-authorization-server` | Authorization server metadata |
| `GET /.well-known/oauth-protected-resource` | Protected resource metadata |
| `GET /.well-known/openid-configuration` | OpenID Connect configuration |
| `POST /register` | Dynamic client registration |

These return metadata indicating Plexus uses Bearer token (API key) authentication.

---

## Reference Tables

### Quota Window Types

| Window Type | Description |
|-------------|-------------|
| `subscription` | Monthly/billing-cycle quota or prepaid balance |
| `hourly` | Hourly rolling window |
| `five_hour` | 5-hour rolling window (Anthropic) |
| `daily` | Daily reset quota |
| `weekly` | 7-day rolling window (Anthropic) |
| `monthly` | Calendar month quota |
| `custom` | Provider-specific window |

### Quota Status Levels

| Status | Utilization | Description |
|--------|-------------|-------------|
| `ok` | 0–75% | Healthy, plenty of quota remaining |
| `warning` | 75–90% | Approaching exhaustion |
| `critical` | 90–100% | Near exhaustion, take action soon |
| `exhausted` | 100% | Quota fully consumed, requests will fail |
