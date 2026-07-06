# Configuration

Plexus stores all configuration in the database and manages it via the **Admin UI** (recommended) or **Management API**.

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
| **Upstream Timeout** | Per-provider request timeout override in milliseconds. If unset, the global timeout is used. | No |
| **Disable Cooldown** | Exclude from automatic cooldown on errors | No |
| **Stall Detection Overrides** | Optional per-provider overrides for TTFB/throughput stall detection. Empty = inherit global setting for that field. | No |
| **pi-ai Provider** | Builtin pi-ai provider ID used for registry model lookup (for example, `anthropic`, `openai`, `google`) | No |
| **Auto Compat** | Use pi-ai registry metadata to automatically map reasoning/thinking and generation options for models with a `pi_ai_model_id` | No (default: false) |
| **Adapters** | Request/response rewrite hooks applied to every model under this provider (see [Provider Adapters](#provider-adapters)) | No |

### Multi-Protocol Providers

Some providers support multiple API formats (OpenAI chat, Anthropic messages, embeddings). Configure them with a map of protocol → URL:

| Protocol | Use Case |
|----------|----------|
| `chat` | OpenAI-compatible chat completions |
| `messages` | Anthropic Claude Messages API |
| `embeddings` | OpenAI-compatible embeddings (Gemini providers auto-transformed) |
| `image` | Image generation (DALL-E, etc.) |
| `transcriptions` | Speech-to-text (Whisper) |
| `speech` | Text-to-speech |

When combined with `priority: api_match` on a model alias, Plexus prefers providers that natively support the incoming API format.

### OAuth Providers

Plexus supports OAuth-backed providers via the [pi-ai](https://www.npmjs.com/package/@earendil-works/pi-ai) library. These require authentication through the Admin UI.

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

### Registry-Aware Compatibility

Plexus can use pi-ai's builtin model registry as compatibility metadata while still
preserving v1 pass-through request fidelity. This is separate from OAuth execution and
does not re-enable the removed `inference-v2` path.

Enable it with `auto_compat: true` at the provider level or on an individual provider
model. A model must also have `pi_ai_model_id` set to a builtin pi-ai model ID. When the
provider has `pi_ai_provider`, Plexus validates that the pair resolves in the builtin
registry and warns rather than failing if it does not.

When enabled, Plexus extracts the client's reasoning/thinking intent from the incoming
request and maps it to the provider fields supported by the resolved registry model. If
the model has no resolvable `pi_ai_model_id`, the compatibility step is skipped.

```json
PUT /v0/management/providers/anthropic_oauth
{
  "api_base_url": "oauth://",
  "api_key": "oauth",
  "oauth_provider": "anthropic",
  "oauth_account": "work",
  "pi_ai_provider": "anthropic",
  "auto_compat": true,
  "models": {
    "claude-opus-4-6": {
      "type": "text",
      "pi_ai_model_id": "claude-opus-4-6"
    }
  }
}
```

You can also enable compatibility only for selected models:

```json
{
  "pi_ai_provider": "anthropic",
  "models": {
    "claude-opus-4-6": {
      "type": "text",
      "pi_ai_model_id": "claude-opus-4-6",
      "auto_compat": true
    }
  }
}
```

`reasoning_rewrite` remains available as a manual escape hatch, but it overlaps with
`auto_compat`. Prefer `auto_compat` for registry-backed models, and revisit existing
custom rewrites before running both surfaces in parallel.

### Provider Adapters

Adapters rewrite request payloads outbound to a provider and raw response payloads inbound, fixing provider-specific field-name incompatibilities without modifying the core transformer pipeline.

Adapters can be set at **provider level** (applied to every model under the provider) or at **model level** (appended after provider-level adapters for a specific model). Both accept a single name or a list.

| Adapter | Description |
|---------|-------------|
| `reasoning_content` | Renames `reasoning` / `thinking.content` → `reasoning_content` on outbound assistant messages for providers that use Fireworks/DeepSeek field naming (e.g. Fireworks DeepSeek-R1). Fixes *"Extra inputs are not permitted, field: messages[N].reasoning"* errors. |
| `suppress_developer_role` | Rewrites the `developer` role to `system` on outbound messages for providers that do not support the newer OpenAI `developer` role. |
| `model_override` | Conditionally rewrites the provider model name based on request payload fields. Used for providers that expose reasoning variants as separate model names rather than respecting reasoning-related fields in the request body. See [Model Override Adapter](#model-override-adapter) below. |
| `reasoning_rewrite` | Manually rewrites reasoning/thinking request fields for providers with bespoke compatibility requirements. Prefer `auto_compat` for models linked to the pi-ai builtin registry; this adapter is now best treated as an escape hatch. |
| `web_search_coercion` | Translates server-side web search tool entries to the format expected by the target provider. Clients can use any web search format; Plexus rewrites it transparently. See [Web Search Coercion Adapter](#web-search-coercion-adapter) below. |

**Example — provider-level:**
```json
PUT /v0/management/providers/fireworks
{
  "api_base_url": "https://api.fireworks.ai/inference/v1",
  "api_key": "fw_...",
  "adapter": "reasoning_content"
}
```

**Example — model-level override:**
```json
{
  "models": {
    "accounts/fireworks/models/deepseek-r1": {
      "adapter": ["reasoning_content", "suppress_developer_role"]
    }
  }
}
```

Adapters are applied in order on outbound (preDispatch) and in reverse on inbound (postDispatch). Pass-through optimisation is automatically disabled when any adapter is active.

### Model Override Adapter

The `model_override` adapter conditionally rewrites the provider model name based on the values or presence of fields in the request payload. This is useful for providers that expose reasoning variants as **separate model names** (e.g. `model-name` with reasoning, `model-name-fast` without) rather than respecting reasoning-related fields in the request body.

**How it works:**

When the resolved provider model matches a rule's `model` field AND **any** of the rule's conditions are satisfied (OR semantics), the model name is rewritten to `rewriteTo`. Conditions use dotted paths into the request payload.

**Configuration:**

The `model_override` adapter is configured at **model level** only (not provider level). It accepts a `rules` array in its options:

```json
{
  "models": {
    "zai-org/GLM-5.1-FP8": {
      "adapter": [
        {
          "name": "model_override",
          "options": {
            "rules": [
              {
                "model": "zai-org/GLM-5.1-FP8",
                "rewriteTo": "glm-5.1-fast",
                "conditions": [
                  { "field": "enable_thinking", "value": false },
                  { "field": "reasoning.enabled", "value": false },
                  { "field": "reasoning.effort", "value": "none" },
                  { "field": "budget_tokens", "value": 0 }
                ]
              }
            ]
          }
        }
      ]
    }
  }
}
```

**Rule fields:**

| Field | Description |
|-------|-------------|
| `model` | The provider model name to match against (must match the resolved target model) |
| `rewriteTo` | The model name to send to the provider instead |
| `conditions` | Array of conditions; **any** match triggers the rewrite |

**Condition fields:**

| Field | Description |
|-------|-------------|
| `field` | Dotted path into the request payload (e.g. `reasoning.enabled`, `chat_template_kwargs.enable_thinking`) |
| `value` | Value to match (strict equality). If omitted, the condition matches when the field is present (any value) |

**Notes:**
- The adapter operates on the **transformed provider payload**, so fields must survive API transformation to be matchable. For chat-to-chat requests, all fields from the original request body are preserved (including non-standard fields like `enable_thinking`, `thinking_budget`, etc.).
- Multiple rules are evaluated in order; only the first matching rule applies.
- The rewrite is transparent to the client — billing and usage tracking still reference the original canonical model name.

### Web Search Coercion Adapter

Different providers expose server-side web search under completely different tool type strings, making it impossible for a client to use a single request format across all providers. The `web_search_coercion` adapter solves this: configure the target format once on the provider, and Plexus rewrites every web search tool entry in the outgoing request automatically — regardless of which format the client sent.

**Supported incoming formats** (any of these will be recognised and coerced):

| Provider | Tool entry |
|----------|-----------|
| Anthropic | `{ "type": "web_search_20250305", "name": "web_search", "max_uses": N }` |
| OpenAI | `{ "type": "web_search" }` |
| OpenRouter | `{ "type": "openrouter:web_search" }` |
| Google | `{ "googleSearch": {} }` / `{ "type": "googleSearch" }` |

**Supported targets** (the format Plexus rewrites to):

| `target` | Output tool entry | Provider |
|----------|------------------|---------|
| `anthropic` | `{ "type": "web_search_20250305", "name": "web_search" }` | Anthropic API |
| `openai` | `{ "type": "web_search" }` | OpenAI Responses API |
| `openrouter` | `{ "type": "openrouter:web_search" }` | OpenRouter |
| `google` | `{ "googleSearch": {} }` | Google Gemini native API |

The adapter operates transparently across **all four incoming API surfaces** (Chat Completions, Anthropic Messages, OpenAI Responses, and Gemini native) — a client using any of these APIs and any web search format will have its request correctly rewritten for the target provider.

**Configuration:**

Set the adapter on the provider that needs coercion. The only required option is `target`:

```json
PATCH /v0/management/providers/my-openrouter-provider
{
  "adapter": [
    {
      "name": "web_search_coercion",
      "options": {
        "target": "openrouter"
      }
    }
  ]
}
```

For the Anthropic target, an optional `max_uses` limits how many web searches are allowed per request:

```json
{
  "name": "web_search_coercion",
  "options": {
    "target": "anthropic",
    "max_uses": 5
  }
}
```

**Options:**

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `target` | `"anthropic"` \| `"openai"` \| `"openrouter"` \| `"google"` | Yes | The provider's expected web search tool format |
| `max_uses` | integer | No | Maximum web searches per request. Anthropic target only; ignored for other targets. |

**Notes:**
- Non-web-search tools (regular function tools) in the same request are left untouched.
- The adapter only fires when a web search tool is present; requests without web search tools have zero overhead.
- For Google providers, web search coercion requires the **native Gemini API** endpoint (`/v1beta/models/...`). The OpenAI-compatible endpoint Google exposes does not support any web search tool format.
- Pass-through optimisation is automatically disabled when any adapter is active.

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

### Provider Timeout Overrides

Each provider can optionally set `timeoutMs` to override the global upstream timeout for requests routed to that provider.

- **Unset / omitted**: inherit the global timeout
- **Set to a number**: use that provider-specific timeout instead
- **Valid range**: any positive integer millisecond value in provider config; the Admin UI exposes this as **1–3600 seconds**

Use provider overrides when one backend is predictably slower or faster than the rest. For example, you might keep a **300s** global timeout but set a **30s** timeout on a fast inference endpoint so stuck requests fail over much sooner.

### Provider Stall Detection Overrides

Each provider can optionally override any of the global stall detection settings with these fields:

- `stallTtfbMs` — per-provider TTFB timeout override
- `stallTtfbBytes` — per-provider TTFB byte threshold override
- `stallMinBps` — per-provider minimum throughput override
- `stallWindowMs` — per-provider sliding-window width override
- `stallGracePeriodMs` — per-provider grace period override

**Important inheritance rules:**

- If a field is **omitted**, the provider inherits the global setting for that field.
- For the nullable threshold fields (`stallTtfbMs`, `stallMinBps`), setting the value to **`null`** disables that stall dimension for the provider.
- For the non-null tuning fields (`stallTtfbBytes`, `stallWindowMs`, `stallGracePeriodMs`), `null`/empty in practice means “use the inherited global value”.

This lets you keep one global policy while tightening or relaxing stall protection for known outliers.

---

## Model Aliases

A **model alias** is a virtual model name that clients use in requests. Each alias maps to one or more provider targets with routing logic.

### Alias Settings

| Setting | Description | Required |
|---------|-------------|----------|
| **Slug** | Name clients send (e.g., `fast-model`) | Yes |
| **Type** | `chat` (default), `embeddings`, `transcriptions`, `speech`, `image` | No |
| **Additional Aliases** | Alternative names that also route here | No |
| **Priority** | Routing order: `selector` (default) or `api_match` | No |
| **Target Groups** | Ordered groups of targets, each with its own selector | Yes |
| **Metadata** | External catalog for model info | No |

### Target Groups

Aliases contain one or more **target groups**. The dispatcher exhausts all healthy targets in group 1 before trying group 2, and so on. Each group has:

- **Name** — Label for the group (e.g. `"subscription"`, `"payg"`, `"backup"`)
- **Selector** — Strategy for ordering targets within this group
- **Targets** — List of provider/model pairs in this group

This allows you to organise targets by preference. For example:

| Group | Name | Selector | Purpose |
|-------|------|----------|---------|
| 1 | `subscription` | `e2e_performance` | Use paid subscriptions first (sunk cost) |
| 2 | `payg` | `cost` | Fall back to cheapest pay-as-you-go option |
| 3 | `backup` | `in_order` | Last-resort backup target |

If no groups are explicitly configured, all targets live in a single `default` group.

### Selector Strategies

| Strategy | Behavior |
|----------|----------|
| `random` (default) | Distributes requests randomly across healthy targets in the group |
| `in_order` | Tries targets in order, skips unhealthy ones |
| `cost` | Routes to cheapest provider (requires pricing) |
| `performance` | Routes to highest post-TTFT throughput (output tokens / streaming time) |
| `latency` | Routes to lowest time-to-first-token |
| `usage` | Routes to provider with least recent usage (last 24 hours) |
| `e2e_performance` | Routes to highest end-to-end throughput (output tokens / total request time) |

#### Inline Exploration (default)

Use `performanceExplorationRate` (default 0.05) to occasionally explore other targets and prevent locking onto one provider. Applies to `performance`, `latency`, and `e2e_performance` selectors. `latencyExplorationRate` and `e2ePerformanceExplorationRate` can be set separately for their respective selectors (each defaults to `performanceExplorationRate` if not specified). Unlike `performance`, the `e2e_performance` selector explores across all candidates including the current best, ensuring end-to-end metrics stay fresh for every provider.

Inline exploration occurs on the live request path: a small fraction of incoming requests are intentionally routed to non-optimal targets so their performance data stays fresh. The trade-off is that those specific requests may be slower than necessary.

#### Background Exploration

To keep performance data fresh **without** ever diverting live requests, enable `backgroundExploration` instead. When enabled, the inline exploration above is suppressed for the three perf-based selectors, and Plexus instead fires small representative probe requests in the background against stale targets.

```yaml
backgroundExploration:
  enabled: true                  # default: false
  stalenessThresholdSeconds: 600 # default: 600 (10 minutes), minimum: 1
  workerConcurrency: 2           # default: 2, range: 1–16
```

How it works:

- Each live request to an alias whose selector is `latency`, `performance`, or `e2e_performance` checks the targets in its active group. Any target whose last probe is older than `stalenessThresholdSeconds` is enqueued for a background probe.
- The live request itself is **never** redirected or delayed — it is served by the selector's best choice.
- A worker pool (`workerConcurrency`) drains the queue. Per-target in-flight guards and the global cooldown manager prevent duplicate or unhealthy probes.
- Each probe is a single canonical chat request (moderate input, two tool definitions, `max_tokens: 1000`, streaming). It exercises the same transformer + provider path as live traffic, so TTFT / TPS / E2E TPS are measured identically.
- Probes route via `direct/<provider>/<target_model>` so they bypass alias resolution and failover, hitting exactly one target.
- Probes appear in usage records with `apiKey = "probe"` and `attribution = "background"` (or `"manual"` for probes triggered from the management test endpoint). They are real requests and do consume provider quota / cost; budgets and rate caps are out of scope in v1.
- On cold start, each target's `lastProbedAt` is initialised to the process start time — the first probe for a target fires at normal cadence once `stalenessThresholdSeconds` elapses, not eagerly on the first request.

The inline `performanceExplorationRate` / `latencyExplorationRate` / `e2ePerformanceExplorationRate` settings are preserved and continue to take effect when `backgroundExploration.enabled` is `false` (the default). All four settings can be edited from the **Config** page in the admin UI.

### Priority Modes

- **`selector` (default)**: Selector picks a provider within each group first, then matches API format.
- **`api_match`**: Filter targets to those whose provider supports the incoming API format first, then apply the group's selector. Best for tools requiring specific API features (e.g., Claude Code with Anthropic messages).

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

## Request Timeouts

Plexus can abort upstream requests that run too long instead of waiting forever.

Timeouts matter for both reliability and cost:

- they stop abandoned or hung upstream requests from continuing to burn quota,
- they allow the dispatcher to fail over to another provider when appropriate,
- and they put a hard cap on runaway or extremely slow streams.

### Default Behavior

- **Global default timeout**: `300` seconds
- **Per-provider override**: optional via `timeoutMs`
- **Effective timeout**: `provider.timeoutMs ?? (global timeout.defaultSeconds × 1000)`

If the timeout fires before the request completes:

- Plexus aborts the upstream fetch,
- the request is recorded with `responseStatus = "timeout"`,
- and failover may continue to the next provider when the dispatcher is still in a retryable/failover-safe stage.

### Global Timeout Configuration

Global timeout settings live in system settings and are exposed through the Admin UI **Config → Timeout Settings** and the management API.

| Field | Type | Default | Range | Meaning |
|------|------|---------|-------|---------|
| `defaultSeconds` | integer | `300` | `1–3600` | Default maximum duration for any upstream request unless the selected provider overrides it |

### Per-Provider Timeout Configuration

| Field | Type | Default | Meaning |
|------|------|---------|---------|
| `timeoutMs` | integer (milliseconds) | inherit global | Override the global timeout for requests routed to this provider |

### Management API

- `GET /v0/management/config/timeout` — returns the effective global timeout config
- `PATCH /v0/management/config/timeout` — partial update of timeout settings

Example:

```json
PATCH /v0/management/config/timeout
{
  "defaultSeconds": 120
}
```

### Tuning Guidance

- Start with the default `300s` if you are unsure.
- Lower it for providers that should either respond quickly or fail fast.
- Raise it only for providers that legitimately need long-running responses.
- Prefer a provider-specific override over increasing the global timeout for everyone.

---

## Stall Detection

Stall detection protects against providers that are technically connected but behaving too slowly to be useful.

Unlike a plain timeout, stall detection can distinguish between:

- a provider that **never starts producing meaningful bytes** (TTFB stall), and
- a provider that **starts streaming but then slows below an acceptable throughput floor** (throughput stall).

By default, stall detection is effectively **off** because both threshold dimensions are disabled:

- `ttfbSeconds = null`
- `minBytesPerSecond = null`

The supporting tuning values still have defaults even when detection is disabled:

- `ttfbBytes = 100`
- `windowSeconds = 10`
- `gracePeriodSeconds = 30`

### Two Stall Dimensions

#### 1. TTFB Stall Detection

TTFB (time-to-first-bytes) detection checks whether the provider produces **enough bytes** quickly enough.

It uses two values together:

- `ttfbSeconds` — how long Plexus waits
- `ttfbBytes` — how many bytes must arrive within that time to count as meaningful output

If the threshold is not met in time, Plexus treats the provider as stalled and aborts that attempt.

**Important:** when this happens before any response bytes reach the client, the dispatcher can transparently fail over to another provider.

#### 2. Throughput Stall Detection

Throughput detection applies **after** the provider has started responding.

It uses:

- `minBytesPerSecond` — minimum acceptable streaming rate
- `windowSeconds` — sliding window width for measuring throughput
- `gracePeriodSeconds` — delay after TTFB success before throughput enforcement starts

The grace period is especially important for reasoning-heavy models that may pause naturally after their first chunk.

If throughput drops below the configured floor, Plexus aborts the stream and records the request as `stall`.

**Important:** once bytes have already been sent to the client, Plexus cannot transparently fail over the same response stream. The client must retry.

### Global Stall Settings

Global stall settings live in the Admin UI under **Config → Stall Detection** and in the management API.

| Field | Type | Default | Range | Meaning |
|------|------|---------|-------|---------|
| `ttfbSeconds` | integer or `null` | `null` | `5–120` or `null` | Max time to wait for the first meaningful bytes. `null` disables TTFB stall detection. |
| `ttfbBytes` | integer | `100` | `50–10000` | Byte threshold that must arrive within `ttfbSeconds` to count as “started”. |
| `minBytesPerSecond` | integer or `null` | `null` | `50–5000` or `null` | Minimum acceptable streaming throughput. `null` disables throughput stall detection. |
| `windowSeconds` | integer | `10` | `3–30` | Sliding window width used to calculate throughput. |
| `gracePeriodSeconds` | integer | `30` | `0–120` | Delay after TTFB success before throughput enforcement starts. |

### Effective Behavior and Inheritance

- Stall detection is **enabled** for a request if either `ttfbSeconds` or `minBytesPerSecond` is active after global + provider override resolution.
- Provider overrides take precedence over global settings.
- Per-provider overrides can enable stall detection even if the global stall config is disabled.
- Leaving provider fields empty keeps the global value for that field.

### Management API

- `GET /v0/management/config/stall` — returns the current global stall detection config
- `PATCH /v0/management/config/stall` — partial update of stall settings

Example:

```json
PATCH /v0/management/config/stall
{
  "ttfbSeconds": 15,
  "ttfbBytes": 100,
  "minBytesPerSecond": 500,
  "windowSeconds": 10,
  "gracePeriodSeconds": 30
}
```

Disable one dimension while keeping the other:

```json
PATCH /v0/management/config/stall
{
  "ttfbSeconds": null,
  "minBytesPerSecond": 400
}
```

### Recommended Starting Points

- **Fail over slow starters only**: set `ttfbSeconds`, leave `minBytesPerSecond` as `null`
- **Protect long streams too**: set both `ttfbSeconds` and `minBytesPerSecond`
- **Reasoning-heavy models**: keep a longer `gracePeriodSeconds`
- **Bursty but healthy streams**: increase `windowSeconds` before raising `minBytesPerSecond`

### Relationship to Client Disconnects

Separate from timeout/stall settings, Plexus now also cancels upstream provider requests when the downstream client disconnects during streaming. This reduces wasted quota for abandoned requests even when neither timeouts nor stall detection are enabled.

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

Configure via Admin UI or API:
- `input`: dollars per million input tokens (e.g., `3.00`)
- `output`: dollars per million output tokens (e.g., `15.00`)
- `cached`: cache read rate (optional)
- `cache_write`: cache write rate (optional)

### OpenRouter Pricing

Fetches live rates from OpenRouter. Configure via Admin UI or API:
- Set source to `openrouter`
- Set model `slug` (e.g., `anthropic/claude-3.5-sonnet`)
- Optional `discount` for percentage off all rates

### Tiered Pricing

Useful for providers with volume discounts. Configure tiers via Admin UI or API:

| Lower Bound | Upper Bound | Input Rate | Output Rate |
|-------------|-------------|------------|-------------|
| 0 | 200,000 | $3.00/M | $15.00/M |
| 200,001 | ∞ (infinity) | $1.50/M | $7.50/M |

### Per-Request Pricing

Flat fee regardless of token count. Configure via Admin UI or API:
- Set source to `per_request`
- Set `amount` (e.g., `0.04`)

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
