# Plexus

**A Universal LLM API Gateway & Transformation Layer.**

![Dashboard Overview](docs/images/splash.png)

### [🚀 API Reference](docs/API.md) | [⚙️ Configuration](docs/CONFIGURATION.md) | [📦 Installation](docs/INSTALLATION.md)

Plexus unifies interactions with multiple AI providers (OpenAI, Anthropic, Gemini, etc.) under a single API. Switch models and providers without rewriting client code.

### Recent Updates

- **Escalating Cooldown System**: Exponential backoff for provider cooldowns (2min → 4min → 8min → ... → 5hr cap). Success resets failure count. 413 Payload Too Large errors skip cooldowns.
- **User Quota Enforcement**: Per-API-key quota limits using rolling (leaky bucket), daily, or weekly windows. Limit by requests or tokens.
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

## User Quota Enforcement

Plexus supports per-API-key quota enforcement to limit usage by requests or tokens. Assign quotas to keys and enforce limits using rolling (leaky bucket), daily, or weekly windows.

### Features

- **Per-Key Quotas**: Each API key can have its own quota or unlimited access
- **Rolling (Leaky Bucket)**: Continuously "leaks" usage over time (e.g., 1000 requests/hour)
- **Calendar Windows**: Daily (resets at UTC midnight) or Weekly (resets Sunday at UTC midnight)
- **Limit Types**: Count `requests` or sum total `tokens` (input + output + reasoning + cached)
- **Post-Hoc Enforcement**: Requests are processed even if they exceed quota; subsequent requests are blocked with HTTP 429
- **Automatic Reset**: When quota type changes (requests→tokens or vice versa), usage resets automatically

### Quick Example

```yaml
user_quotas:
  premium_hourly:
    type: rolling
    limitType: tokens
    limit: 100000
    duration: 1h

  basic_daily:
    type: daily
    limitType: requests
    limit: 1000

keys:
  acme_corp:
    secret: "sk-acme-secret"
    quota: premium_hourly  # 100k tokens/hour

  free_user:
    secret: "sk-free-secret"
    quota: basic_daily     # 1000 requests/day

  internal_test:
    secret: "sk-test-secret"
    # No quota = unlimited
```

### How Rolling Quotas Work

Rolling quotas use a "leaky bucket" algorithm:

1. **Usage accumulates** after each request
2. **On next request**, usage "leaks" based on elapsed time: `leaked = elapsed_time * (limit / duration)`
3. **New usage added** to remaining amount

**Example**: 10 requests/hour quota
- You make 10 requests at 12:00 PM → `usage = 10`
- At 12:30 PM (30 min later): 50% leaked → `usage = 5`
- New request: `usage = 6`

Even for `requests` quotas, the stored value may be fractional due to leak calculation—this is expected.

See [Configuration Guide](docs/CONFIGURATION.md#user_quotas-optional) and [API Reference](docs/API.md#user-quota-enforcement-api) for details.

## Provider Cooldown System

Plexus implements an intelligent **escalating cooldown system** that temporarily removes unhealthy providers from the routing pool using exponential backoff. This prevents hammering dead providers while allowing quick recovery when they become healthy again.

### How It Works

When a provider encounters an error (except for non-retryable client errors like 400, 413, 422), it enters a cooldown period:

| Failure # | Duration |
|-----------|----------|
| 1st | 2 minutes |
| 2nd | 4 minutes |
| 3rd | 8 minutes |
| 4th | 16 minutes |
| 5th | 32 minutes |
| 6th | 64 minutes (~1 hour) |
| 7th | 128 minutes (~2 hours) |
| 8th | 256 minutes (~4 hours) |
| 9th+ | 300 minutes (5 hour cap) |

**Key Features:**
- **Exponential backoff**: Each failure doubles the cooldown duration (C(n) = min(C_max, C_0 × 2^n))
- **Hard cap**: Maximum cooldown is 5 hours (300 minutes)
- **Success resets**: Any successful request resets the failure count to 0
- **413 handling**: Payload Too Large errors (413) do NOT trigger cooldowns - these are client-side errors that won't resolve with retries
- **Configurable**: Initial duration and max duration are configurable via `plexus.yaml`

### Configuration

Add the optional `cooldown` section to your `plexus.yaml`:

```yaml
# Optional: Configure cooldown behavior
cooldown:
  initialMinutes: 2      # First failure: 2 minutes (default)
  maxMinutes: 300       # Cap at 5 hours (default)
```

**Defaults:**
- `initialMinutes`: 2
- `maxMinutes`: 300 (5 hours)

If omitted, Plexus uses the default values.

### Management API

Monitor and manage cooldowns via the Management API:

- `GET /v0/management/cooldowns` - List all active cooldowns
- `DELETE /v0/management/cooldowns` - Clear all cooldowns
- `DELETE /v0/management/cooldowns/:provider?model=:model` - Clear cooldown for specific provider/model

See [Configuration Guide](docs/CONFIGURATION.md#cooldown-optional) for details.

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
