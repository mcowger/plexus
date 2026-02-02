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
