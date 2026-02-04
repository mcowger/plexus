# Plexus

**A Universal LLM API Gateway & Transformation Layer.**

![Dashboard Overview](docs/images/splash.png)

### [🚀 API Reference](docs/API.md) | [⚙️ Configuration](docs/CONFIGURATION.md) | [📦 Installation](docs/INSTALLATION.md)

Plexus unifies interactions with multiple AI providers (OpenAI, Anthropic, Gemini, etc.) under a single API. Switch models and providers without rewriting client code.

### Recent Updates

- **Quota Tracking System**: Monitor provider rate limits and quotas with configurable checkers
- **Audio Transcriptions API**: Full OpenAI-compatible `/v1/audio/transcriptions` endpoint support with multipart file uploads
- **Embeddings API**: Full OpenAI-compatible `/v1/embeddings` endpoint support
- **Model Type System**: Distinguish between chat, embeddings, and transcriptions models with automatic API filtering
- **Token Estimation**: Automatic token counting for providers that don't return usage data
- **Bulk Model Import**: Import models directly in provider configuration
- **Direct Model Routing**: Route directly to provider models with `direct/provider/model` format
- **Responses API Support**: Full OpenAI `/v1/responses` endpoint with multi-turn conversation support.  Inckudes support for previous_response_id tracking and injection, something many proxy tools lack.    
- **Automatic Response Cleanup**: Responses are retained for 7 days with hourly cleanup jobs to prevent database bloat

### Database & ORM

Plexus uses **Drizzle ORM** with **SQLite** or **Postgres** for data persistence:

- **Schema Management**: Type-safe database schemas in `packages/backend/drizzle/schema/`
- **Automatic Migrations**: Migrations run automatically on startup
- **Tables**: Usage tracking, provider cooldowns, debug logs, inference errors, performance metrics, quota snapshots


## Quick Start

```bash
docker run -p 4000:4000 \
  -v $(pwd)/config/plexus.yaml:/app/config/plexus.yaml \
  -v plexus-data:/app/data \
  ghcr.io/mcowger/plexus:latest
```

See [Installation Guide](docs/INSTALLATION.md) for other options.

## OpenAI Responses API

Plexus supports the OpenAI `/v1/responses` endpoint with full multi-turn conversation support:

```bash
curl -X POST http://localhost:4000/v1/responses \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o",
    "input": "What is 2+2?",
    "previous_response_id": "resp_abc123"
  }'
```

### previous_response_id Handling

Unlike many LLM gateways that lack multi-turn state management, Plexus correctly handles `previous_response_id`:

- **Stateful Conversations**: Send just the new input and previous_response_id - no need to resend conversation history
- **Automatic Context Loading**: Previous response output items are merged into the current request automatically
- **Storage & Linking**: Responses are stored with TTL cleanup (7 days), linked via previous_response_id references

### Response Storage & TTL

Responses are stored for multi-turn conversation support:

- **Retention**: 7-day TTL (configurable)
- **Automatic Cleanup**: Hourly job removes expired responses and orphaned conversations
- **Management API**: Retrieve, list, or delete stored responses via `/v1/responses/:response_id`

## License

MIT License - see LICENSE file.
