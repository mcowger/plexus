# Plexus 2 API Documentation

This document describes the API endpoints available in Plexus 2.

## Standard Inference APIs

Plexus 2 provides compatibility layers for major AI provider formats.

### Chat Compatible (OpenAI)
- **Endpoint:** `POST /v1/chat/completions`
- **Description:** Compatible with the OpenAI Chat Completions API.
- **Documentation:** See [OpenAI API Reference](https://platform.openai.com/docs/api-reference/chat) for request and response formats.

### Messages Compatible (Anthropic)
- **Endpoint:** `POST /v1/messages`
- **Description:** Compatible with the Anthropic Messages API.
- **Documentation:** See [Anthropic API Reference](https://docs.anthropic.com/en/api/messages) for request and response formats.

### Embeddings Compatible (OpenAI)
- **Endpoint:** `POST /v1/embeddings`
- **Description:** Compatible with the OpenAI Embeddings API. Works with any provider that supports OpenAI-compatible embeddings (OpenAI, Voyage AI, Cohere, Google, etc.).
- **Documentation:** See [OpenAI Embeddings API Reference](https://platform.openai.com/docs/api-reference/embeddings) for request and response formats.
- **Model Type:** Models must be configured with `type: embeddings` to be accessible via this endpoint.
- **Pass-through:** Embeddings requests are always pass-through (no protocol transformation needed).

### Audio Transcriptions Compatible (OpenAI)
- **Endpoint:** `POST /v1/audio/transcriptions`
- **Description:** Compatible with the OpenAI Audio Transcriptions API. Accepts multipart/form-data with audio files and transcribes them to text.
- **Documentation:** See [OpenAI Audio API Reference](https://platform.openai.com/docs/api-reference/audio/createTranscription) for request and response formats.
- **Model Type:** Models must be configured with `type: transcriptions` to be accessible via this endpoint.
- **Supported Models:** `whisper-1`, `gpt-4o-transcribe`, `gpt-4o-mini-transcribe`, and compatible models.
- **Supported Formats:** Audio files up to 25MB in formats: mp3, mp4, mpeg, mpga, m4a, ogg, wav, webm.
- **Response Formats:** Currently supports `json` and `text` formats. Additional formats (srt, vtt, verbose_json, diarized_json) coming in future versions.
- **Streaming:** Not supported in v1 (coming in future versions).
- **Pass-through:** Transcription requests are always pass-through (no protocol transformation needed).

### Audio Speech Compatible (OpenAI)
- **Endpoint:** `POST /v1/audio/speech`
- **Description:** Compatible with the OpenAI Audio Speech API. Generates audio from text using text-to-speech models.
- **Documentation:** See [OpenAI Audio Speech API Reference](https://platform.openai.com/docs/api-reference/audio/createSpeech) for request and response formats.
- **Model Type:** Models must be configured with `type: speech` to be accessible via this endpoint.
- **Supported Models:** `tts-1`, `tts-1-hd`, `gpt-4o-mini-tts`, and compatible TTS models.
- **Request Body (JSON):**
  - `model` (required): TTS model identifier
  - `input` (required): Text to convert to speech (max 4096 characters)
  - `voice` (required): Voice to use (alloy, ash, ballad, coral, echo, fable, onyx, nova, sage, shimmer, verse, marin, cedar)
  - `instructions` (optional): Voice style control (not supported on tts-1 or tts-1-hd)
  - `response_format` (optional): Output format (mp3, opus, aac, flac, wav, pcm). Default: mp3
  - `speed` (optional): Speed multiplier (0.25-4.0). Default: 1.0
  - `stream_format` (optional): Streaming format (sse, audio). Default: audio. Not supported on tts-1 or tts-1-hd.
- **Response:**
  - Binary audio file (default) with appropriate Content-Type header
  - SSE stream when `stream_format: "sse"` with `speech.audio.delta` and `speech.audio.done` events
- **Pass-through:** Speech requests are always pass-through (no protocol transformation needed).

### Image Generation Compatible (OpenAI)
- **Endpoint:** `POST /v1/images/generations`
- **Description:** Compatible with the OpenAI Images Generation API. Creates images from text prompts using any provider supporting OpenAI-compatible image generation (OpenAI, Stability AI, Flux, etc.).
- **Documentation:** See [OpenAI Images API Reference](https://platform.openai.com/docs/api-reference/images/create) for request and response formats.
- **Model Type:** Models must be configured with `type: image` to be accessible via this endpoint.
- **Supported Models:** `dall-e-2`, `dall-e-3`, `gpt-image-1`, `gpt-image-1.5`, `flux-1-schnell`, `flux-2-pro`, and compatible image generation models.
- **Request Body (JSON):**
  - `model` (required): Image generation model identifier
  - `prompt` (required): Text description of the desired image(s)
  - `n` (optional): Number of images to generate (1-10). Default: 1
  - `size` (optional): Image dimensions. Supported: `256x256`, `512x512`, `1024x1024`, `1792x1024`, `1024x1792`. Default varies by model
  - `response_format` (optional): Output format (`url` or `b64_json`). Default: `url`
  - `quality` (optional): Image quality (`standard`, `hd`, `high`, `medium`, `low`). Model dependent
  - `style` (optional): Image style (`vivid`, `natural`). DALL-E 3 only
  - `user` (optional): Unique identifier for end-user tracking
- **Response:**
  - JSON object with `created` timestamp and `data` array
  - Each image object contains `url` (valid for 60 minutes) or `b64_json`
  - Optional `revised_prompt` showing the actual prompt used
  - Optional `usage` field with token counts (GPT Image models)
- **Pass-through:** Image generation requests are always pass-through (no protocol transformation needed).

### Image Editing Compatible (OpenAI)
- **Endpoint:** `POST /v1/images/edits`
- **Description:** Compatible with the OpenAI Images Edit API. Edits or extends an image given an original image and a prompt. Supports single image upload with optional mask.
- **Documentation:** See [OpenAI Images Edit API Reference](https://platform.openai.com/docs/api-reference/images/createEdit) for request and response formats.
- **Model Type:** Models must be configured with `type: image` to be accessible via this endpoint.
- **Supported Models:** `dall-e-2`, `gpt-image-1`, `gpt-image-1.5`, and compatible image editing models.
- **Request Body (multipart/form-data):**
  - `image` (required): The image to edit. PNG file, less than 4MB
  - `prompt` (required): Text description of the desired edit
  - `mask` (optional): Additional image whose transparent areas indicate where to edit. Must match image dimensions
  - `model` (optional): Model identifier. Provider dependent
  - `n` (optional): Number of images to generate (1-10). Default: 1
  - `size` (optional): Image dimensions. DALL-E 2 supports: `256x256`, `512x512`, `1024x1024`. Default: `1024x1024`
  - `response_format` (optional): Output format (`url` or `b64_json`). Default: `url`
  - `quality` (optional): Image quality for GPT Image models (`standard`, `high`, `medium`, `low`)
  - `user` (optional): Unique identifier for end-user tracking
- **Response:**
  - JSON object with `created` timestamp and `data` array
  - Each image object contains `url` (valid for 60 minutes) or `b64_json`
  - Optional `revised_prompt` showing the actual prompt used
- **Pass-through:** Image editing requests are always pass-through (no protocol transformation needed).

### Gemini Compatible (Google)
- **Endpoint:** `POST /v1beta/models/{model}:{action}`
- **Description:** Compatible with the Google Generative Language API (Gemini).
- **Supported Actions:** `generateContent`, `streamGenerateContent`.
- **Documentation:** See [Gemini API Reference](https://ai.google.dev/api/rest/v1beta/models/generateContent) for request and response formats.

---

## Management APIs (`/v0/management`)

The Management APIs provide endpoints for inspecting the system configuration and querying usage data.

### Dashboard Overview
- **Endpoint:** `GET /v0/management/config`
- **Description:** Retrieves the current raw configuration file (`plexus.yaml`).
- **Response Header:** `Content-Type: application/x-yaml`
- **Response Body:** Raw YAML content of the configuration file.

### Update Configuration
- **Endpoint:** `POST /v0/management/config`
- **Description:** Updates the system configuration file.
- **Request Header:** `Content-Type: application/x-yaml` or `text/plain`
- **Request Body:** Raw YAML content for the new configuration.
- **Validation:** strict schema adherence required.
- **Responses:**
    - `200 OK`: Configuration updated successfully. Returns the new config in body.
    - `400 Bad Request`: Validation failed. Response JSON includes error details.
    - `500 Internal Server Error`: File write failed or path not resolved.

### Model Alias Management

#### Delete Model Alias
- **Endpoint:** `DELETE /v0/management/models/:aliasId`
- **Description:** Deletes a single model alias from the `models` section of the loaded configuration.
- **Path Parameters:**
  - `aliasId`: Model alias ID to delete.
- **Responses:**
  - `200 OK`: Alias deleted successfully.
    ```json
    { "success": true }
    ```
  - `404 Not Found`: Configuration file missing or alias does not exist.
  - `500 Internal Server Error`: Failed to update configuration.

#### Delete All Model Aliases
- **Endpoint:** `DELETE /v0/management/models`
- **Description:** Deletes all configured model aliases by clearing the `models` map in config.
- **Responses:**
  - `200 OK`: All aliases deleted successfully.
    ```json
    { "success": true, "deletedCount": 18 }
    ```
  - `404 Not Found`: Configuration file missing.
  - `500 Internal Server Error`: Failed to update configuration.

### OAuth Providers

Plexus exposes OAuth helpers for providers backed by pi-ai (Anthropic OAuth, GitHub Copilot, Gemini CLI, Antigravity, OpenAI Codex).

#### List OAuth Providers
- **Endpoint:** `GET /v0/management/oauth/providers`
- **Description:** Returns the OAuth providers available on this server.
- **Response Format:**
  ```json
  {
    "data": [
      {
        "id": "openai-codex",
        "name": "OpenAI Codex",
        "usesCallbackServer": false
      }
    ],
    "total": 1
  }
  ```

#### Start OAuth Session
- **Endpoint:** `POST /v0/management/oauth/sessions`
- **Description:** Starts an OAuth login session for a provider/account pair.
- **Request Body:**
  ```json
  { "providerId": "openai-codex", "accountId": "work" }
  ```
- **Response Format:**
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
- **Description:** Fetches the latest session status for polling.

#### Submit OAuth Prompt
- **Endpoint:** `POST /v0/management/oauth/sessions/:id/prompt`
- **Description:** Sends a prompt response back to the OAuth session (e.g., confirmation codes).
- **Request Body:**
  ```json
  { "value": "yes" }
  ```

#### Submit OAuth Manual Code
- **Endpoint:** `POST /v0/management/oauth/sessions/:id/manual-code`
- **Description:** Submits a manual redirect code when the provider requires it.
- **Request Body:**
  ```json
  { "value": "4/0Ad..." }
  ```

#### Cancel OAuth Session
- **Endpoint:** `POST /v0/management/oauth/sessions/:id/cancel`
- **Description:** Cancels an active OAuth session.

#### Delete OAuth Credentials
- **Endpoint:** `DELETE /v0/management/oauth/credentials`
- **Description:** Deletes stored OAuth credentials for a provider/account pair.
- **Request Body:**
  ```json
  { "providerId": "openai-codex", "accountId": "work" }
  ```
- **Response Format:**
  ```json
  { "data": { "deleted": true } }
  ```

### Provider Test

Run a lightweight test request for a provider/model pair. Supports `chat`, `messages`, `gemini`, `responses`, `embeddings`, `images`, `speech`, and `oauth`.

- **Endpoint:** `POST /v0/management/test`
- **Request Body:**
  ```json
  { "provider": "openai", "model": "gpt-4o", "apiType": "chat" }
  ```
- **Response Format:**
  ```json
  {
    "success": true,
    "durationMs": 420,
    "apiType": "chat",
    "response": "acknowledged"
  }
  ```

### Usage Records
- **Endpoint:** `GET /v0/management/usage`
- **Description:** Returns a paginated list of usage records with support for extensive filtering.
- **Query Parameters:**
  - `limit` (optional): Number of records to return (default: 50).
  - `offset` (optional): Number of records to skip (default: 0).
  - `startDate` (optional): ISO date string (e.g., `2023-01-01`).
  - `endDate` (optional): ISO date string.
  - `apiKey` (optional): Filter by API key name (e.g., `app-key`).
  - `attribution` (optional): Filter by attribution label (e.g., `copilot`, `claude`). Used to track usage by feature or application variant when using [Dynamic Key Attribution](./CONFIGURATION.md#dynamic-key-attribution).
  - `incomingApiType` (optional): e.g., `chat`, `messages`.
  - `provider` (optional): The upstream provider name.
  - `incomingModelAlias` (optional): The model name requested by the client.
  - `selectedModelName` (optional): The actual upstream model name used.
  - `outgoingApiType` (optional): The API format used to communicate with the provider.
  - `minDurationMs` (optional): Minimum request duration in milliseconds.
  - `maxDurationMs` (optional): Maximum request duration in milliseconds.
  - `responseStatus` (optional): e.g., `success`, `error`.

- **Response Format:**
  ```json
  {
    "data": [
      {
        "requestId": "uuid",
        "date": "2025-12-31T23:59:59.000Z",
        "sourceIp": "127.0.0.1",
        "apiKey": "app-key",
        "attribution": "copilot",
        "incomingApiType": "chat",
        "provider": "openai_direct",
        "incomingModelAlias": "fast-model",
        "selectedModelName": "gpt-4o-mini",
        "outgoingApiType": "chat",
        "tokensInput": 150,
        "tokensOutput": 450,
        "tokensReasoning": 0,
        "tokensCached": 50,
        "costInput": 0.00075,
        "costOutput": 0.00675,
        "costTotal": 0.0075,
        "costSource": "simple",
        "startTime": 1735689599000,
        "durationMs": 1200,
        "ttftMs": 350.5,
        "tokensPerSec": 45.2,
        "isStreamed": false,
        "isPassthrough": false,
        "responseStatus": "success"
      }
    ],
    "total": 1250
  }
  ```

**Response Fields:**
- `attribution` (optional, string or null): Optional label appended to the API key for tracking usage by feature or application variant. Set when using [Dynamic Key Attribution](./CONFIGURATION.md#dynamic-key-attribution) (e.g., `copilot`, `claude`, `mobile:v2.5`). Null if no attribution was provided with the request.

### Performance Metrics
- **Endpoint:** `GET /v0/management/performance`
- **Description:** Returns aggregated performance metrics (TTFT, TPS) for providers and models.
- **Query Parameters:**
  - `provider` (optional): Filter by provider name.
  - `model` (optional): Filter by model name.

- **Response Format:**
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

### Debug Mode Management

Manage debug logging mode to capture full request/response lifecycles for troubleshooting.

#### Get Debug Status
- **Endpoint:** `GET /v0/management/debug`
- **Description:** Returns the current debug mode status and provider filter settings.
- **Response Format:**
  ```json
  {
    "enabled": true,
    "providers": ["openai", "anthropic"]
  }
  ```
- **Response Fields:**
  - `enabled` (boolean): Whether debug logging is currently active.
  - `providers` (string[] | null): List of provider IDs to filter logs by. When `null` or empty, all providers are logged.

#### Set Debug Mode
- **Endpoint:** `POST /v0/management/debug`
- **Description:** Enables or disables debug logging and optionally sets a provider filter.
- **Request Body:**
  ```json
  {
    "enabled": true,
    "providers": ["openai", "anthropic"]
  }
  ```
- **Request Fields:**
  - `enabled` (required, boolean): Enable or disable debug logging.
  - `providers` (optional, string[]): Array of provider IDs to filter logs by. Only requests to these providers will be logged. Set to `null` or omit to log all providers.
- **Response Format:**
  ```json
  {
    "enabled": true,
    "providers": ["openai", "anthropic"]
  }
  ```

#### List Debug Logs
- **Endpoint:** `GET /v0/management/debug/logs`
- **Description:** Returns a list of debug log metadata (request ID and timestamp).
- **Query Parameters:**
  - `limit` (optional): Number of logs to return (default: 50).
  - `offset` (optional): Number of logs to skip (default: 0).
- **Response Format:**
  ```json
  [
    {
      "requestId": "uuid-string",
      "createdAt": 1735689599000
    }
  ]
  ```

#### Get Debug Log Detail
- **Endpoint:** `GET /v0/management/debug/logs/:requestId`
- **Description:** Returns full debug trace for a specific request.
- **Path Parameters:**
  - `requestId`: The request ID to retrieve.
- **Response Format:**
  ```json
  {
    "requestId": "uuid-string",
    "rawRequest": { ... },
    "transformedRequest": { ... },
    "rawResponse": { ... },
    "transformedResponse": { ... },
    "rawResponseSnapshot": { ... },
    "transformedResponseSnapshot": { ... },
    "createdAt": 1735689599000
  }
  ```

#### Delete Debug Log
- **Endpoint:** `DELETE /v0/management/debug/logs/:requestId`
- **Description:** Deletes a specific debug log.
- **Response Format:**
  ```json
  { "success": true }
  ```

### Logging Level Management

Manage backend log verbosity at runtime without editing `LOG_LEVEL`.

#### Get Logging Level
- **Endpoint:** `GET /v0/management/logging/level`
- **Description:** Returns the current runtime logging level, startup default, and supported values.
- **Response Format:**
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
- **Description:** Updates logging level immediately for the running process.
- **Request Body:**
  ```json
  {
    "level": "silly"
  }
  ```
- **Notes:**
  - Changes are runtime-only and are not persisted.
  - The selected level resets to startup behavior on process restart.

#### Reset Logging Level
- **Endpoint:** `DELETE /v0/management/logging/level`
- **Description:** Resets the runtime override back to the startup default (`LOG_LEVEL`, or `DEBUG=true`, or `info`).

#### Delete All Debug Logs
- **Endpoint:** `DELETE /v0/management/debug/logs`
- **Description:** Deletes all debug logs.
- **Response Format:**
  ```json
  { "success": true }
  ```

---

## Quota Management (`/v0/quotas`)

The Quota Management APIs provide endpoints for monitoring provider rate limits and quotas.

### List All Quota Checkers

- **Endpoint:** `GET /v0/quotas`
- **Description:** Returns a list of all configured quota checkers with their latest status.
- **Response Format:**
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

- **Notes:**
  - `checkerId` is the configured checker identifier (defaults to provider name, but may be custom).
  - `checkerType` is the checker implementation type (e.g. `naga`, `moonshot`, `minimax`) and should be used for UI type routing.

### Get Latest Quota

- **Endpoint:** `GET /v0/quotas/:checkerId`
- **Description:** Returns the latest quota status for a specific checker.
- **Response Format:** Same as list all checkers but for a single checker.

### Get Quota History

- **Endpoint:** `GET /v0/quotas/:checkerId/history`
- **Query Parameters:**
  - `windowType` (optional): Filter by window type (e.g., `subscription`, `five_hour`, `weekly`)
  - `since` (optional): Start date. Can be ISO timestamp or relative format like `7d`, `30d`

- **Response Format:**
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
- **Description:** Triggers an immediate quota check for the specified checker.
- **Response Format:** Returns the `QuotaCheckResult` immediately.

---

## User Quota Enforcement API (`/v0/management/quota`)

Plexus supports per-API-key quota enforcement to limit usage by requests or tokens. Quotas are defined in the configuration and assigned to keys.

### Clear Quota

- **Endpoint:** `POST /v0/management/quota/clear`
- **Description:** Resets quota usage to zero for a specific API key.
- **Request Body:**
  ```json
  {
    "key": "acme_corp"
  }
  ```
- **Response Format:**
  ```json
  {
    "success": true,
    "key": "acme_corp",
    "message": "Quota reset successfully"
  }
  ```

### Get Quota Status

- **Endpoint:** `GET /v0/management/quota/status/:key`
- **Description:** Returns current quota status for an API key.
- **Response Format (with quota assigned):**
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
- **Response Format (no quota assigned):**
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

### Quota Enforcement Behavior

- **Quota Types:** Supports rolling (leaky bucket), daily, and weekly quotas
- **Limit Types:** `requests` (count) or `tokens` (sum of input + output)
- **Quota Exceeded Response:** When quota is exceeded, requests receive HTTP 429:
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

## MCP Proxy API

Plexus can proxy MCP (Model Context Protocol) servers. Configure MCP servers in `plexus.yaml` under the `mcp_servers` section.

### MCP Endpoints

Each configured MCP server is exposed at `/mcp/:name`:

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/mcp/:name` | JSON-RPC message exchange |
| GET | `/mcp/:name` | Server-Sent Events (SSE) for streaming |
| DELETE | `/mcp/:name` | Session termination |

**Path Parameters:**
- `:name` - The key name from your `mcp_servers` configuration

### Authentication

All MCP endpoints require authentication using Plexus API keys:

```bash
# Include Authorization header with your Plexus API key
curl -X POST http://localhost:4000/mcp/my-server \
  -H "Authorization: Bearer sk-your-plexus-key" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"initialize","params":{...},"id":0}'
```

### OAuth Discovery Endpoints

Plexus provides OAuth 2.0 discovery endpoints for MCP client compatibility:

| Endpoint | Description |
|---------|-------------|
| `GET /.well-known/oauth-authorization-server` | Authorization server metadata |
| `GET /.well-known/oauth-protected-resource` | Protected resource metadata |
| `GET /.well-known/openid-configuration` | OpenID Connect configuration |
| `POST /register` | Dynamic client registration |

These endpoints return metadata indicating that Plexus uses Bearer token (API key) authentication.

### Request/Response

MCP requests are proxied transparently to the upstream server. The request body is forwarded as-is (JSON-RPC), and responses are streamed back to the client.

**Important:** Client authentication headers (`Authorization`, `x-api-key`) are NOT forwarded to upstream MCP servers. Only static headers configured in `plexus.yaml` are used for upstream authentication.

---

## Quota Window Types

Quota windows represent different time-based rate limit periods:

| Window Type | Description |
|------------|-------------|
| `subscription` | Monthly/billing cycle based quota |
| `hourly` | Hourly rolling window |
| `five_hour` | 5-hour rolling window (Anthropic) |
| `daily` | Daily reset quota |
| `weekly` | 7-day rolling window (Anthropic) |
| `monthly` | Calendar month quota |
| `custom` | Provider-specific window |

## Quota Status Levels

| Status | Utilization | Description |
|--------|-------------|-------------|
| `ok` | 0-75% | Healthy, plenty of quota remaining |
| `warning` | 75-90% | Approaching exhaustion, plan accordingly |
| `critical` | 90-100% | Near exhaustion, take action soon |
| `exhausted` | 100% | Quota fully consumed, requests will fail |
