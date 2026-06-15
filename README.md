# Plexus

**A universal LLM API gateway and transformation layer.**

<img src="docs/images/plexus_logo_transparent.png" alt="Plexus Logo" width="120"/>

### [Discord Community](https://discord.com/channels/292942011261124608/1503831216095367239) | [API Reference](/docs/openapi/openapi.yaml) | [Configuration](docs/CONFIGURATION.md) | [Installation](docs/INSTALLATION.md) | [Testing](docs/TESTING.md)

Plexus sits in front of your LLM providers and exposes one consistent API surface for OpenAI, Anthropic, Gemini, OpenAI-compatible providers, OAuth-backed subscriptions, MCP servers, and more. It handles protocol translation, routing, failover, usage tracking, and provider-specific quirks so clients can switch models without rewriting code.

---

## Highlights

- **Unified API surface** for OpenAI Chat Completions, OpenAI Responses, Anthropic Messages, Gemini, embeddings, audio, and images.
- **Provider routing and load balancing** across OpenAI, Anthropic, Google Gemini, DeepSeek, Groq, OpenRouter, and any OpenAI-compatible backend.
- **OAuth-backed providers** for GitHub Copilot, Anthropic Claude, OpenAI Codex, Gemini CLI, and Antigravity through the Admin UI.
- **Model aliases** that map virtual model names to one or more real provider targets using `random`, `in_order`, `cost`, `performance`, `latency`, or `e2e_performance` selectors.
- **Vision fallthrough** that describes images with a vision-capable descriptor model before routing to non-vision models.
- **Automatic failover** with exponential provider cooldowns and optional stall detection for slow or stuck streams.
- **Usage, quota, and cost controls** with per-request logs, token counts, latency, TPS, and per-API-key limits.
- **Admin dashboard** for configuration, analytics, debug traces, provider health, and quota monitoring.
- **MCP proxying** with isolated per-request sessions for streamable HTTP MCP servers.
- **Encryption at rest** for API keys, OAuth tokens, provider secrets, and MCP headers.

---

## Quick Start

`ADMIN_KEY` is required for the dashboard and management API. `DATABASE_URL` is optional and defaults to SQLite at `./data/plexus.db`; use a PostgreSQL connection string for production.

### Docker

```bash
docker run -p 4000:4000 \
  -v plexus-data:/app/data \
  -e ADMIN_KEY="your-admin-password" \
  -e ENCRYPTION_KEY="your-generated-hex-key" \
  ghcr.io/mcowger/plexus:latest
```

### Standalone Binary

Download a pre-built binary from [GitHub Releases](https://github.com/mcowger/plexus/releases/latest):

```bash
# macOS Apple Silicon
curl -L https://github.com/mcowger/plexus/releases/latest/download/plexus-macos -o plexus
chmod +x plexus
ADMIN_KEY="your-admin-password" ./plexus

# Linux x64
curl -L https://github.com/mcowger/plexus/releases/latest/download/plexus-linux -o plexus
chmod +x plexus
ADMIN_KEY="your-admin-password" ./plexus
```

```powershell
# Windows x64
Invoke-WebRequest -Uri "https://github.com/mcowger/plexus/releases/latest/download/plexus.exe" -OutFile "plexus.exe"
$env:ADMIN_KEY = "your-admin-password"
$env:DATABASE_URL = "sqlite://./data/plexus.db"
.\plexus.exe
```

The binary is self-contained; database migrations and the web dashboard are embedded. See [Installation](docs/INSTALLATION.md) for Docker Compose, Windows troubleshooting, source builds, and environment variables.

### Try It

Open the dashboard at `http://localhost:4000`, then create/configure an API key and model alias. Send a request:

```bash
curl -X POST http://localhost:4000/v1/chat/completions \
  -H "Authorization: Bearer sk-plexus-my-key" \
  -H "Content-Type: application/json" \
  -d '{"model": "fast", "messages": [{"role": "user", "content": "Hello!"}]}'
```

OAuth providers are configured in the Admin UI. See [Configuration: OAuth Providers](docs/CONFIGURATION.md#oauth-providers-pi-ai).

---

## Screenshots

| | |
|---|---|
| **Dashboard** — Request volume, token usage, cost trends, and top models. | **Providers** — Configured providers with status, quota indicators, and controls. |
| ![Dashboard](docs/images/dashhome.png) | ![Providers](docs/images/providers.png) |
| **Request Logs** — Per-request model, provider, tokens, cost, latency, and live stream throughput. | **Model Aliases** — Virtual model names, targets, selectors, and routing priorities. |
| ![Logs](docs/images/logs.png) | ![Models](docs/images/models.png) |

---

## Feature Notes

### Protocol Translation

Plexus accepts OpenAI Chat Completions (`/v1/chat/completions`), OpenAI Responses (`/v1/responses`), Anthropic Messages (`/v1/messages`), Gemini native requests, and OpenAI-compatible provider formats. Requests can be translated between providers in both directions, including streaming and tool use. See the [API Reference](/docs/openapi/openapi.yaml).

### Routing

Model aliases can target one or more providers and choose targets by randomness, order, cost, measured performance, latency, or end-to-end performance. `priority: api_match` prefers providers that natively speak the incoming API format. See [Configuration: models](docs/CONFIGURATION.md#models).

### Vision Fallthrough

Vision fallthrough lets image requests work with non-vision target models. Plexus sends images to a descriptor model, inserts the generated descriptions into the request, and routes the transformed request to the configured target. Enable it per model alias in the Admin UI and configure the descriptor model in settings.

### Quotas, Cooldowns, and Stream Safety

Per-key quotas can limit `tokens`, `requests`, or `cost` across rolling, daily, or weekly windows. Failed providers are automatically cooled down with exponential backoff, and stream protection can cancel upstream requests on client disconnect, timeout stalled providers, and show live throughput in request logs. See [Configuration](docs/CONFIGURATION.md).

### MCP Proxy

Plexus can proxy streamable HTTP [Model Context Protocol](https://modelcontextprotocol.io) servers with isolated sessions per request. See [Configuration: MCP Servers](docs/CONFIGURATION.md#mcp-servers-optional).

### Encryption

Set `ENCRYPTION_KEY` to enable AES-256-GCM encryption for sensitive database fields:

```bash
export ENCRYPTION_KEY="$(openssl rand -hex 32)"
```

Existing plaintext values are encrypted on first startup with a key. See [Configuration: Encryption](docs/CONFIGURATION.md#encryption-at-rest-optional).

---

## Admin CLI

Pass a subcommand as the first argument to the binary or `bun run src/index.ts`:

- `rekey` decrypts sensitive fields with the current `ENCRYPTION_KEY` and re-encrypts them with `NEW_ENCRYPTION_KEY`.
- `migrate-quota-snapshots` copies legacy `quota_snapshots` rows into `meter_snapshots`; it is idempotent and safe to rerun.

```bash
ENCRYPTION_KEY="<current-key>" NEW_ENCRYPTION_KEY="<new-key>" ./plexus rekey
DATABASE_URL=sqlite://./data/plexus.db ./plexus migrate-quota-snapshots
```

---

## Development

```bash
bun run setup:hooks
bun run test
```

`bun test` is intentionally blocked; use `bun run test`. See [Testing](docs/TESTING.md).

---

## License

MIT License — see [LICENSE](LICENSE).
