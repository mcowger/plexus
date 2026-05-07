# Configuration

Plexus stores all configuration in the database and manages it via the **Admin UI** (recommended) or **Management API**. On first launch with an existing `plexus.yaml` file, Plexus imports it; afterward, use the UI or API to make changes.

**Environment variables** control server-level settings. Everything else (providers, models, keys, quotas) is stored in the database.

---

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `ADMIN_KEY` | Password for admin dashboard and management API. Server refuses to start if unset. | Yes |
| `DATABASE_URL` | Connection string. Supports `sqlite://` and `postgres://` URIs. | No |
| `ENCRYPTION_KEY` | 32-byte key for encrypting sensitive data at rest. Generated via: `openssl rand -hex 32` | No |
| `DATA_DIR` | Directory for SQLite database. | No |
| `LOG_LEVEL` | Verbosity: `error`, `warn`, `info`, `debug`, `silly` | No |
| `PORT` | HTTP server port. | No |
| `HOST` | Address to bind to. | No |

### Quick Start

```bash
# SQLite (database auto-created in ./data/)
ADMIN_KEY="my-secret" bun run dev

# PostgreSQL
ADMIN_KEY="my-secret" DATABASE_URL="postgres://user:pass@localhost:5432/plexus" bun run dev

# Docker
docker run -e ADMIN_KEY="my-secret" -v ./data:/app/data -p 4000:4000 plexus:latest
```

---

## Configuration via Admin UI

The **Admin UI** (accessible at `http://localhost:4000` after starting) is the easiest way to configure Plexus. It provides forms for all configuration options with real-time validation.

- **Providers**: Add/edit upstream AI providers (API keys, base URLs, model lists)
- **Models**: Create model aliases with routing logic and pricing
- **Keys**: Manage client API keys with optional quota assignment
- **Quotas**: Define usage limits (tokens, requests, or spending) per time window
- **MCP Servers**: Configure MCP proxy endpoints
- **OAuth**: Login to OAuth-backed providers (Anthropic, GitHub Copilot, Codex, etc.)
- **Settings**: Vision fallthrough, global defaults, cooldown configuration

### Management API

For programmatic configuration, use the Management API (`/v0/management/*`). All endpoints require the `x-admin-key` header.

| Endpoint | Description |
|----------|-------------|
| `GET /v0/management/providers` | List all providers |
| `PUT /v0/management/providers/{slug}` | Create/update provider |
| `DELETE /v0/management/providers/{slug}` | Remove provider |
| `GET /v0/management/aliases` | List all model aliases |
| `PUT /v0/management/aliases/{slug}` | Create/update alias |
| `DELETE /v0/management/aliases/{slug}` | Remove alias |
| `GET /v0/management/keys` | List all API keys |
| `PUT /v0/management/keys/{name}` | Create/update key |
| `DELETE /v0/management/keys/{name}` | Remove key |
| `GET /v0/management/user-quotas` | List quota definitions |
| `PUT /v0/management/user-quotas/{name}` | Create/update quota |
| `DELETE /v0/management/user-quotas/{name}` | Remove quota |
| `GET /v0/management/config/export` | Export full config as JSON |
| `PUT /v0/management/config` | Import config (replace all) |

See the [API Reference](/docs/openapi/openapi.yaml) for complete endpoint documentation.

---

## Providers

A **provider** represents an upstream AI service that Plexus routes requests to. Each provider has authentication credentials, a base URL, and a list of available models.

### Provider Settings

| Setting | Description | Required |
|---------|-------------|----------|
| **Slug** | Unique identifier (e.g., `openai_direct`, `anthropic-prod`) | Yes |
| **Display Name** | Friendly name for logs and UI | No |
| **API Base URL** | Provider's endpoint. Common values: | Yes |
| | `https://api.openai.com/v1` | |
| | `https://api.anthropic.com/v1` | |
| | `https://generativelanguage.googleapis.com/v1beta` | |
| | `https://openrouter.ai/api/v1` | |
| | `oauth://` (for OAuth-backed providers) | |
| **API Key** | Authentication token | Yes |
| **Enabled** | Whether this provider is active for routing | No (default: true) |
| **Headers** | Custom HTTP headers sent with every request | No |
| **Extra Body** | Additional fields merged into every request | No |
| **Disable Cooldown** | Exclude from automatic cooldown on errors | No |

### Multi-Protocol Providers

Some providers support multiple API formats (OpenAI chat, Anthropic messages, embeddings). Configure them with a map of protocol → URL:

| Protocol | Use Case |
|----------|----------|
| `chat` | OpenAI-compatible chat completions |
| `messages` | Anthropic Claude Messages API |
| `embeddings` | OpenAI-compatible embeddings |
| `image` | Image generation (DALL-E, etc.) |
| `transcriptions` | Speech-to-text (Whisper) |
| `speech` | Text-to-speech |

When combined with `priority: api_match` on a model alias, Plexus prefers providers that natively support the incoming API format.

### OAuth Providers

Plexus supports OAuth-backed providers via the [pi-ai](https://www.npmjs.com/package/@mariozechner/pi-ai) library. These require authentication through the Admin UI.

**Supported OAuth providers:**
- Anthropic Claude
- GitHub Copilot
- OpenAI Codex
- Gemini CLI
- Antigravity
- OpenAI o1-pro

**Configuration:**
- Set API Base URL to `oauth://`
- Set API Key to `oauth`
- Set OAuth Account (e.g., `work`, `personal`)
- Set OAuth Provider if the provider key differs from pi-ai's expected ID

Once configured, log in via the Admin UI to authorize Plexus. Tokens are stored encrypted (when `ENCRYPTION_KEY` is set) and auto-refreshed.

### Provider Quota Checkers

Quota checkers monitor upstream provider rate limits and prevent routing to exhausted providers.

| Checker Type | Description | Options |
|--------------|-------------|---------|
| `synthetic` | Usage from Synthetic API | `apiKey` (defaults to provider's key) |
| `naga` | Naga AI balance |
| `nanogpt` | NanoGPT usage |
| `openai-codex` | Codex quota (OAuth) | Reads token from database |
| `claude-code` | Claude Code quota (OAuth) | Reads token from database |
| `zai` | ZAI balance |
| `moonshot` | Moonshot balance |
| `novita` | Novita balance |
| `minimax` | Minimax balance | Requires `groupid`, `hertzSession` |

**Settings:**
- `enabled`: Enable/disable polling
- `intervalMinutes`: Polling frequency (minimum 1)
- `maxUtilizationPercent`: Treat provider as exhausted when any window reaches this % (default 99)

Quota data is available via the Management API — see [API Reference: Quota Management](/docs/openapi/openapi.yaml#/paths/~1v0~1management~1quotas).

---

## Model Aliases

A **model alias** is a virtual model name that clients use in requests. Each alias maps to one or more provider targets with routing logic.

### Alias Settings

| Setting | Description | Required |
|---------|-------------|----------|
| **Slug** | Name clients send (e.g., `fast-model`) | Yes |
| **Type** | `chat` (default), `embeddings`, `transcriptions`, `speech`, `image` | No |
| **Additional Aliases** | Alternative names that also route here | No |
| **Selector** | How to pick between targets | No |
| **Priority** | Routing order: `selector` (default) or `api_match` | No |
| **Targets** | List of provider/model pairs | Yes |
| **Metadata** | External catalog for model info | No |

### Selector Strategies

| Strategy | Behavior |
|----------|----------|
| `random` (default) | Distributes requests randomly across healthy targets |
| `in_order` | Tries targets in order, skips unhealthy ones |
| `cost` | Routes to cheapest provider (requires pricing) |
| `performance` | Routes to highest post-TTFT throughput (output tokens / streaming time) |
| `latency` | Routes to lowest time-to-first-token |
| `usage` | Routes to provider with least recent usage (last 24 hours) |
| `e2e_performance` | Routes to highest end-to-end throughput (output tokens / total request time) |

Use `performanceExplorationRate` (default 0.05) to occasionally explore other targets and prevent locking onto one provider. Applies to `performance`, `latency`, and `e2e_performance` selectors. `latencyExplorationRate` and `e2ePerformanceExplorationRate` can be set separately for their respective selectors (each defaults to `performanceExplorationRate` if not specified). Unlike `performance`, the `e2e_performance` selector explores across all candidates including the current best, ensuring end-to-end metrics stay fresh for every provider.

### Priority Modes

- **`selector` (default)**: Selector picks a provider first, then matches API format.
- **`api_match`**: Filter for providers that natively support the incoming API format first, then apply selector. Best for tools requiring specific API features (e.g., Claude Code with Anthropic messages).

### Targets

Each target specifies:
- **Provider**: Must match an existing provider slug
- **Model**: Upstream model name
- **Enabled**: Whether this target is active

### External Metadata

Link an alias to an external model catalog to return enriched metadata in `GET /v1/models`:

| Source | URL | Format |
|--------|-----|--------|
| `openrouter` | openrouter.ai | `provider/model` |
| `models.dev` | models.dev | `providerid.modelid` |
| `catwalk` | catwalk.charm.sh | `providerid.modelid` |

Metadata loads at startup. Failures are non-fatal — Plexus operates without enriched data if a source is unavailable.

### Direct Model Routing

Bypass aliases entirely using the format `direct/<provider>/<model>`:

```bash
curl ... -d '{"model": "direct/openai_direct/gpt-4o-mini", ...}'
```

- Provider and model must exist in configuration
- Bypasses selector logic and alias settings

---

## API Keys

API keys authenticate clients to inference endpoints (`/v1/*`).

### Key Settings

| Setting | Description | Required |
|---------|-------------|----------|
| **Name** | Unique identifier | Yes |
| **Secret** | Bearer token (clients send in `Authorization` header) | Yes |
| **Comment** | Description or owner | No |
| **Quota** | Name of a quota definition to enforce | No |

### Authentication Methods

Clients can provide credentials via:
- `Authorization: Bearer <secret>`
- `Authorization: <secret>` (prefix added automatically)
- `x-api-key: <secret>`
- `?key=<secret>` query parameter

The `/v1/models` endpoint is public (no auth required).

### Dynamic Attribution

Append `:label` to track usage without creating separate keys:

```bash
Authorization: Bearer sk-plexus-key:copilot
Authorization: Bearer sk-plexus-key:mobile:v2.5
```

The part before the first colon authenticates; the rest is stored as `attribution` in usage logs. Query via:

```sql
SELECT attribution, COUNT(*), SUM(tokens_input + tokens_output)
FROM request_usage
WHERE api_key = 'key-name'
GROUP BY attribution;
```

---

## User Quotas

User quotas enforce per-key usage limits. Unlike provider quota checkers (which monitor upstream limits), these control client consumption.

### Quota Types

| Type | Reset Behavior |
|------|----------------|
| `rolling` | Continuous window (e.g., "last hour") |
| `daily` | Resets at UTC midnight |
| `weekly` | Resets at UTC midnight Sunday |
| `monthly` | Resets at 00:00 UTC on the 1st |

### Limit Types

| Type | What It Counts |
|------|----------------|
| `requests` | Number of API calls |
| `tokens` | Input + output + reasoning + cached tokens |
| `cost` | Dollar spending (requires pricing on models) |

### Rolling Window Durations

Supported durations: `30s`, `5m`, `10m`, `30m`, `1h`, `2h`, `2h30m`, `6h`, `12h`, `1d`

### How Quotas Work

**Tokens/Requests (leaky bucket):**
1. After each request, usage is recorded.
2. Before each request, usage "leaks" based on elapsed time: `leaked = elapsed × (limit / duration)`
3. Remaining capacity determines if the request is allowed.

**Cost (cumulative):**
1. Spending accumulates as requests complete.
2. Resets when the window expires.
3. No leak/refill within the window.

### Assigning Quotas

Reference a quota by name in the key's `quota` field. Keys without a quota have unlimited access.

---

## Cooldowns

When a provider returns errors, Plexus uses an escalating cooldown system to temporarily remove it from the routing pool.

### Cooldown Schedule

| Consecutive Failures | Duration |
|---------------------|----------|
| 1st | 2 minutes |
| 2nd | 4 minutes |
| 3rd | 8 minutes |
| 4th | 16 minutes |
| 5th | 32 minutes |
| 6th | 64 minutes |
| 7th | 128 minutes |
| 8th | 256 minutes |
| 9th+ | 300 minutes (cap) |

### Behavior

- Successful requests reset failure count to 0.
- `413 Payload Too Large` errors do NOT trigger cooldowns (client error).
- Each provider+model combination tracks failures independently.
- Cooldowns persist in the database across restarts.

### Configuration

| Setting | Description | Default |
|---------|-------------|---------|
| `initialMinutes` | First failure duration | 2 |
| `maxMinutes` | Cap for exponential backoff | 300 |

### Disabling Per Provider

Set `disable_cooldown: true` on a provider to exclude it from the cooldown system. Recommended for:
- Local model servers (Ollama, LM Studio)
- Providers with their own rate-limit handling
- Testing scenarios

**Do not** disable for cloud providers with unreliable endpoints.

### Management API

- `GET /v0/management/cooldowns` — list active cooldowns
- `DELETE /v0/management/cooldowns` — clear all
- `DELETE /v0/management/cooldowns/:provider?model=:model` — clear specific

See [API Reference: Cooldown Management](/docs/openapi/openapi.yaml#/paths/~1v0~1management~1cooldowns).

---

## MCP Servers

Plexus proxies [Model Context Protocol](https://modelcontextprotocol.io) servers. Only HTTP streaming transport is supported.

### Settings

| Setting | Description | Required |
|---------|-------------|----------|
| **Server Name** | Identifier used in URLs | Yes |
| **Upstream URL** | Full MCP server endpoint | Yes |
| **Enabled** | Active for routing | No |
| **Headers** | Static headers forwarded to upstream | No |

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/mcp/:name` | JSON-RPC messages |
| `GET` | `/mcp/:name` | SSE streaming |
| `DELETE` | `/mcp/:name` | End session |

### Authentication

All MCP endpoints require a Plexus API key. Client auth headers are NOT forwarded — only configured static headers are added.

### OAuth Discovery

Plexus exposes standard OAuth 2.0 endpoints for MCP clients:
- `GET /.well-known/oauth-authorization-server`
- `GET /.well-known/oauth-protected-resource`
- `GET /.well-known/openid-configuration`
- `POST /register`

---

## Vision Fallthrough

Vision fallthrough allows image inputs to be preprocessed by a vision-capable model before routing to the actual target.

**Configuration:**
1. Set a global **Descriptor Model** in Settings (Admin UI)
2. Enable **Use Image Fallthrough** on individual model aliases

Images are sent to the descriptor model first; the text analysis is prepended to the original prompt.

---

## Pricing

Configure pricing to enable `cost` selector strategy, cost-based quotas, and usage reporting.

### Pricing Sources

| Source | Description |
|--------|-------------|
| `simple` | Fixed per-million token rates |
| `openrouter` | Live rates from OpenRouter API |
| `defined` | Tiered rates based on input token volume |
| `per_request` | Flat fee per API call |

### Simple Pricing

```yaml
input: 3.00    # dollars per million input tokens
output: 15.00  # dollars per million output tokens
cached: 0.30   # cache read (optional)
cache_write: 3.75  # cache write (optional)
```

### OpenRouter Pricing

Fetches live rates from OpenRouter. Set the model `slug` and optional `discount`:

```yaml
source: openrouter
slug: anthropic/claude-3.5-sonnet
discount: 0.1  # 10% off all rates
```

### Tiered Pricing

Useful for providers with volume discounts:

```yaml
source: defined
range:
  - lower_bound: 0
    upper_bound: 200000
    input_per_m: 3.00
    output_per_m: 15.00
  - lower_bound: 200001
    upper_bound: .inf
    input_per_m: 1.50
    output_per_m: 7.50
```

### Per-Request Pricing

Flat fee regardless of token count:

```yaml
source: per_request
amount: 0.04
```

Full cost stored in `costInput`; output/cached fields are zero.

---

## Token Estimation

Some providers (especially free-tier models) don't return usage data. Enable token estimation to automatically calculate token counts using a character-based heuristic.

**Enable via:**
- Provider setting: `estimateTokens: true`
- Admin UI: **Advanced → Estimate Tokens**

Estimated counts are flagged with `tokensEstimated = 1` in usage records. Typical accuracy is within ±15% of actual values.

---

## Encryption at Rest

Plexus can encrypt sensitive data using AES-256-GCM.

### What Gets Encrypted

| Data | Fields |
|------|--------|
| API Keys | secret |
| OAuth Credentials | accessToken, refreshToken |
| Providers | apiKey, headers, quotaCheckerOptions |
| MCP Servers | headers |

### Setup

```bash
# Generate a key
openssl rand -hex 32

# Set environment variable
export ENCRYPTION_KEY="your-64-character-hex-key"
```

Key format accepts:
- 64-character hex string (32 bytes, used directly)
- Arbitrary passphrase (derived via scrypt)

### Behavior

- Existing plaintext data encrypts on first startup with key set.
- New data encrypts on write, decrypts on read.
- API key authentication uses SHA-256 hash lookups.

### Key Rotation

```bash
# Docker
docker exec -e ENCRYPTION_KEY="old" -e NEW_ENCRYPTION_KEY="new" plexus ./plexus rekey

# Binary
ENCRYPTION_KEY="old" NEW_ENCRYPTION_KEY="new" ./plexus rekey
```

After re-keying, update `ENCRYPTION_KEY` before restarting.

### Important

- Lost keys = unreachable data. Back up keys securely.
- Encrypted values prefixed with `enc:v1:` in database.
- Without `ENCRYPTION_KEY`, all data stored plaintext.

---

## Failover

Plexus automatically retries failed requests across alternative targets in multi-target model aliases.

### Default Behavior

All non-2xx status codes except `400` and `422` trigger failover. Custom retryable codes and errors can be configured.

### Configuration Options

- `enabled`: Toggle failover on/off
- `retryableStatusCodes`: List of status codes that trigger retry
- `retryableErrors`: List of network errors that trigger retry