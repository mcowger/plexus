# Configuration

Plexus is configured via a `config/plexus.yaml` file. This file defines your providers, model routing logic, and global settings.

## Configuration File (`plexus.yaml`)

The configuration file is YAML-based and sits at the heart of how Plexus routes and transforms requests.

### Example Configuration

```yaml
adminKey: "change-me-to-a-secure-password"

providers:
  openai_direct:
    api_base_url: https://api.openai.com/v1
    api_key: your_openai_key
    models:
      - gpt-4o
      - gpt-4o-mini
      - text-embedding-3-small

  my_anthropic:
    api_base_url: https://api.anthropic.com/v1
    api_key: your_anthropic_key
    models:
      - claude-3-5-sonnet-latest

  voyage:
    api_base_url: https://api.voyageai.com/v1
    api_key: your_voyage_key
    models:
      voyage-3:
        type: embeddings
        pricing:
          source: simple
          input: 0.00006
          output: 0

models:
  fast-model:
    targets:
      - provider: openai_direct
        model: gpt-4o-mini

  smart-model:
    targets:
      - provider: my_anthropic
        model: claude-3-5-sonnet-latest

  balanced-model:
    selector: random
    targets:
      - provider: openai_direct
        model: gpt-4o
      - provider: my_anthropic
        model: claude-3-5-sonnet-latest

  embeddings-model:
    type: embeddings
    selector: cost
    targets:
      - provider: openai_direct
        model: text-embedding-3-small
      - provider: voyage
        model: voyage-3

  transcription-model:
    type: transcriptions
    targets:
      - provider: openai_direct
        model: whisper-1

  speech-model:
    type: speech
    targets:
      - provider: openai_direct
        model: tts-1-hd

  image-model:
    type: image
    targets:
      - provider: openai_direct
        model: dall-e-3

keys:
  my-app:
    secret: "sk-plexus-my-key"
    comment: "Main application"
```

---

## Configuration Sections

### `adminKey` (Required)

This global setting secures the Admin Dashboard and Management APIs (`/v0/*`). The server will refuse to start if it is missing. It cannot be changed via the UI — only in `plexus.yaml`.

```yaml
adminKey: "my-super-secret-admin-password"
```

The `adminKey` is used in two ways:

1. **Dashboard Access**: Users are prompted for this key when opening the web interface.
2. **API Access**: Requests to Management APIs (`/v0/*`) must include the header `x-admin-key: <your-key>`.

---

### `providers`

This section defines the upstream AI providers that Plexus will route requests to.

**Basic Configuration Fields:**

- **`api_base_url`**: The base URL for the provider's API. The API type is automatically inferred:
  - URLs starting with `oauth://` → OAuth format (pi-ai)
  - URLs containing `anthropic.com` → `messages` format
  - URLs containing `generativelanguage.googleapis.com` → `gemini` format
  - All other URLs → `chat` format (OpenAI-compatible)

  For providers that support multiple API formats, use a map:
  ```yaml
  api_base_url:
    chat: https://api.example.com/v1
    messages: https://api.example.com/anthropic/v1
  ```
  The keys (`chat`, `messages`) define the supported API types.

- **`display_name`**: (Optional) A friendly name shown in logs and the dashboard.

- **`api_key`**: (Required) The authentication key for this provider.

- **`enabled`**: (Optional, default: `true`) Set to `false` to temporarily disable a provider.

- **`models`**: The models available from this provider. Can be a simple list or a map with per-model configuration:
  ```yaml
  models:
    gpt-4o:
      pricing:
        source: simple
        input: 5.0
        output: 15.0
    text-embedding-3-small:
      type: embeddings
    dall-e-3:
      type: image
      pricing:
        source: per_request
        amount: 0.04
  ```

- **`headers`**: (Optional) Custom HTTP headers to include in every request to this provider.

- **`extraBody`**: (Optional) Additional fields to merge into every request body.

- **`discount`**: (Optional) A percentage discount (0.0–1.0) applied to `simple` and `openrouter` pricing for this provider.

- **`estimateTokens`**: (Optional, default: `false`) Enable automatic token estimation for providers that don't return usage data. See [Token Estimation](TOKEN_ESTIMATION.md).

- **`disable_cooldown`**: (Optional, default: `false`) When `true`, this provider is never placed on cooldown regardless of errors. See [Disabling Cooldowns Per Provider](#disabling-cooldowns-per-provider).

#### Model Pricing Sources

Each model entry can include a `pricing` block. Four sources are supported:

| Source | Description |
|--------|-------------|
| `simple` | Fixed per-million token rates for input, output, cached reads, and cache writes. |
| `openrouter` | Live per-token rates fetched from OpenRouter by model slug. |
| `defined` | Tiered token-based pricing where the rate depends on input token volume. |
| `per_request` | Flat fee per API call, regardless of token count. |

**`simple`** — fixed rates per million tokens:
```yaml
pricing:
  source: simple
  input: 3.00        # $ per million input tokens
  output: 15.00      # $ per million output tokens
  cached: 0.30       # $ per million cache-read tokens (optional)
  cache_write: 3.75  # $ per million cache-write tokens (optional)
```

**`openrouter`** — live rates from the OpenRouter pricing API:
```yaml
pricing:
  source: openrouter
  slug: anthropic/claude-3.5-sonnet
  discount: 0.1      # Optional: 10% discount applied to all rates
```

**`defined`** — tiered rates by input token volume:
```yaml
pricing:
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
      cached_per_m: 0.15   # optional
```

**`per_request`** — flat fee per call, independent of token usage:
```yaml
pricing:
  source: per_request
  amount: 0.04   # $ charged for every request
```

The full cost is stored under `costInput`; `costOutput`, `costCached`, and `costCacheWrite` are zero. `costSource` will be `per_request` and `costMetadata` will contain `{"amount": 0.04}`.

#### Multi-Protocol Providers

For providers that support multiple API formats, map each type to its specific base URL:

```yaml
providers:
  synthetic:
    display_name: Synthetic Provider
    api_base_url:
      chat: https://api.synthetic.new/openai/v1
      messages: https://api.synthetic.new/anthropic/v1
      embeddings: https://api.synthetic.new/openai/v1
    api_key: "your-synthetic-key"
    models:
      "hf:MiniMaxAI/MiniMax-M2.1":
        access_via: ["chat", "messages"]
      "hf:nomic-ai/nomic-embed-text-v1.5":
        type: embeddings
```

When combined with `priority: api_match` on a model alias, Plexus will automatically prefer providers that natively speak the incoming API format.

#### OAuth Providers (pi-ai)

Plexus supports OAuth-backed providers (Anthropic, GitHub Copilot, Gemini CLI, Antigravity, OpenAI Codex) through the [pi-ai](https://www.npmjs.com/package/@mariozechner/pi-ai) library. Credentials are managed through the Admin UI — no manual file setup is required.

**Requirements:**
- Provider `api_base_url` set to `oauth://`
- Provider `api_key` set to `oauth`
- `oauth_account` set to a specific account ID (e.g. `work`, `personal`)
- `oauth_provider` set when the provider key doesn't match the pi-ai provider ID

**Example:**

```yaml
providers:
  codex-work:
    display_name: OpenAI Codex (Work)
    api_base_url: oauth://
    api_key: oauth
    oauth_provider: openai-codex
    oauth_account: work
    models:
      - gpt-5-mini
      - gpt-5

  codex-personal:
    display_name: OpenAI Codex (Personal)
    api_base_url: oauth://
    api_key: oauth
    oauth_provider: openai-codex
    oauth_account: personal
    models:
      - gpt-5-mini
      - gpt-5

  github-copilot-main:
    display_name: GitHub Copilot (Main)
    api_base_url: oauth://
    api_key: oauth
    oauth_provider: github-copilot
    oauth_account: main
    models:
      - gpt-4o
      - claude-3-5-sonnet-20241022
```

#### OAuth Credentials (`auth.json`)

OAuth credentials are stored in `auth.json` (default path: `./auth.json`). The file is created and updated automatically when you log in via the Admin UI. If no file exists at startup, Plexus logs a warning and OAuth providers remain unavailable until credentials are added.

- **Override path** with the `AUTH_JSON` environment variable (absolute or relative to the server working directory).
- An example file is provided at `auth.json.example`.
- Credentials are keyed by provider and account ID:

```json
{
  "openai-codex": {
    "accounts": {
      "work": { "type": "oauth", "accessToken": "...", "refreshToken": "...", "expiresAt": 1738627200000 },
      "personal": { "type": "oauth", "accessToken": "...", "refreshToken": "...", "expiresAt": 1738627200000 }
    }
  }
}
```

#### `providers.<provider>.quota_checker` (Optional)

Quota checkers are configured per provider. Plexus periodically polls each enabled checker and stores results for monitoring and alerting.

```yaml
providers:
  my-provider:
    api_key: "..."
    api_base_url: https://api.example.com/v1
    quota_checker:
      type: synthetic | naga | nanogpt | openai-codex | claude-code | zai | moonshot | minimax
      enabled: true
      intervalMinutes: 30
      # id: custom-checker-id   # optional; defaults to provider key
      # options: {}
```

**Fields:**
- `type` (**required**): checker implementation to use.
- `enabled` (optional, default `true`): enable/disable checker.
- `intervalMinutes` (optional, default `30`): polling interval, minimum `1`.
- `id` (optional): explicit checker ID. Defaults to provider key.
- `options` (optional): checker-specific options map.

**OAuth restrictions:**
- Providers with `oauth_provider: openai-codex` must use `quota_checker.type: openai-codex`.
- Providers with `oauth_provider: anthropic` must use `quota_checker.type: claude-code`.

**Checker notes:**
- `synthetic`: Derives `options.apiKey` from provider `api_key` by default.
- `naga`: Balance-based checker.
- `nanogpt`: NanoGPT usage checker.
- `openai-codex`: OAuth-backed; reads token from `auth.json`.
- `claude-code`: OAuth-backed; reads token from `auth.json`.
- `zai`: ZAI balance-based checker.
- `moonshot`: Moonshot balance-based checker.
- `minimax`: Requires `options.groupid` and `options.hertzSession` (treat like a password).

**Examples:**

```yaml
providers:
  synthetic:
    api_base_url:
      chat: https://api.synthetic.new/openai/v1
      messages: https://api.synthetic.new/anthropic/v1
    api_key: syn_your_api_key
    quota_checker:
      type: synthetic
      enabled: true
      intervalMinutes: 30

  codex:
    api_base_url: oauth://
    api_key: oauth
    oauth_provider: openai-codex
    oauth_account: work
    quota_checker:
      type: openai-codex
      enabled: true
      intervalMinutes: 10

  minimax:
    api_base_url: https://api.minimax.chat/v1
    api_key: dummy
    quota_checker:
      type: minimax
      enabled: true
      intervalMinutes: 30
      options:
        groupid: "1234567890"
        hertzSession: "paste-session-cookie-here"
```

Quota data is available via the Management API — see [API Reference: Quota Management](./API.md#quota-management).

---

### `models`

This section defines virtual model aliases that clients use in the `model` field of their requests.

- **Model Alias**: The key (e.g., `fast-model`) is the name clients send.

- **`type`**: (Optional) `chat` (default), `embeddings`, `transcriptions`, `speech`, or `image`. Determines which endpoints can access this model:
  - `chat`: `/v1/chat/completions` and `/v1/messages`
  - `embeddings`: `/v1/embeddings` only
  - `transcriptions`: `/v1/audio/transcriptions` only
  - `speech`: `/v1/audio/speech` only
  - `image`: `/v1/images/generations` and `/v1/images/edits`

- **`additional_aliases`**: (Optional) Alternative names that also route to this alias. Useful for clients with fixed model name lists.

- **`selector`**: (Optional) How to choose between multiple targets. See [Selector Strategies](#selector-strategies) below.

- **`priority`**: (Optional) Controls the routing lifecycle order:
  - `selector` (default): Choose a provider using the selector, then find the best API format for that provider.
  - `api_match`: Filter for providers that natively support the incoming API format first, then apply the selector. Falls back to all providers if none match. Best for tools that rely on specific API features (e.g., Claude Code with Anthropic messages).

- **`targets`**: A list of provider/model pairs that back this alias.
  - `provider`: Must match a key in the `providers` section.
  - `model`: The upstream model name.
  - `enabled`: (Optional, default `true`) Set to `false` to temporarily skip this target.

- **`metadata`**: (Optional) Link this alias to a model in an external catalog. When configured, Plexus fetches the model's metadata at startup and includes enriched fields (`name`, `description`, `context_length`, `architecture`, `pricing`, `supported_parameters`, `top_provider`) in the `GET /v1/models` response, following the OpenRouter model format. This is useful for clients that rely on model metadata to make routing decisions (e.g., context window selection).

  **Fields:**
  - `source` (required): The external catalog to use. One of: `openrouter`, `models.dev`, `catwalk`
  - `source_path` (required): The model's identifier within that catalog.

  **`source_path` format by source:**

  | Source | Format | Example |
  |--------|-----|---------|
  | `openrouter` | `provider/model` | `openai/gpt-4.1-nano` |
  | `models.dev` | `providerid.modelid` | `anthropic.claude-3-5-haiku-20241022` |
  | `catwalk` | `providerid.modelid` | `anthropic.claude-3-5-haiku-20241022` |

  **Example:**
  ```yaml
  models:
    fast-model:
      targets:
        - provider: openai_direct
          model: gpt-4.1-nano
      metadata:
        source: openrouter
        source_path: openai/gpt-4.1-nano

    smart-model:
      targets:
     - provider: my_anthropic
          model: claude-3-5-haiku-20241022
      metadata:
        source: models.dev
        source_path: anthropic.claude-3-5-haiku-20241022
  ```

  The metadata catalog is loaded at startup from:
  - OpenRouter: `https://openrouter.ai/api/v1/models`
  - models.dev: `https://models.dev/api.json`
  - Catwalk: `https://catwalk.charm.sh/providers`

  Metadata loading is non-fatal — if a source is unavailable, Plexus continues operating and returns base model information for aliases that reference that source.

**Example with multiple targets and API priority:**

```yaml
models:
  balanced-model:
    selector: random
    priority: api_match
    targets:
      - provider: openai
        model: gpt-4o
      - provider: anthropic
        model: claude-3-5-sonnet-latest
```

With this configuration, Anthropic-format requests prefer the Anthropic provider; OpenAI-format requests prefer OpenAI. Both fall back to transformation if the preferred provider is unavailable.

#### Selector Strategies

The `selector` field determines which target is chosen from the available healthy targets:

- **`random` (Default)**: Distributes requests randomly. Good for general load balancing.

- **`in_order`**: Selects targets in the order defined, falling back to the next if the current is unhealthy. Useful for primary/fallback patterns:

  ```yaml
  models:
    minimax-m2.1:
      selector: in_order
      targets:
        - provider: naga
          model: minimax-m2.1
        - provider: synthetic
          model: "hf:MiniMaxAI/MiniMax-M2.1"
  ```

- **`cost`**: Routes to the lowest-cost healthy provider. Uses a standardized comparison (1000 input + 500 output tokens). Requires pricing configuration. For `per_request` pricing, the flat fee is used directly.

- **`performance`**: Routes to the highest average tokens/sec provider based on the last 10 requests. Falls back to the first target if no data exists.

  To prevent the selector from permanently locking on to one provider, configure an exploration rate:
  ```yaml
  performanceExplorationRate: 0.05  # 5% chance to pick a random provider (default)
  ```

- **`latency`**: Routes to the lowest average time-to-first-token provider based on the last 10 requests.

  ```yaml
  latencyExplorationRate: 0.05  # 5% chance to explore (defaults to performanceExplorationRate)
  ```

#### Direct Model Routing

Requests can bypass the alias system entirely using the `direct/` prefix format:

**Format:** `direct/<provider-key>/<model-name>`

```bash
# Route directly to gpt-4o-mini on the openai_direct provider
curl ... -d '{"model": "direct/openai_direct/gpt-4o-mini", ...}'
```

- The provider must exist in `providers` and be enabled.
- The model must be listed in the provider's `models`.
- Bypasses selector logic, `additional_aliases`, and alias configuration.
- Used by the Admin UI's provider test feature.

#### Routing & Dispatching Lifecycle

When a request enters Plexus, it follows a two-stage process:

**Default (`priority: selector`):**

1. **Routing** — The selector picks exactly one healthy target.
2. **Dispatching** — Plexus matches the incoming API format to the chosen provider's supported formats. If they match, it uses pass-through (no transformation). Otherwise it transforms.

**Inverted (`priority: api_match`):**

1. **API Matching** — Plexus filters all healthy targets to those that natively support the incoming API format. If none match, it falls back to all healthy targets.
2. **Routing** — The selector is applied to the filtered list.

---

### `keys`

This section defines the API keys that clients must use to access Plexus inference endpoints.

- **Key Name**: A unique identifier (e.g., `client-app-1`).
- **`secret`**: The bearer token clients include in the `Authorization` header.
- **`comment`**: (Optional) Description or owner.
- **`quota`**: (Optional) Name of a quota definition from `user_quotas` to enforce for this key.

```yaml
keys:
  production-app:
    secret: "sk-plexus-abc-123"
    comment: "Main production application"

  testing-key:
    secret: "sk-plexus-test-456"
    comment: "CI/CD Test Key"
```

At least one key is required. Clients must include `Authorization: Bearer <secret>` on all requests. The `/v1/models` endpoint is exempt from authentication.

#### Dynamic Key Attribution

Append a `:label` to any secret to track usage by feature or team without creating separate keys:

**Format:** `<secret>:<attribution>`

```bash
# Track requests from the Copilot feature
curl -H "Authorization: Bearer sk-plexus-app-abc-123:copilot" ...

# Track requests from mobile v2.5
curl -H "Authorization: Bearer sk-plexus-app-abc-123:mobile:v2.5" ...
```

- The part before the first colon authenticates the request.
- The remainder is stored as `attribution` in usage logs.
- Attribution values are normalized to lowercase.
- All variations of the same secret authenticate as the same key.

Query attribution data:

```sql
SELECT api_key, attribution, COUNT(*) as request_count, SUM(tokens_input) as total_input_tokens
FROM request_usage
WHERE api_key = 'app-key'
GROUP BY attribution
ORDER BY request_count DESC;
```

---

## Optional Configuration

### `user_quotas`

Per-API-key usage enforcement. Unlike provider quota checkers (which monitor provider rate limits), user quotas limit how much an individual key can consume.

| Type | Description | Reset Behavior |
|------|-------------|----------------|
| `rolling` | Leaky bucket algorithm | Continuously decays over time |
| `daily` | Calendar day quota | Resets at UTC midnight |
| `weekly` | Calendar week quota | Resets at UTC midnight Sunday |

**Limit types:** `requests` (count per call) or `tokens` (sum of input + output + reasoning + cached).

```yaml
user_quotas:
  premium_hourly:
    type: rolling
    limitType: tokens
    limit: 100000
    duration: 1h      # Required for rolling. Supports: 30s, 5m, 1h, 2h30m, 1d

  burst_limited:
    type: rolling
    limitType: requests
    limit: 10
    duration: 5m

  basic_daily:
    type: daily
    limitType: requests
    limit: 1000

  enterprise_weekly:
    type: weekly
    limitType: tokens
    limit: 5000000
```

**Assign to keys:**

```yaml
keys:
  acme_corp:
    secret: "sk-acme-secret"
    quota: premium_hourly

  free_user:
    secret: "sk-free-secret"
    quota: basic_daily

  unlimited:
    secret: "sk-unlimited"
    # No quota field = unlimited access
```

**How rolling (leaky bucket) quotas work:**

1. Usage is recorded after each request completes.
2. On the next request, usage "leaks" based on elapsed time: `leaked = elapsed_time × (limit / duration)`.
3. New usage is added to the remaining amount.

Example: 10 requests/hour quota. You make 10 requests at 12:00 PM. At 12:30 PM, 50% has leaked → remaining usage is 5. A new request brings it to 6.

> **Note:** The stored usage value may be fractional for `requests` quotas due to the leak calculation. This is expected.

If you change a quota's `limitType`, Plexus automatically detects this and resets usage to zero.

**Management API:**
- `GET /v0/management/quota/status/:key` — quota status for a key
- `POST /v0/management/quota/clear` — reset usage to zero

See [API Reference: User Quota Enforcement](./API.md#user-quota-enforcement-api).

---

### `cooldown`

Configures the escalating cooldown system that temporarily removes unhealthy providers from the routing pool using exponential backoff.

**Formula:** `C(n) = min(C_max, C_0 × 2^n)` where `n` = consecutive failures (0-indexed).

| Failure # | Duration (defaults) |
|-----------|---------------------|
| 1st | 2 minutes |
| 2nd | 4 minutes |
| 3rd | 8 minutes |
| 4th | 16 minutes |
| 5th | 32 minutes |
| 6th | 64 minutes |
| 7th | 128 minutes |
| 8th | 256 minutes |
| 9th+ | 300 minutes (cap) |

**Key behaviors:**
- Any successful request resets the failure count to 0.
- `413 Payload Too Large` errors do NOT trigger cooldowns — they are client-side errors.
- Each provider+model combination tracks failures independently.
- Cooldowns persist to the database and survive restarts.

```yaml
cooldown:
  initialMinutes: 2    # Default: 2
  maxMinutes: 300      # Default: 300 (5 hours)
```

More aggressive example (1 min initial, 1 hour max):
```yaml
cooldown:
  initialMinutes: 1
  maxMinutes: 60
```

**Management API:**
- `GET /v0/management/cooldowns` — list active cooldowns
- `DELETE /v0/management/cooldowns` — clear all cooldowns
- `DELETE /v0/management/cooldowns/:provider?model=:model` — clear specific cooldown

See [API Reference: Cooldown Management](./API.md#cooldown-management).

#### Disabling Cooldowns Per Provider

Set `disable_cooldown: true` on a provider to opt it out of the cooldown system entirely. Useful for local model servers, providers with their own rate-limit handling, or testing:

```yaml
providers:
  local-ollama:
    display_name: Local Ollama
    api_base_url: http://localhost:11434/v1
    api_key: ollama
    disable_cooldown: true
    models:
      - llama3.2
      - mistral
```

**Behavior:** Targets backed by this provider are always considered healthy for routing. Error recording still occurs normally. Other providers in the same alias are unaffected.

| Scenario | Recommended |
|----------|-------------|
| Local model server (Ollama, LM Studio) | ✅ Yes |
| Provider with its own external rate-limit handling | ✅ Yes |
| Primary fallback that must always be available | ✅ Yes |
| Testing provider where cooldowns interfere | ✅ Yes |
| Production cloud provider with unreliable endpoints | ❌ No |
| Provider that frequently returns 429s | ❌ No |

The toggle is also available in the Admin UI under **Advanced → Disable Cooldowns** on any provider.

---

### `mcp_servers` (Optional)

Proxy [Model Context Protocol](https://modelcontextprotocol.io) servers through Plexus. Only **streamable HTTP** transport is supported — `stdio` is not.

```yaml
mcp_servers:
  tavily:
    upstream_url: "https://mcp.tavily.com/mcp/?tavilyApiKey=your-api-key"
    enabled: true

  filesystem:
    upstream_url: "http://localhost:3001/mcp"
    enabled: true
    headers:
      Authorization: "Bearer some-token"
```

**Fields:**
- `upstream_url` (**required**): Full URL of the MCP server endpoint.
- `enabled` (optional, default `true`): Whether this server is active.
- `headers` (optional): Static headers forwarded to the upstream on every request.

**Endpoints:** Each server is exposed at `/mcp/:name`:
- `POST /mcp/:name` — JSON-RPC messages
- `GET /mcp/:name` — Server-Sent Events (SSE) for streaming
- `DELETE /mcp/:name` — Session termination

**Authentication:** All MCP endpoints require a Plexus API key (`Authorization: Bearer <key>`). Client auth headers are **not** forwarded upstream — only the static `headers` configured above.

**OAuth Discovery:** Plexus exposes standard OAuth 2.0 discovery endpoints for MCP clients that expect OAuth flows:
- `GET /.well-known/oauth-authorization-server`
- `GET /.well-known/oauth-protected-resource`
- `GET /.well-known/openid-configuration`
- `POST /register`

These return metadata indicating that Plexus uses Bearer token (API key) authentication.

---

### `failover` (Optional)

Controls the global failover/retry behavior for multi-target model aliases.

```yaml
failover:
  enabled: true
  # retryableStatusCodes:
  #   - 408
  #   - 429
  #   - 500
  #   - 502
  #   - 503
  #   - 504
  # retryableErrors:
  #   - ECONNREFUSED
  #   - ETIMEDOUT
  #   - ENOTFOUND
```

By default, all non-2xx status codes except `400` and `422` trigger failover to the next healthy target. `retryableStatusCodes` and `retryableErrors` can be used to restrict this behaviour.

---

## Token Estimation

Some providers (particularly free-tier models on OpenRouter) don't return usage data in their responses. Enable `estimateTokens: true` on a provider to have Plexus automatically estimate token counts using a character-based heuristic.

```yaml
providers:
  openrouter-free:
    api_base_url: https://openrouter.ai/api/v1
    api_key: your_key
    estimateTokens: true
    models:
      - meta-llama/llama-3.2-3b-instruct:free
```

Estimated counts are typically within ±15% of actual values and are flagged with `tokensEstimated = 1` in the usage database. Estimation can also be enabled per-provider in the Admin UI under **Advanced → Estimate Tokens**.

→ See [Token Estimation Guide](TOKEN_ESTIMATION.md) for algorithm details, accuracy characteristics, performance impact, and database schema.
