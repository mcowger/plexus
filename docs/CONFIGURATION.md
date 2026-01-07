# Configuration

Plexus is configured via a `config/plexus.yaml` file. This file defines your providers, model routing logic, and global settings.

## Configuration File (`plexus.yaml`)

The configuration file is YAML-based and sits at the heart of how Plexus routes and transforms requests.

### Example Configuration

```yaml
providers:
  openai_direct:
    type: chat
    api_base_url: https://api.openai.com/v1
    api_key: your_openai_key
    models:
      - gpt-4o
      - gpt-4o-mini
      
  my_anthropic:
    type: messages
    api_base_url: https://api.anthropic.com/v1
    api_key: your_anthropic_key
    models:
      - claude-3-5-sonnet-latest

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
```

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

- **`type`**: The API format(s) supported by this provider. Can be:
  - A single string: `"chat"`, `"messages"`, or `"gemini"`
  - An array for multi-protocol providers: `["chat", "messages"]`
  
- **`display_name`**: (Optional) A friendly name shown in logs and the dashboard.

- **`api_base_url`**: The base URL for the provider's API. Can be:
  - A single URL string for single-protocol providers
  - An object mapping API types to specific URLs for multi-protocol providers
  
- **`api_key`**: (Optional) The authentication key for this provider. Required unless `oauth_provider` is specified.

- **`oauth_provider`**: (Optional) The OAuth provider to use for authentication instead of a static API key. Currently supported: `"antigravity"`. When specified, Plexus will use OAuth 2.0 tokens for authentication.

- **`enabled`**: (Optional, default: `true`) Set to `false` to temporarily disable a provider.

- **`models`**: The models available from this provider. Can be:
  - An array of model name strings: `["model-a", "model-b"]`
  - An object mapping model names to configuration (for pricing or API access control)

- **`headers`**: (Optional) Custom HTTP headers to include in every request to this provider.

- **`extraBody`**: (Optional) Additional fields to merge into every request body.

- **`discount`**: (Optional) A percentage discount (0.0-1.0) to apply to all pricing for this provider. Often used if you want to base your pricing on public numbers but apply a global discount.

- **`force_transformer`**: (Optional) Override the transformer used for this provider regardless of the API type. Useful when a provider uses a compatible API format but requires custom endpoint handling. For example, Antigravity uses the Gemini API format but requires a different transformer for its specific endpoints.

**Multi-Protocol Provider Configuration:**

For providers that support multiple API endpoints (e.g., both OpenAI chat completions and Anthropic messages), you can configure them as follows:

```yaml
providers:
  synthetic:
    # Declare multiple supported API types
    type: ["chat", "messages"]
    display_name: Synthetic Provider
    
    # Map each API type to its specific base URL
    api_base_url:
      chat: https://api.synthetic.new/openai/v1
      messages: https://api.synthetic.new/messages/v1
    
    api_key: "your-synthetic-key"
    
    models:
      # Specify which APIs each model supports
      "hf:MiniMaxAI/MiniMax-M2.1":
        access_via: ["chat", "messages"]
      
      # Models can be restricted to specific APIs
      "legacy-model":
        access_via: ["messages"]
```

When using multi-protocol providers with API priority matching (`priority: api_match` in model configuration), Plexus will automatically filter for providers that natively support the incoming API type, maximizing compatibility and enabling pass-through optimization.

**Single-Protocol Provider Example:**

```yaml
providers:
  openai:
    type: chat
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

- **`additional_aliases`**: (Optional) A list of alternative names that should also route to this model configuration. Can be used for tools like Claude Code that are picky about model names, or clients that have fixed lists of models that you want to remap.

- **`selector`**: (Optional) The strategy to use for target selection when multiple targets are available:
  - `random`: (Default) Randomly selects a healthy target
  - `in_order`: Selects providers in the order defined, falling back to the next if the current one is unhealthy
  - `cost`: Routes to the lowest-cost healthy provider
  - `performance`: Routes to the highest tokens-per-second provider
  - `latency`: Routes to the lowest time-to-first-token provider

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
      - provider: kilo
        model: minimax/minimax-m2.1
      - provider: naga
        model: minimax-m2.1
      - provider: synthetic
        model: "hf:MiniMaxAI/MiniMax-M2.1"
```

With this configuration:
1. Requests always route to **kilo** if it's healthy
2. If kilo becomes unavailable/unhealthy, requests automatically fall back to **naga**
3. If naga is also unavailable, requests route to **synthetic**
4. Once kilo recovers and becomes healthy again, requests resume routing to kilo

This is particularly useful when you have:
- A preferred provider with guaranteed performance
- Cost-conscious fallbacks (e.g., primary provider is premium, fallbacks are cheaper)
- Specific provider ordering requirements based on business logic

- **`cost`**: Routes to the provider with the lowest configured pricing. Plexus uses a standardized comparison (1000 input tokens + 500 output tokens) to compare costs across providers. Requires pricing configuration on model definitions.

- **`performance`**: Routes to the provider with the highest average throughput (tokens per second). Uses historical performance data collected from actual requests. Falls back to the first target if no performance data exists yet.

- **`latency`**: Routes to the provider with the lowest average time-to-first-token (TTFT). Uses historical latency data from actual requests. Defaults to the first target if all targets have no data.

### `keys`

This section defines the API keys required to access the Plexus gateway inference endpoints (e.g., `/v1/chat/completions`).

- **Key Name**: A unique identifier for the key (e.g., `client-app-1`).
- **`secret`**: The actual bearer token string clients must provide in the `Authorization` header.
- **`comment`**: (Optional) A friendly description or owner name for the key.

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

---

## OAuth Authentication

Plexus supports OAuth 2.0 authentication for providers like Google Antigravity and Anthropic Claude Code. Instead of using a static API key, OAuth allows Plexus to obtain and automatically refresh access tokens on your behalf.

### Configuring an OAuth Provider

To use OAuth authentication, specify `oauth_provider` instead of `api_key` in your provider configuration.

#### Google Antigravity

For Antigravity, use `type: gemini` for API compatibility (so models with `access_via: ["gemini"]` will work) and `force_transformer: antigravity` to use the Antigravity-specific endpoint transformer:

```yaml
providers:
  antigravity:
    type: gemini                              # Use gemini for API compatibility
    force_transformer: antigravity            # But use Antigravity transformer for endpoints
    display_name: Google Antigravity
    api_base_url: https://cloudcode-pa.googleapis.com
    oauth_provider: antigravity
    oauth_account_pool:                       # List authenticated account emails
      - your-email@gmail.com
    models:
      claude-opus-4.5:                        # Example model mapping
        pricing:
          source: openrouter
          slug: anthropic/claude-opus-4.5
        access_via: ["gemini"]                # Works because type is gemini
      gemini-2.0-flash-thinking-exp-01-21:
        access_via: ["gemini"]
```

This configuration allows models to use `access_via: ["gemini"]` for API compatibility matching, while the `force_transformer: antigravity` ensures the correct Antigravity-specific endpoints are used.

#### Anthropic Claude Code

For Claude Code OAuth, use `type: messages` for the standard Anthropic Messages API:

```yaml
providers:
  my-claude-code:
    type: messages
    display_name: Claude Code OAuth
    api_base_url: https://api.anthropic.com/v1
    oauth_provider: claude-code
    oauth_account_pool:                       # List authenticated account emails
      - your-email@example.com
    models:
      claude-sonnet-4-5:
        pricing:
          source: simple
          input: 0.003
          output: 0.015
        access_via: [messages]
      claude-opus-4-5:
        pricing:
          source: simple
          input: 0.015
          output: 0.075
        access_via: [messages]
```

**⚠️ Important: Port 54545 Requirement**

Claude Code OAuth requires a special callback server on **port 54545** for OAuth callbacks. This server automatically starts when Plexus boots and must remain running during the OAuth flow.

- **Port must be available**: Ensure port 54545 is not in use by another application
- **Automatic startup**: The callback server starts automatically with Plexus
- **Same binding as Plexus**: The server binds to `0.0.0.0` (all interfaces), just like the main Plexus server
- **Network accessibility**: If Plexus is accessible remotely, port 54545 must also be accessible from the client browser performing OAuth
- **Firewall configuration**: If you access Plexus remotely, ensure your firewall allows connections to port 54545

If you see an error like `Port 54545 already in use`, stop any other processes using that port before starting Plexus.

**Why port 54545?** Claude's OAuth client configuration hardcodes `http://localhost:54545/callback` as the redirect URI. The callback server receives the OAuth code from Claude, then redirects it to Plexus's main OAuth handler.

### OAuth Environment Variables

OAuth functionality can be configured using environment variables. If not set, the following defaults are used:

- **`EXTERNAL_PLEXUS_URL`**: The external URL used for OAuth callbacks
  - Default: `http://localhost:4000`
  - Used to construct callback URLs during OAuth flow

- **`ANTIGRAVITY_CLIENT_ID`**: Google OAuth client ID for Antigravity
  - Default: `1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com`

- **`ANTIGRAVITY_CLIENT_SECRET`**: Google OAuth client secret for Antigravity
  - Default: `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`

**Example** (if you need to override the defaults):

```bash
export EXTERNAL_PLEXUS_URL=https://plexus.example.com
export ANTIGRAVITY_CLIENT_ID=your-client-id
export ANTIGRAVITY_CLIENT_SECRET=your-client-secret
```

### OAuth Flow

#### Antigravity OAuth Flow

1. **Initiate Authentication**: Visit the OAuth management page in the Plexus UI, or directly access `/v0/oauth/authorize?provider=antigravity`
2. **Google Sign-In**: You'll be redirected to Google to authenticate
3. **Callback**: After authentication, you'll be redirected back to Plexus at `/v0/oauth/callback`
4. **Automatic Refresh**: Plexus will automatically refresh tokens in the background before they expire

#### Claude Code OAuth Flow

1. **Initiate Authentication**: Visit the OAuth management page in the Plexus UI, or send a POST request to `/v0/oauth/claude/authorize`
2. **Claude Sign-In**: You'll be redirected to Claude.ai to authenticate
3. **Loopback Callback**: Claude redirects to `http://localhost:54545/callback` (the loopback server)
4. **Backend Callback**: The loopback server extracts OAuth parameters and redirects to `/v0/oauth/claude/callback`
5. **Automatic Refresh**: Plexus will automatically refresh tokens in the background before they expire (tokens expire after 1 hour, refresh tokens expire after 90 days)

### OAuth Management Endpoints

#### Antigravity Endpoints

- **`GET /v0/oauth/authorize?provider=antigravity`**: Start OAuth flow
- **`GET /v0/oauth/callback`**: OAuth callback endpoint (used by Google)
- **`GET /v0/oauth/status?provider=antigravity`**: Check OAuth status and token expiry
- **`GET /v0/oauth/credentials/grouped`**: Get all OAuth accounts grouped by provider (for UI)
- **`DELETE /v0/oauth/credentials?provider=antigravity&user_identifier=email`**: Remove stored credentials
- **`POST /v0/oauth/refresh`**: Manually trigger token refresh
- **`GET /v0/oauth/refresh/status`**: Check token refresh service status

#### Claude Code Endpoints

- **`POST /v0/oauth/claude/authorize`**: Start Claude Code OAuth flow
- **`GET /v0/oauth/claude/callback`**: OAuth callback endpoint (receives redirect from loopback server)
- **`GET /v0/oauth/claude/accounts`**: Get all Claude Code OAuth accounts
- **`POST /v0/oauth/claude/refresh`**: Manually refresh a specific account's token (requires `email` in request body)
- **`DELETE /v0/oauth/claude/:email`**: Remove stored credentials for a specific account

### Multi-Account Support

Both Antigravity and Claude Code support multiple OAuth accounts through the `oauth_account_pool` configuration. This enables:

- **Load Balancing**: Distribute requests across multiple accounts
- **Per-Account Cooldowns**: When one account hits rate limits, requests automatically route to healthy accounts
- **Account Management**: View and manage all authenticated accounts through the OAuth management UI

**Example with multiple accounts:**

```yaml
providers:
  my-claude-code:
    type: messages
    api_base_url: https://api.anthropic.com/v1
    oauth_provider: claude-code
    oauth_account_pool:
      - alice@example.com
      - bob@example.com
      - charlie@example.com
    models:
      claude-sonnet-4-5:
        access_via: [messages]
```

### Supported OAuth Providers

- **`antigravity`**: Google Antigravity (Code Assist) - Uses Google OAuth with special scopes for accessing Gemini models via the Antigravity API
- **`claude-code`**: Anthropic Claude Code - Uses Anthropic OAuth for accessing Claude models via the Claude API with extended rate limits

