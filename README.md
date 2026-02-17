# Plexus

**A Universal LLM API Gateway & Transformation Layer.**

![Dashboard Overview](docs/images/splash.png)

### [🚀 API Reference](docs/API.md) | [⚙️ Configuration](docs/CONFIGURATION.md) | [📦 Installation](docs/INSTALLATION.md)

Plexus unifies interactions with multiple AI providers (OpenAI, Anthropic, Gemini, etc.) under a single API. Switch models and providers without rewriting client code.

### Recent Updates

- **MCP Proxy Support**: Proxy streamable HTTP MCP servers through Plexus; each server is isolated per-request to prevent tool sprawl (stdio transport is not supported)
- **OAuth Providers (pi-ai)**: Authenticate to Anthropic, GitHub Copilot, Gemini CLI, Antigravity, and OpenAI Codex via the Admin UI and route them with `oauth://` providers
- **OAuth Management APIs**: Start, poll, prompt, and cancel OAuth login sessions via `/v0/management/oauth/*`
- **Quota Tracking System**: Monitor provider rate limits and quotas with configurable checkers
- **OAuth-backed Quota Checkers**: `claude-code` and `openai-codex` quota checkers read tokens from `auth.json` by default (no hardcoded quota API key required)
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
  -e AUTH_JSON=/app/auth.json \
  -v $(pwd)/auth.json:/app/auth.json \
  -v plexus-data:/app/data \
  ghcr.io/mcowger/plexus:latest
```

`AUTH_JSON` points Plexus at the OAuth credentials file (default: `./auth.json`).

For OAuth-backed quota checkers (`claude-code`, `openai-codex`), Plexus also uses this file automatically unless an explicit `options.apiKey` override is provided.

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

## MCP Server Proxying

Plexus can proxy [Model Context Protocol (MCP)](https://modelcontextprotocol.io) servers, surfacing their tools to any connected client without requiring the client to manage MCP connections directly.

### Supported Transport

Only **streamable HTTP** MCP servers are supported. The `stdio` transport is intentionally not supported, as it would require spawning and managing local processes, which is incompatible with a network gateway deployment model.

### Per-Request Isolation

Each request that uses MCP tooling connects to the configured MCP server(s) **in isolation**. A fresh session is created for every request and torn down when the request completes. This design prevents **tool sprawl** — the accumulation of stale tool registrations across sessions that can confuse models, inflate context windows, and produce unreliable tool selection.

### Configuration

Declare MCP servers in `config/plexus.yaml` under the relevant model alias or at the global level:

```yaml
mcp_servers:
  - name: my-tools
    url: https://my-mcp-server.example.com/mcp
    # Optional: headers forwarded to the MCP server on each request
    headers:
      Authorization: "Bearer ${MY_MCP_TOKEN}"
```

### How It Works

1. An incoming request arrives at Plexus (e.g., `/v1/chat/completions`).
2. Plexus opens a **new** streamable HTTP session to each configured MCP server.
3. Available tools are fetched and injected into the outgoing request to the upstream LLM provider.
4. Any tool calls returned by the provider are executed against the MCP server within the same isolated session.
5. Results are returned to the provider for the next turn, and the session is closed when the request cycle ends.

## License

MIT License - see LICENSE file.
