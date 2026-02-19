# Configuration

Plexus is configured via a `config/plexus.yaml` file. This file defines your providers, model routing logic, and global settings.

## Configuration File (`plexus.yaml`)

The configuration file is YAML-based and sits at the heart of how Plexus routes and transforms requests.

### Example Configuration

```yaml
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
  # Define aliases and where they route
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

  # Embeddings model
  embeddings-model:
    type: embeddings
    selector: cost
    targets:
      - provider: openai_direct
        model: text-embedding-3-small
      - provider: voyage
        model: voyage-3

  # Audio transcription model
  transcription-model:
    type: transcriptions
    targets:
      - provider: openai_direct
        model: whisper-1

  # Text-to-speech model
  speech-model:
    type: speech
    targets:
      - provider: openai_direct
        model: tts-1-hd

  # Image generation model
  image-model:
    type: image
    targets:
      - provider: openai_direct
        model: dall-e-3

  # Image editing model
  image-edit-model:
    type: image
    targets:
      - provider: openai_direct
        model: gpt-image-1
```

## Direct Model Routing

As of v0.8.0, Plexus supports **Direct Model Routing**. This allows you to route requests directly to a provider's model without creating an alias in the `models` section. This uses the special `direct/` prefix format.

**Format:** `direct/<provider-key>/<model-name>`

**Example:**
```yaml
providers:
  openai_direct:
    api_base_url: https://api.openai.com/v1
    api_key: your_openai_key
    models:
      - gpt-4o-mini

# Clients can directly use: {"model": "direct/openai_direct/gpt-4o-mini", ...}
```

**How it works:**
1. When a request comes in with a model starting with `direct/`, Plexus parses the format
2. Extracts the provider key and model name from the path
3. Validates that the provider exists and is enabled
4. Bypasses alias resolution and selector logic
5. Routes directly to the specified provider/model combination

**Benefits:**
- Bypasses the alias system for simple, direct routing
- Useful for testing and debugging specific provider/model combinations
- Access models that aren't explicitly defined in the `models` section
- Used by the UI testing feature to test provider connections

**Notes:**
- The provider must exist in the `providers` section and be enabled
- The model must be listed in the provider's `models` configuration
- This bypasses any selector logic (random, cost, performance, etc.)
- This bypasses any `additional_aliases` configuration

## Routing & Dispatching Lifecycle

When a request enters Plexus, it follows a two-stage process to determine the destination and the protocol. The order of these stages can be configured using the `priority` field in the model configuration.

### Default Lifecycle (`priority: selector`)

1.  **Stage 1: Routing (The "Where")**: 
    - The **Selector** takes precedence here. 
    - Plexus identifies all healthy targets for the requested model alias.
    - It applies the configured `selector` (random, cost, etc.) to choose exactly **one** target provider and model.
    - **Outcome**: A specific provider and model are selected.

2.  **Stage 2: Dispatching (The "How")**: 
    - **API Matching** occurs after the target is locked in.
    - Plexus looks at the available API types for the selected provider (and specific model).
    - It attempts to match the incoming request format to an available provider protocol to enable **Pass-through Optimization**.
    - If a match is found, it uses that protocol; otherwise, it falls back to the first available protocol and performs transformation.

### Inverted Lifecycle (`priority: api_match`)

1.  **Stage 1: API Matching Filter**:
    - Plexus first identifies all healthy targets for the requested model alias.
    - It then filters these targets to only include those that natively support the **incoming API type** (e.g., if the client sent an OpenAI request, it looks for providers that support `chat`).
    - If one or more compatible targets are found, they are passed to the Selector.
    - If **no** targets support the incoming API type, Plexus falls back to the full list of healthy targets.

2.  **Stage 2: Routing**:
    - The **Selector** is applied to the filtered list (or the fallback list) to choose the final target.

---

## Configuration Sections

### `providers`

This section defines the upstream AI providers that Plexus will route requests to. Each provider configuration specifies how to connect and authenticate with that provider's API.

**Basic Configuration Fields:**

- **`api_base_url`**: The base URL for the provider's API. **The API type is automatically inferred from this field:**
  - Single URL string: Plexus infers the type from the URL pattern:
    - URLs starting with `oauth://` → `oauth` format (pi-ai)
    - URLs containing `anthropic.com` → `messages` format
    - URLs containing `generativelanguage.googleapis.com` → `gemini` format
    - All other URLs → `chat` format (OpenAI-compatible)
  - Object mapping for multi-protocol providers:
    ```yaml
    api_base_url:
      chat: https://api.example.com/v1
      messages: https://api.example.com/anthropic/v1
    ```
    The keys (`chat`, `messages`) define the supported API types.

  - **OAuth providers**: Set `api_base_url` to `oauth://` to route via the pi-ai OAuth bridge. Set `oauth_account` to the account ID to use for this provider entry. Use `oauth_provider` when the provider key doesn't match the pi-ai provider ID.

- **`display_name`**: (Optional) A friendly name shown in logs and the dashboard.

 - **`api_key`**: (Required) The authentication key for this provider.

- **`enabled`**: (Optional, default: `true`) Set to `false` to temporarily disable a provider.

- **`models`**: The models available from this provider. Can be:
  - An array of model name strings: `["model-a", "model-b"]`
  - An object mapping model names to configuration (for pricing, API access control, or model type):
    ```yaml
    models:
      gpt-4o:
        pricing:
          source: simple
          input: 5.0
          output: 15.0
      text-embedding-3-small:
        type: embeddings
        pricing:
          source: simple
          input: 0.00002
          output: 0
    ```

- **`headers`**: (Optional) Custom HTTP headers to include in every request to this provider.

- **`extraBody`**: (Optional) Additional fields to merge into every request body.

- **`discount`**: (Optional) A percentage discount (0.0-1.0) to apply to all pricing for this provider. Often used if you want to base your pricing on public numbers but apply a global discount.

- **`estimateTokens`**: (Optional, default: `false`) Enable automatic token estimation for providers that don't return usage data in their responses. When enabled, Plexus will reconstruct the response content and estimate token counts using a character-based heuristic algorithm. See [Token Estimation](#token-estimation) for details.

### OAuth Providers (pi-ai)

Plexus supports OAuth-backed providers (Anthropic, GitHub Copilot, Gemini CLI, Antigravity, OpenAI Codex) through the [pi-ai](https://www.npmjs.com/package/@mariozechner/pi-ai) library.

**Requirements:**
- OAuth credentials stored in `auth.json` (see below)
- Provider `api_base_url` set to `oauth://`
- Provider `oauth_account` set to a specific account ID
- `oauth_provider` set when the provider key differs from the pi-ai provider ID
- No fallback/default account behavior: if `oauth_account` is missing or credentials for that account do not exist, requests fail

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

### OAuth Credentials (`auth.json`)

OAuth providers read credentials from `auth.json` (default path: `./auth.json`).

- **Override path** with `AUTH_JSON` environment variable (absolute or relative to the server working directory).
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

- Credentials can be created via the Admin UI OAuth flow. OAuth login session creation requires both `providerId` and `accountId`.

#### `AUTH_JSON` Environment Variable

Set `AUTH_JSON` to point Plexus at a custom credentials file:

```bash
export AUTH_JSON=/absolute/path/to/auth.json
```

Relative paths are resolved from the server working directory (typically the repo root or container workdir).

**Multi-Protocol Provider Configuration:**

For providers that support multiple API endpoints (e.g., both OpenAI chat completions and embeddings), you can configure them as follows:

```yaml
providers:
  synthetic:
    display_name: Synthetic Provider
    
    # Map each API type to its specific base URL
    # API types are automatically inferred from the keys
    api_base_url:
      chat: https://api.synthetic.new/openai/v1
      messages: https://api.synthetic.new/anthropic/v1
      embeddings: https://api.synthetic.new/openai/v1
    
    api_key: "your-synthetic-key"
    
    models:
      # Chat models - specify which APIs each model supports
      "hf:MiniMaxAI/MiniMax-M2.1":
        access_via: ["chat", "messages"]
      
      # Embeddings models - automatically restricted to embeddings API
      "hf:nomic-ai/nomic-embed-text-v1.5":
        type: embeddings
        pricing:
          source: simple
          input: 0
          output: 0
```

When using multi-protocol providers with API priority matching (`priority: api_match` in model configuration), Plexus will automatically filter for providers that natively support the incoming API type, maximizing compatibility and enabling pass-through optimization.

**Single-Protocol Provider Example:**

```yaml
providers:
  openai:
    display_name: OpenAI
    api_base_url: https://api.openai.com/v1
    api_key: "sk-..."
    models:
      - gpt-4o
      - gpt-4o-mini
```

### `models`

This section defines the "virtual" models or aliases that clients will use when making requests to Plexus.

- **Model Alias**: The key (e.g., `fast-model`, `gpt-4-turbo`) is the name clients send in the `model` field of their API request.

- **`type`**: (Optional) The type of model - either `chat` (default), `embeddings`, `transcriptions`, `speech`, or `image`. This determines which API endpoints can access this model:
  - `chat`: Accessible via `/v1/chat/completions` and `/v1/messages` endpoints
  - `embeddings`: Only accessible via `/v1/embeddings` endpoint
  - `transcriptions`: Only accessible via `/v1/audio/transcriptions` endpoint
  - `speech`: Only accessible via `/v1/audio/speech` endpoint
  - `image`: Accessible via `/v1/images/generations` and `/v1/images/edits` endpoints
  
  **Example:**
  ```yaml
  models:
    my-embeddings:
      type: embeddings
      targets:
        - provider: openai
          model: text-embedding-3-small
    
    my-transcription:
      type: transcriptions
      targets:
        - provider: openai
          model: whisper-1

    my-speech:
      type: speech
      targets:
        - provider: openai
          model: tts-1-hd

    my-image-gen:
      type: image
      targets:
        - provider: openai
          model: dall-e-3
  ```

- **`additional_aliases`**: (Optional) A list of alternative names that should also route to this model configuration. Can be used for tools like Claude Code that are picky about model names, or clients that have fixed lists of models that you want to remap.

- **`selector`**: (Optional) The strategy to use for target selection when multiple targets are available:
  - `random`: (Default) Randomly selects a healthy target
  - `in_order`: Selects providers in the order defined, falling back to the next if the current one is unhealthy. this can be used to prioritize "subscription" providers before moving on to PAYG providers.  
  - `cost`: Routes to the lowest-cost healthy provider, as defined by the pricing.  
  - `performance`: Routes to the highest tokens-per-second provider, calculated over the last 10 requests.  
  - `latency`: Routes to the lowest time-to-first-token provider, calculated over the last 10 requests.  

- **`priority`**: (Optional) Determines the routing lifecycle order:
  - `selector` (Default): Choose a provider using the selector strategy, then use the best available API format for that provider
  - `api_match`: Filter for native API compatibility first, then apply the selector. If no providers match the incoming API type, falls back to any viable provider selected by the selector
  
  Use `api_match` when you want maximum compatibility with the incoming request format, even if it means fewer provider options. This is especially useful for:
  - Tools that rely on specific API features (e.g., Claude Code with Anthropic messages)
  - Maximizing pass-through optimization for better performance
  - Ensuring high-fidelity interactions by avoiding translation

 - **`targets`**: A list of provider/model pairs that back this alias.
   - `provider`: Must match a key defined in the `providers` section.
   - `model`: The specific model name to use on that provider.
   - **`cooldown_seconds`**: (Optional) Cooldown period in seconds for this specific target. When a target encounters an error or becomes unavailable, it will be marked as unhealthy for this duration before retry attempts. This allows you to configure different cooldown periods per-target within the same model alias.

**Example with API Priority Matching:**

```yaml
models:
  balanced-model:
    selector: random
    # Prioritize providers that natively support the incoming API type
    priority: api_match
    targets:
      - provider: openai
        model: gpt-4o
      - provider: anthropic
        model: claude-3-5-sonnet-latest
```

With this configuration, if a client sends an Anthropic-style request to `balanced-model`, Plexus will prefer the Anthropic provider (if healthy) to enable pass-through optimization. If an OpenAI-style request is sent, it will prefer the OpenAI provider.

**Selector Strategies:**

The `selector` field determines which target is chosen from the available healthy targets:

- **`random` (Default)**: Randomly distributes requests across all healthy targets. Useful for general load balancing without any specific optimization criteria.

- **`in_order`**: Selects targets in the exact order they are defined, automatically falling back to the next target if the current one becomes unhealthy. This is ideal when you have a **primary provider preference** with fallback providers. For example:

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

With this configuration:
1. Requests always route to **naga** if it's healthy
2. If kilo becomes unavailable/unhealthy, requests automatically fall back to **synthetic**
4. Once naga recovers and becomes healthy again, requests resume routing to naga

This is particularly useful when you have:
- A preferred provider with guaranteed performance
- Cost-conscious fallbacks (e.g., primary provider is premium, fallbacks are cheaper)
- Specific provider ordering requirements based on business logic

- **`cost`**: Routes to the provider with the lowest configured pricing. Plexus uses a standardized comparison (1000 input tokens + 500 output tokens) to compare costs across providers. Requires pricing configuration on model definitions.

- **`performance`**: Routes to the provider with the highest average throughput (tokens per second). Uses historical performance data collected from actual requests. Falls back to the first target if no performance data exists yet.

  **Performance Exploration:** To prevent the performance selector from permanently favoring a single provider that happens to be faster, Plexus includes an exploration mechanism. With a configurable probability (`performanceExplorationRate`), the selector will randomly choose a different provider instead of the fastest one. This ensures all providers get a chance to demonstrate their performance over time, preventing the system from getting "stuck" on the initially fastest provider.

  The exploration rate is configured globally in the `plexus.yaml` file:

  ```yaml
  performanceExplorationRate: 0.05  # 5% chance to explore
  ```

  - **Default**: `0.05` (5%)
  - **Range**: `0.0` to `1.0` (0% to 100%)
  - **Effect**: Higher values = more exploration (less likely to stick with fastest provider)
  - **Use cases**:
    - `0.0`: Always use fastest provider (no exploration)
    - `0.05`: Default - explore occasionally to ensure fair testing
    - `0.2`: More aggressive exploration for performance testing
    - `0.5`: Randomly explore 50% of the time

- **`latency`**: Routes to the provider with the lowest average time-to-first-token (TTFT). Uses historical latency data from actual requests. Defaults to the first target if all targets have no data.

  **Latency Exploration:** Similar to the performance selector, the latency selector includes an exploration mechanism to prevent it from permanently favoring a single provider with the lowest TTFT. With a configurable probability (`latencyExplorationRate`), the selector will randomly choose a different provider instead of the one with lowest latency. This ensures all providers get a chance to demonstrate their latency characteristics over time.

  The exploration rate is configured globally in the `plexus.yaml` file:

  ```yaml
  latencyExplorationRate: 0.05  # 5% chance to explore
  ```

  - **Default**: Falls back to `performanceExplorationRate` (which defaults to `0.05` or 5%)
  - **Range**: `0.0` to `1.0` (0% to 100%)
  - **Effect**: Higher values = more exploration (less likely to stick with lowest-latency provider)
  - **Use cases**:
    - `0.0`: Always use lowest-latency provider (no exploration)
    - `0.05`: Default - explore occasionally to ensure fair testing
    - `0.2`: More aggressive exploration for latency testing
    - `0.5`: Randomly explore 50% of the time

### `keys`

This section defines the API keys required to access the Plexus gateway inference endpoints (e.g., `/v1/chat/completions`).

- **Key Name**: A unique identifier for the key (e.g., `client-app-1`).
- **`secret`**: The actual bearer token string clients must provide in the `Authorization` header.
- **`comment`**: (Optional) A friendly description or owner name for the key.
- **`quota`**: (Optional) The name of a quota definition from `user_quotas` to enforce for this key. See [User Quota Enforcement](#user-quota-enforcement) for details.

**Example:**

```yaml
keys:
  production-app:
    secret: "sk-plexus-abc-123"
    comment: "Main production application"
  
  testing-key:
    secret: "sk-plexus-test-456"
    comment: "Key for CI/CD tests"
```

Keys are required. Once defined, clients must include the `Authorization: Bearer <secret>` header in their requests. Note that `/v1/models` remains accessible without authentication to support model discovery.

#### Dynamic Key Attribution

Keys support an optional **attribution** label for granular usage tracking without creating dozens of separate keys. This is useful when you want to track usage by application, feature, or user cohort within a single key.

**Format:** `<secret>:<attribution>`

Clients can append a colon and attribution label to the secret. Multiple colons are supported, allowing labels like `team:feature:version`.

**Behavior:**
- The secret part (before the first colon) authenticates the request
- The attribution part (after the first colon) is stored in usage logs for tracking
- Attribution values are normalized to lowercase
- If no attribution is provided, the field remains null
- All variations of the same secret authenticate as the same key

**Example configuration:**

```yaml
keys:
  app-key:
    secret: "sk-plexus-app-abc-123"
    comment: "Main application key"
```

**Usage examples:**

```bash
# Track requests from Copilot feature
curl -H "Authorization: Bearer sk-plexus-app-abc-123:copilot" \
     -H "Content-Type: application/json" \
     -d '{"model":"gpt-4","messages":[]}' \
     http://localhost:3000/v1/chat/completions

# Track requests from Claude feature
curl -H "Authorization: Bearer sk-plexus-app-abc-123:claude" \
     -H "Content-Type: application/json" \
     -d '{"model":"gpt-4","messages":[]}' \
     http://localhost:3000/v1/chat/completions

# Track requests from mobile app v2.5
curl -H "Authorization: Bearer sk-plexus-app-abc-123:mobile:v2.5" \
     -H "Content-Type: application/json" \
     -d '{"model":"gpt-4","messages":[]}' \
     http://localhost:3000/v1/chat/completions

# No attribution (backward compatible)
curl -H "Authorization: Bearer sk-plexus-app-abc-123" \
     -H "Content-Type: application/json" \
     -d '{"model":"gpt-4","messages":[]}' \
     http://localhost:3000/v1/chat/completions
```

**Query usage logs by attribution:**

```sql
-- View all requests grouped by attribution
SELECT api_key, attribution, COUNT(*) as request_count, SUM(tokens_input) as total_input_tokens
FROM request_usage
WHERE api_key = 'app-key'
GROUP BY attribution
ORDER BY request_count DESC;

-- View specific attribution's usage
SELECT request_id, date, attribution, tokens_input, tokens_output, cost_total
FROM request_usage
WHERE api_key = 'app-key' AND attribution = 'copilot'
ORDER BY date DESC
LIMIT 100;
```

This approach allows you to:
- Track usage by feature without managing multiple keys
- Simplify API key rotation (one key per application instead of many)
- Maintain security without exposing separate secrets
- Enable fine-grained usage analytics and cost allocation

### MCP Servers (Optional)

Plexus can act as a proxy for MCP (Model Context Protocol) servers. This allows you to expose remote MCP servers through Plexus with API key authentication.

**Configuration Fields:**

- **`upstream_url`**: (Required) The full URL of the MCP server endpoint. Supports both HTTP and HTTPS.
- **`enabled`**: (Optional) Whether this MCP server is active. Defaults to `true`.
- **`headers`**: (Optional) Static headers to include in every request to the upstream MCP server. Useful for authentication.

**Example:**

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

**Endpoint Access:**

MCP servers are exposed at `/mcp/:name` where `:name` is the key from your configuration:

- `POST /mcp/:name` - JSON-RPC messages
- `GET /mcp/:name` - Server-Sent Events (SSE) for streaming
- `DELETE /mcp/:name` - Session termination

**Authentication:**

All MCP endpoints require authentication using Plexus API keys via the `Authorization: Bearer <key>` header. Client authentication headers are NOT forwarded to upstream servers - only static headers configured in `plexus.yaml` are used for upstream authentication.

**OAuth Discovery Endpoints:**

Plexus provides OAuth 2.0 discovery endpoints to support MCP clients that expect OAuth flows:

- `GET /.well-known/oauth-authorization-server` - Authorization server metadata
- `GET /.well-known/oauth-protected-resource` - Protected resource metadata  
- `GET /.well-known/openid-configuration` - OpenID Connect configuration
- `POST /register` - Dynamic client registration (returns static response indicating API key auth is used)

These endpoints return metadata indicating that Plexus uses Bearer token authentication (API keys), allowing MCP clients to discover and use API key authentication.

### `adminKey` (Required)
This global setting secures the Admin Dashboard and Management APIs (`/v0/*`). Cannot be configured via UI.

**Example:**
```yaml
adminKey: "my-super-secret-admin-password"

providers:
  ...
```

The `adminKey` acts as a shared secret for administrative access:
1.  **Dashboard Access**: Users will be prompted to enter this key to access the web interface.
2.  **API Access**: Requests to Management APIs (`/v0/*`) must include the header `x-admin-key: <your-key>`.
3.  **Startup Requirement**: The Plexus server will fail to start if this key is missing from the configuration.

### `providers.<provider>.quota_checker` (Optional)

Quota checkers are configured per provider (not in a top-level `quotas` section). Plexus periodically runs each enabled checker and stores results for monitoring and alerting.

**Structure:**

```yaml
providers:
  my-provider:
    api_key: "..."
    api_base_url: https://api.example.com/v1
    quota_checker:
      type: synthetic | naga | nanogpt | openai-codex | claude-code | zai | moonshot | minimax
      enabled: true
      intervalMinutes: 30
      # optional
      # id: custom-checker-id
      # options: {}
```

**Fields:**
- `type` (**required**): checker implementation to use.
- `enabled` (optional, default `true`): enable/disable checker.
- `intervalMinutes` (optional, default `30`): polling interval, minimum `1`.
- `id` (optional): explicit checker ID. Defaults to provider ID.
- `options` (optional): checker-specific options map.

**OAuth restrictions:**
- Providers with `oauth_provider: openai-codex` must use `quota_checker.type: openai-codex`.
- Providers with `oauth_provider: anthropic` must use `quota_checker.type: claude-code`.

**Checker notes:**
- `synthetic`: Synthetic quota checker (`options.apiKey` is derived from provider `api_key` by default).
- `naga`: Naga balance-based checker.
- `nanogpt`: NanoGPT usage checker.
- `openai-codex`: Codex OAuth-backed checker.
- `claude-code`: Claude Code OAuth-backed checker.
- `zai`: ZAI balance-based checker.
- `moonshot`: Moonshot balance-based checker.
- `minimax`: MiniMax balance-based checker (requires `options.groupid` and `options.hertzSession`).

**MiniMax options:**
- `options.groupid` (**required**): MiniMax GroupId appended to `query_balance?GroupId=...`.
- `options.hertzSession` (**required**): value for `HERTZ-SESSION` cookie sent to MiniMax.

Treat `hertzSession` like a password/secret. Do not commit real values to source control.

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

**Quota Monitoring API:**

Once configured, quota data is available via the Management API:
- `GET /v0/management/quotas` - List all quota checkers and their latest status
- `GET /v0/management/quotas/:checkerId` - Get latest quota for a specific checker
- `GET /v0/management/quotas/:checkerId/history` - Get historical quota data
- `POST /v0/management/quotas/:checkerId/check` - Trigger an immediate quota check

See the [API Documentation](./API.md#quota-management) for response formats.

### `user_quotas` (Optional)

User quotas enable per-API-key usage enforcement. Unlike provider quota checkers (which monitor provider rate limits), user quotas limit how much an individual API key can consume.

**Key Features:**
- **Per-key enforcement**: Each API key can have its own quota
- **Post-hoc enforcement**: Requests are processed even if they exceed quota; subsequent requests are blocked
- **Rolling or calendar windows**: Leaky bucket (continuous decay) or fixed reset periods
- **Requests or tokens**: Count requests or sum total token usage

**Quota Types:**

| Type | Description | Reset Behavior |
|------|-------------|----------------|
| `rolling` | Leaky bucket algorithm | Continuously "leaks" usage over time based on duration |
| `daily` | Calendar day quota | Resets at UTC midnight every day |
| `weekly` | Calendar week quota | Resets at UTC midnight on Sunday |

**Limit Types:**

- `requests`: Count each API call as 1 unit
- `tokens`: Sum input + output + reasoning + cached tokens

**Configuration Fields:**

```yaml
user_quotas:
  <quota-name>:
    type: rolling | daily | weekly
    limitType: requests | tokens
    limit: <number>
    duration: <duration-string>  # Only for rolling type
```

- **`type`** (required): `rolling`, `daily`, or `weekly`
- **`limitType`** (required): `requests` or `tokens`
- **`limit`** (required): Maximum allowed usage
- **`duration`** (required for `rolling`): Duration string like `1h`, `30m`, `1d`, `5h30m`

**Duration Formats:**
- `30s` - 30 seconds
- `5m` - 5 minutes
- `1h` - 1 hour
- `2h30m` - 2 hours 30 minutes
- `1d` - 1 day

**Examples:**

```yaml
user_quotas:
  # Rolling token quota - 100k tokens per hour
  premium_hourly:
    type: rolling
    limitType: tokens
    limit: 100000
    duration: 1h

  # Rolling request quota - 10 requests per 5 minutes
  burst_limited:
    type: rolling
    limitType: requests
    limit: 10
    duration: 5m

  # Daily request quota - 1000 requests per day
  basic_daily:
    type: daily
    limitType: requests
    limit: 1000

  # Weekly token quota - 5M tokens per week
  enterprise_weekly:
    type: weekly
    limitType: tokens
    limit: 5000000
```

**Assigning Quotas to Keys:**

```yaml
keys:
  acme_corp:
    secret: "sk-acme-secret"
    comment: "Acme Corp - Premium Plan"
    quota: premium_hourly

  dev_team:
    secret: "sk-dev-secret"
    comment: "Development team"
    quota: burst_limited

  free_user:
    secret: "sk-free-secret"
    quota: basic_daily

  unlimited:
    secret: "sk-unlimited"
    comment: "Internal testing - no quota"
    # No quota field = unlimited access
```

**How Rolling (Leaky Bucket) Quotas Work:**

Rolling quotas use a "leaky bucket" algorithm where usage continuously decays over time:

1. **Usage is recorded** after each request completes
2. **On the next request**, usage "leaks" based on time elapsed:
   - `leaked = elapsed_time * (limit / duration)`
   - `current_usage = max(0, current_usage - leaked)`
3. **New usage is added** to the remaining amount

**Example:**
- Quota: 10 requests per hour
- You make 10 requests at 12:00 PM → `current_usage = 10`
- At 12:30 PM (30 min later), you make another request:
  - 50% of the hour elapsed → 5 requests "leaked"
  - `current_usage = max(0, 10 - 5) = 5`
  - New request adds 1 → `current_usage = 6`

**Note:** Even for `requests` quotas, the current usage value stored in the database may be fractional due to the leak calculation. This is expected behavior.

**Quota Change Detection:**

If you change a quota's `limitType` (e.g., from `requests` to `tokens`) or assign a key to a different quota, Plexus automatically detects this and resets usage to zero. The database stores the quota name and limit type to detect changes.

**Admin API:**

Manage user quotas via the Management API:
- `GET /v0/management/quota/status/:key` - Check quota status for a key
- `POST /v0/management/quota/clear` - Reset quota usage to zero

See the [API Documentation](./API.md#user-quota-enforcement-api) for details.

### `cooldown` (Optional)

The cooldown section configures the **escalating cooldown system** that temporarily removes unhealthy providers from the routing pool. When a provider encounters an error, it enters a cooldown period calculated using exponential backoff.

**How It Works:**

When a provider fails (except for non-retryable client errors like 400, 413, 422), the cooldown duration is calculated as:

```
C(n) = min(C_max, C_0 × 2^n)
```

Where:
- `n` = consecutive failures (0-indexed, so first failure is n=0)
- `C_0` = initial cooldown in minutes
- `C_max` = maximum cooldown in minutes

**Progression Example (with defaults):**

| Failure # | Duration |
|-----------|----------|
| 1st | 2 minutes |
| 2nd | 4 minutes |
| 3rd | 8 minutes |
| 4th | 16 minutes |
| 5th | 32 minutes |
| 6th | 64 minutes |
| 7th | 128 minutes |
| 8th | 256 minutes |
| 9th+ | 300 minutes (cap) |

**Key Behaviors:**
- **Success resets**: Any successful request resets the consecutive failure count to 0
- **413 handling**: Payload Too Large errors do NOT trigger cooldowns (client-side error)
- **Per-target tracking**: Each provider+model combination tracks failures independently
- **Persistence**: Cooldowns are persisted to the database and survive restarts

**Configuration Fields:**

```yaml
cooldown:
  initialMinutes: 2      # Initial cooldown duration in minutes (default: 2)
  maxMinutes: 300      # Maximum cooldown duration in minutes (default: 300 = 5 hours)
```

- **`initialMinutes`** (optional): Duration for the first failure. Each subsequent failure doubles this value until the max is reached.
- **`maxMinutes`** (optional): Hard cap on cooldown duration. Prevents cooldowns from becoming effectively permanent.

**Example Configuration:**

```yaml
# Use defaults (2 min initial, 5 hour max)
cooldown:
  initialMinutes: 2
  maxMinutes: 300
```

```yaml
# More aggressive cooldowns (1 min initial, 1 hour max)
cooldown:
  initialMinutes: 1
  maxMinutes: 60
```

```yaml
# Conservative cooldowns (5 min initial, 24 hour max)
cooldown:
  initialMinutes: 5
  maxMinutes: 1440
```

**Management API:**

Once configured, cooldown data is available via the Management API:
- `GET /v0/management/cooldowns` - List all active cooldowns with remaining time
- `DELETE /v0/management/cooldowns` - Clear all cooldowns
- `DELETE /v0/management/cooldowns/:provider?model=:model` - Clear specific provider/model cooldown

See the [API Documentation](./API.md#cooldown-management) for response formats.

## Token Estimation

Some AI providers (particularly free-tier models on OpenRouter and similar platforms) don't return usage data in their responses. This makes it difficult to track token consumption and calculate costs accurately.

Plexus includes an **automatic token estimation feature** that reconstructs response content and estimates token counts using a character-based heuristic algorithm when providers don't return usage data.

### How It Works

When `estimateTokens: true` is enabled for a provider:

1. **Ephemeral Debug Capture**: Plexus temporarily enables debug mode for that specific request to capture the full response stream without persisting debug logs to the database.

2. **Response Reconstruction**: The complete response is reconstructed from the streaming chunks using the existing debug inspector infrastructure.

3. **Token Estimation**: A sophisticated character-based algorithm analyzes the reconstructed content to estimate token counts:
   - **Input tokens**: Estimated from the original request payload (messages, system prompts, tools, etc.)
   - **Output tokens**: Estimated from the reconstructed response content
   - **Reasoning tokens**: Estimated from extended thinking blocks (for models like o1/o3)

4. **Automatic Cleanup**: Debug data is immediately discarded after estimation—nothing is saved to disk.

5. **Database Flag**: Usage records include a `tokensEstimated` field to distinguish estimated vs. actual token counts.

### Estimation Algorithm

The estimation algorithm uses a character-based heuristic that accounts for:

- **Whitespace density**: More whitespace generally means fewer tokens
- **Code patterns**: Code blocks and structured data have different token densities
- **JSON structures**: Keys, values, and formatting affect token counts
- **URLs and paths**: Long URLs are typically fewer tokens than their character count suggests
- **Special characters**: Punctuation and symbols impact tokenization

**Baseline formula**: `tokens ≈ characters / 3.8`

The algorithm dynamically adjusts this ratio based on content analysis to provide more accurate estimates.

### Configuration

Enable token estimation in your provider configuration:

```yaml
providers:
  openrouter-free:
    api_base_url: https://openrouter.ai/api/v1
    api_key: ${OPENROUTER_API_KEY}
    estimateTokens: true  # Enable estimation for this provider
    models:
      - meta-llama/llama-3.2-3b-instruct:free
      - google/gemma-2-9b-it:free
```

You can also enable it through the Admin UI:
1. Navigate to **Providers** in the dashboard
2. Edit the provider configuration
3. Enable the **"Estimate Tokens"** toggle in Advanced Configuration
4. Save the provider

### When to Use Token Estimation

**Use token estimation when:**
- Provider doesn't return usage data (common with free-tier models)
- You need cost tracking and usage analytics
- You want to monitor token consumption trends

**Don't use token estimation when:**
- Provider returns accurate usage data (estimation adds overhead)
- You need exact token counts for billing purposes
- Performance is critical (estimation requires response reconstruction)

### Accuracy

Token estimation provides **approximate** token counts that are typically within **±15%** of actual values. The accuracy varies based on:

- **Content type**: Plain text is more accurate than code or JSON
- **Language**: English text is most accurate
- **Model**: Different models use different tokenizers

Estimated counts are sufficient for:
- Usage monitoring and trending
- Cost approximation
- Capacity planning
- Rate limiting decisions

For precise billing or quota enforcement, use providers that return actual usage data.

### Performance Impact

Token estimation has minimal performance impact:
- **Response reconstruction**: Uses existing debug inspector infrastructure (no additional parsing)
- **Estimation algorithm**: Lightweight character analysis (~1ms per request)
- **Memory**: Ephemeral capture is immediately discarded after estimation

The primary overhead is from temporarily buffering the response for reconstruction, which is negligible for typical response sizes.

### Database Schema

Usage records include a `tokens_estimated` field (integer, default: 0):

```sql
CREATE TABLE request_usage (
  -- ... other fields ...
  tokens_input INTEGER,
  tokens_output INTEGER,
  tokens_reasoning INTEGER,
  tokens_cached INTEGER,
  tokens_estimated INTEGER NOT NULL DEFAULT 0,  -- 0 = actual, 1 = estimated
  -- ... other fields ...
);
```

Query estimated vs. actual usage:

```sql
-- Count estimated vs. actual token records
SELECT 
  CASE 
    WHEN tokens_estimated = 1 THEN 'Estimated' 
    ELSE 'Actual' 
  END as token_source,
  COUNT(*) as record_count,
  SUM(tokens_input) as total_input_tokens,
  SUM(tokens_output) as total_output_tokens
FROM request_usage
GROUP BY token_source;

-- Find providers using estimation
SELECT provider, COUNT(*) as estimated_records
FROM request_usage
WHERE tokens_estimated = 1
GROUP BY provider
ORDER BY estimated_records DESC;
```

### Logging

When estimation occurs, Plexus logs at `info` level:

```
[INFO] Estimated tokens for request abc-123: input=1234, output=5678, reasoning=0
```

This helps you monitor which requests are using estimation and verify the feature is working correctly.
