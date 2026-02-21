# Plexus

**A Universal LLM API Gateway & Transformation Layer.**

<img src="docs/images/plexus_logo_transparent.png" alt="Plexus Logo" width="120"/>

### [🚀 API Reference](docs/API.md) | [⚙️ Configuration](docs/CONFIGURATION.md) | [📦 Installation](docs/INSTALLATION.md) | [🔬 Testing](docs/TESTING.md)

Plexus is a high-performance API gateway that unifies access to multiple AI providers (OpenAI, Anthropic, Google, GitHub Copilot, and more) under a single endpoint. Switch models and providers without rewriting client code.

---

## What is Plexus?

Plexus sits in front of your LLM providers and handles protocol translation, load balancing, failover, and usage tracking — transparently. Send any supported request format to Plexus and it routes to the right provider, transforms as needed, and returns the response in the format your client expects.

**Key capabilities:**

- **Unified API surface** — Accept OpenAI (`/v1/chat/completions`), Anthropic (`/v1/messages`), Gemini, Embeddings, Audio, Images, and Responses (`/v1/responses`) formats
- **Multi-provider routing** — Route to OpenAI, Anthropic, Google Gemini, DeepSeek, Groq, OpenRouter, and any OpenAI-compatible provider
- **OAuth providers** — Authenticate via GitHub Copilot, Anthropic Claude, OpenAI Codex, Gemini CLI, and Antigravity through OAuth (no API key required)
- **Model aliasing & load balancing** — Define virtual model names backed by multiple real providers with `random`, `cost`, `performance`, `latency`, or `in_order` selectors
- **Intelligent failover** — Exponential backoff cooldowns automatically remove unhealthy providers from rotation
- **Usage tracking** — Per-request cost, token counts, latency, and TPS metrics with a built-in dashboard
- **MCP proxy** — Proxy Model Context Protocol servers through Plexus with per-request session isolation
- **User quotas** — Per-API-key rate limiting by requests or tokens with rolling, daily, or weekly windows
- **Admin dashboard** — Web UI for configuration, usage analytics, debug traces, and quota monitoring

---

## Screenshots

| | |
|---|---|
| **Dashboard** — Request volume, token usage, cost trends, and top models. | **Providers** — Configured providers with status, quota indicators, and controls. |
| ![Dashboard](docs/images/dashhome.png) | ![Providers](docs/images/providers.png) |
| **Request Logs** — Per-request details: model, provider, tokens, cost, and latency. | **Model Aliases** — Virtual model names, targets, selectors, and routing priorities. |
| ![Logs](docs/images/logs.png) | ![Models](docs/images/models.png) |

---

## Quick Start

Start with a minimal config file that all options below share:

```yaml
# config/plexus.yaml
adminKey: "change-me"

providers:
  openai:
    api_base_url: https://api.openai.com/v1
    api_key: "sk-your-openai-key"
    models:
      - gpt-4o
      - gpt-4o-mini

models:
  fast:
    targets:
      - provider: openai
        model: gpt-4o-mini

keys:
  my-app:
    secret: "sk-plexus-my-key"
```

`DATABASE_URL` is required and tells Plexus where to store usage data. Use a local SQLite file for simple deployments, or a PostgreSQL connection string for production.

### Option A — Docker

```bash
docker run -p 4000:4000 \
  -v $(pwd)/config/plexus.yaml:/app/config/plexus.yaml \
  -v plexus-data:/app/data \
  -e DATABASE_URL=sqlite:///app/data/plexus.db \
  ghcr.io/mcowger/plexus:latest
```

### Option B — Standalone Binary

Download the latest pre-built binary from [GitHub Releases](https://github.com/mcowger/plexus/releases/latest):

```bash
# macOS (Apple Silicon)
curl -L https://github.com/mcowger/plexus/releases/latest/download/plexus-macos -o plexus
chmod +x plexus
DATABASE_URL=sqlite://./data/plexus.db ./plexus

# Linux (x64)
curl -L https://github.com/mcowger/plexus/releases/latest/download/plexus-linux -o plexus
chmod +x plexus
DATABASE_URL=sqlite://./data/plexus.db ./plexus

# Windows (x64) — download plexus.exe from the releases page, then:
# set DATABASE_URL=sqlite://./data/plexus.db && plexus.exe
```

The binary is self-contained (no runtime or dependencies required). By default it looks for `config/plexus.yaml` relative to the working directory.

### Test it

```bash
curl -X POST http://localhost:4000/v1/chat/completions \
  -H "Authorization: Bearer sk-plexus-my-key" \
  -H "Content-Type: application/json" \
  -d '{"model": "fast", "messages": [{"role": "user", "content": "Hello!"}]}'
```

The dashboard is at `http://localhost:4000` — log in with your `adminKey`.

> **OAuth providers** (GitHub Copilot, Anthropic, OpenAI Codex, etc.) use credentials managed through the Admin UI. These are stored in `./auth.json` by default — no manual setup required. Set `AUTH_JSON` to override the path. See [Configuration: OAuth Providers](docs/CONFIGURATION.md#oauth-providers-pi-ai).

See [Installation Guide](docs/INSTALLATION.md) for Docker Compose, building from source, and all environment variable options.

---

## Recent Updates

- **Responses API**: Full OpenAI `/v1/responses` endpoint with multi-turn `previous_response_id` tracking and conversation management
- **Image & Speech APIs**: `/v1/images/generations`, `/v1/images/edits`, and `/v1/audio/speech` endpoints
- **Per-Request Pricing**: Flat dollar amount per API call, independent of token count
- **MCP Proxy Support**: Proxy streamable HTTP MCP servers with per-request session isolation
- **OAuth Providers**: Authenticate to Anthropic, GitHub Copilot, Gemini CLI, Antigravity, and OpenAI Codex via the Admin UI
- **User Quota Enforcement**: Per-API-key limits using rolling (leaky bucket), daily, or weekly windows
- **Escalating Cooldown System**: Exponential backoff for provider failures (2 min → 5 hr cap); success resets failure count
- **Quota Tracking System**: Monitor provider rate limits with configurable per-provider checkers
- **Dynamic Key Attribution**: Append `:label` to any API key secret to track usage by feature or team

---

## Features

### Routing & Load Balancing

Define model aliases backed by one or more providers. Choose how targets are selected:

| Selector | Behavior |
|----------|----------|
| `random` | Distribute requests randomly across healthy targets (default) |
| `in_order` | Try providers in order; fall back when one is unhealthy |
| `cost` | Always route to the cheapest configured provider |
| `performance` | Route to the highest tokens/sec provider (with exploration) |
| `latency` | Route to the lowest time-to-first-token provider |

Use `priority: api_match` to prefer providers that natively speak the incoming API format, enabling pass-through optimization.

→ See [Configuration: models](docs/CONFIGURATION.md#models)

### Multi-Provider Support

Plexus supports protocol translation between:
- **OpenAI** chat completions format (`/v1/chat/completions`)
- **Anthropic** messages format (`/v1/messages`)
- **Google Gemini** native format
- Any **OpenAI-compatible** provider (DeepSeek, Groq, OpenRouter, Together, etc.)

A request sent in Anthropic format can be routed to an OpenAI provider — Plexus handles the transformation in both directions, including streaming and tool use.

→ See [API Reference](docs/API.md)

### OAuth Providers

Use AI services you already have subscriptions to without managing API keys. Plexus integrates with [pi-ai](https://www.npmjs.com/package/@mariozechner/pi-ai) to support OAuth-backed providers:

- Anthropic Claude
- OpenAI Codex
- GitHub Copilot
- Google Gemini CLI
- Google Antigravity

OAuth credentials are stored in `auth.json` and managed through the Admin UI.

→ See [Configuration: OAuth Providers](docs/CONFIGURATION.md#oauth-providers-pi-ai)

### User Quota Enforcement

Limit how much each API key can consume using rolling, daily, or weekly windows:

```yaml
user_quotas:
  premium:
    type: rolling
    limitType: tokens
    limit: 100000
    duration: 1h

keys:
  my-app:
    secret: "sk-plexus-app-key"
    quota: premium
```

→ See [Configuration: user_quotas](docs/CONFIGURATION.md#user_quotas-optional)

### Provider Cooldowns

When a provider fails, Plexus removes it from rotation using exponential backoff: 2 min → 4 min → 8 min → ... → 5 hr cap. Successful requests reset the counter. Set `disable_cooldown: true` on a provider to opt it out entirely.

→ See [Configuration: cooldown](docs/CONFIGURATION.md#cooldown-optional)

### MCP Proxy

Proxy [Model Context Protocol](https://modelcontextprotocol.io) servers through Plexus. Only streamable HTTP transport is supported. Each request gets an isolated MCP session, preventing tool sprawl across clients.

```yaml
mcp_servers:
  my-tools:
    upstream_url: https://my-mcp-server.example.com/mcp
```

→ See [Configuration: MCP Servers](docs/CONFIGURATION.md#mcp-servers-optional)

### Responses API

Full support for OpenAI's `/v1/responses` endpoint including stateful multi-turn conversations via `previous_response_id`, response storage with 7-day TTL, and function calling.

→ See [Responses API Reference](docs/RESPONSES_API.md)

---

## License

MIT License — see [LICENSE](LICENSE) file.
