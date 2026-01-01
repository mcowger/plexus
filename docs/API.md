# Plexus 2 API Documentation

This document describes the API endpoints available in Plexus 2.

## Standard Inference APIs

Plexus 2 provides compatibility layers for major AI provider formats.

### OpenAI Compatible
- **Endpoint:** `POST /v1/chat/completions`
- **Description:** Compatible with the OpenAI Chat Completions API.
- **Documentation:** See [OpenAI API Reference](https://platform.openai.com/docs/api-reference/chat) for request and response formats.

### Anthropic Compatible
- **Endpoint:** `POST /v1/messages`
- **Description:** Compatible with the Anthropic Messages API.
- **Documentation:** See [Anthropic API Reference](https://docs.anthropic.com/en/api/messages) for request and response formats.

### Gemini Compatible
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
  - `incomingApiType` (optional): e.g., `openai`, `anthropic`.
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
        "apiKey": "sk-...",
        "incomingApiType": "openai",
        "provider": "openai_direct",
        "incomingModelAlias": "fast-model",
        "selectedModelName": "gpt-4o-mini",
        "outgoingApiType": "openai",
        "tokensInput": 150,
        "tokensOutput": 450,
        "tokensReasoning": 0,
        "tokensCached": 50,
        "startTime": 1735689599000,
        "durationMs": 1200,
        "isStreamed": false,
        "responseStatus": "success"
      }
    ],
    "total": 1250
  }
  ```
