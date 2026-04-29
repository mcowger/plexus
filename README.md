# Plexus

**A Universal LLM API Gateway & Transformation Layer.**

<img src="docs/images/plexus_logo_transparent.png" alt="Plexus Logo" width="120"/>

### [🚀 API Reference](/docs/openapi/openapi.yaml) | [⚙️ Configuration](docs/CONFIGURATION.md) | [📦 Installation](docs/INSTALLATION.md) | [🔬 Testing](docs/TESTING.md)

Plexus is a high-performance API gateway that unifies access to multiple AI providers (OpenAI, Anthropic, Google, GitHub Copilot, and more) under a single endpoint. Switch models and providers without rewriting client code.

---

## What is Plexus?

Plexus sits in front of your LLM providers and handles protocol translation, load balancing, failover, and usage tracking — transparently. Send any supported request format to Plexus and it routes to the right provider, transforms as needed, and returns the response in the format your client expects.

**Key capabilities:**

- **Unified API surface** — Accept OpenAI (`/v1/chat/completions`), Anthropic (`/v1/messages`), Responses (`/v1/responses`), Gemini (`/v1beta`), Embeddings, Audio, Images.
- **Multi-provider routing** — Route to OpenAI, Anthropic, Google Gemini, DeepSeek, Groq, OpenRouter, and any OpenAI-compatible provider
- **OAuth providers** — Authenticate via GitHub Copilot, Anthropic Claude, OpenAI Codex, Gemini CLI, and Antigravity through OAuth (no API key required)
- **Model aliasing & load balancing** — Define virtual model names backed by multiple real providers with `random`, `cost`, `performance`, `latency`, or `in_order` selectors
- **Vision fallthrough** — Automatically convert images to text descriptions for models that don't natively support vision, ensuring compatibility across all providers
- **Intelligent failover** — Exponential-backoff cooldowns automatically remove unhealthy providers from rotation
- **Usage tracking** — Per-request cost, token counts, latency, and TPS metrics with a built-in dashboard
- **MCP proxy** — Proxy Model Context Protocol servers through Plexus with per-request session isolation
- **User quotas** — Per-API-key rate limiting by requests or tokens with rolling, daily, or weekly windows, along with cost restriction.
- **Admin dashboard** — Web UI for configuration, usage analytics, debug traces, and quota monitoring

---

## ⚡️ Unique Feature: Vision Fallthrough

Plexus allows you to use vision-capable aliases with backend models that don't natively support images. When enabled, Plexus automatically intercepts images in the request, sends them to a high-performance "descriptor" model (like Gemini 3 Flash or GPT-5.3-Codex) to generate text descriptions, and then passes those descriptions to the non-vision target.

This enables you to use cheap or specialized models for the main task while still supporting image inputs transparently.

**Setup is simple:**
Enable **Vision Fallthrough** for any model alias directly in the **Admin UI** under the **Models** tab. Specify a global "Descriptor Model" in the settings to handle the image-to-text conversion.

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

`ADMIN_KEY` is required and specifies the administrative password for the dashboard and management API.
`DATABASE_URL` is optional — defaults to a local SQLite database at `./data/plexus.db`. Set it to a PostgreSQL connection string for production.

### Option A — Docker

```bash
docker run -p 4000:4000 \
  -v plexus-data:/app/data \
  -e ADMIN_KEY="your-admin-password" \
  -e ENCRYPTION_KEY="your-generated-hex-key" \
  ghcr.io/mcowger/plexus:latest
```

### Option B — Standalone Binary

Download the latest pre-built binary from [GitHub Releases](https://github.com/mcowger/plexus/releases/latest):

```bash
# macOS (Apple Silicon)
curl -L https://github.com/mcowger/plexus/releases/latest/download/plexus-macos -o plexus
chmod +x plexus
ADMIN_KEY="your-admin-password" ./plexus

# Linux (x64)
curl -L https://github.com/mcowger/plexus/releases/latest/download/plexus-linux -o plexus
chmod +x plexus
ADMIN_KEY="your-admin-password" ./plexus

# Windows (x64) — download plexus.exe from the releases page, then:
# set ADMIN_KEY=your-admin-password && plexus.exe
```

The binary is self-contained — no runtime or external dependencies required. Database migration files and the web dashboard are embedded inside the binary.

### Test it

```bash
curl -X POST http://localhost:4000/v1/chat/completions \
  -H "Authorization: Bearer sk-plexus-my-key" \
  -H "Content-Type: application/json" \
  -d '{"model": "fast", "messages": [{"role": "user", "content": "Hello!"}]}'
```

The dashboard is at `http://localhost:4000` — log in with your `adminKey`.

> **OAuth providers** (GitHub Copilot, Anthropic, OpenAI Codex, etc.) use credentials managed through the Admin UI. See [Configuration: OAuth Providers](docs/CONFIGURATION.md#oauth-providers-pi-ai).

See [Installation Guide](docs/INSTALLATION.md) for Docker Compose, building from source, and all environment variable options.

## Local pre-commit test hook

To enforce a local health check before commits, install the repo's git hook:

```bash
bun run setup:hooks
```

That configures `core.hooksPath` to `.githooks` and installs a `pre-commit` hook that runs:

```bash
cd packages/backend && bun run test
```

> Note: `bun test` is intentionally blocked both at repo root and in `packages/backend`; use `cd packages/backend && bun run test` instead.

If the tests fail, the commit is blocked.

You can also run backend tests from the repo root with:

```bash
bun run test
```

> Note: `bun test` is intentionally blocked both at repo root and in `packages/backend`; use `bun run test` instead.


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
- **OpenAI** responses  format (`/v1/responses`)
- **Anthropic** messages format (`/v1/messages`)
- **Google Gemini** native format
- Any **OpenAI-compatible** provider (DeepSeek, Groq, OpenRouter, Together, etc.)

A request sent in Anthropic format can be routed to an OpenAI provider — Plexus handles the transformation in both directions, including streaming and tool use.

→ See [API Reference](/docs/openapi/openapi.yaml)

### OAuth Providers

Use AI services you already have subscriptions to without managing API keys. Plexus integrates with [pi-ai](https://www.npmjs.com/package/@mariozechner/pi-ai) to support OAuth-backed providers:

- Anthropic Claude
- OpenAI Codex
- GitHub Copilot
- Google Gemini CLI
- Google Antigravity

OAuth credentials are stored in the database and managed through the Admin UI.

→ See [Configuration: OAuth Providers](docs/CONFIGURATION.md#oauth-providers-pi-ai)

### User Quota Enforcement

Limit how much each API key can consume using rolling, daily, or weekly windows:

**Limit types:** `tokens`, `requests`, or `cost` (dollar spending).

→ See [Configuration: user_quotas](docs/CONFIGURATION.md#user_quotas-optional)

### Provider Cooldowns

When a provider fails, Plexus removes it from rotation using exponential backoff: 2 min → 4 min → 8 min → ... → 5 hr cap. Successful requests reset the counter. Set disable cooldown: true on a provider to opt it out entirely.

→ See [Configuration: cooldown](docs/CONFIGURATION.md#cooldown-optional)

### MCP Proxy

Proxy [Model Context Protocol](https://modelcontextprotocol.io) servers through Plexus. Only streamable HTTP transport is supported. Each request gets an isolated MCP session, preventing tool sprawl across clients.

→ See [Configuration: MCP Servers](docs/CONFIGURATION.md#mcp-servers-optional)

### Encryption at Rest

Plexus supports AES-256-GCM encryption for all sensitive data stored in the database, including API key secrets, OAuth access/refresh tokens, provider API keys, and MCP server headers.

**Enable encryption:**

```bash
# Generate once and persist in your .env or secret manager:
#   openssl rand -hex 32
export ENCRYPTION_KEY="your-generated-hex-key"
```

On first startup with `ENCRYPTION_KEY` set, existing plaintext values are automatically encrypted. Without the key, the system operates in plaintext mode (backward compatible). See [Configuration: Encryption](docs/CONFIGURATION.md#encryption-at-rest-optional) for details.

---

## Admin CLI Utilities

Plexus ships several one-shot CLI subcommands for database maintenance tasks. Pass the subcommand name as the first argument to the binary (or `bun run src/index.ts`).

### Rotate Encryption Key (`rekey`)

Decrypts all sensitive fields with the current key and re-encrypts them with a new one. Run this before rotating `ENCRYPTION_KEY` in your environment.

```bash
# Docker
docker run --rm \
  -e DATABASE_URL=sqlite:///app/data/plexus.db \
  -e ENCRYPTION_KEY="<current-key>" \
  -e NEW_ENCRYPTION_KEY="<new-key>" \
  -v plexus-data:/app/data \
  ghcr.io/mcowger/plexus:latest rekey

# Binary
ENCRYPTION_KEY="<current-key>" NEW_ENCRYPTION_KEY="<new-key>" \
  DATABASE_URL=sqlite://./data/plexus.db ./plexus rekey
```

After a successful run, update `ENCRYPTION_KEY` to the new value before restarting the server.

→ See [Configuration: Encryption](docs/CONFIGURATION.md#encryption-at-rest-optional)

### Migrate Quota Snapshots (`migrate-quota-snapshots`)

One-time ETL that copies historical data from the legacy `quota_snapshots` table into the new `meter_snapshots` table introduced in the quota-tracking overhaul. Run this once after upgrading to a version that includes the new quota system.

```bash
# Docker
docker run --rm \
  -e DATABASE_URL=sqlite:///app/data/plexus.db \
  -v plexus-data:/app/data \
  ghcr.io/mcowger/plexus:latest migrate-quota-snapshots

# Binary
DATABASE_URL=sqlite://./data/plexus.db ./plexus migrate-quota-snapshots

# Development
DATABASE_URL=sqlite://./data/plexus.db bun run src/index.ts migrate-quota-snapshots
```

`DATABASE_URL` must be set explicitly — there is no default. The command is **idempotent**: rows that already exist in `meter_snapshots` are skipped, so it is safe to run more than once. If `quota_snapshots` does not exist or is empty the command exits cleanly with no changes.

**Field mapping summary:**

| `quota_snapshots` | `meter_snapshots` | Notes |
|---|---|---|
| `provider` | `provider` | direct |
| `checker_id` | `checker_id` | direct |
| `group_id` | `group` | renamed |
| `window_type` | `meter_key` | used as-is |
| `window_type` | `kind` / `period_*` | `daily`→allowance/day, `monthly`→allowance/month, `balance`→balance, etc. |
| `description` | `label` | falls back to `window_type` if null |
| `unit` | `unit` | defaults to `''` if null |
| `status` | `status` | defaults to `'ok'` if null |
| `utilization_percent` | `utilization_percent` + `utilization_state` | null→`unknown`, number→`reported` |
| *(not present)* | `checker_type` | set to `'unknown'` |

---

## License

MIT License — see [LICENSE](LICENSE) file
