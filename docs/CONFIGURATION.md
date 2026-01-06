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
  
  Note: While Gemini can technically be included in multi-protocol arrays, it's typically configured as a single-protocol provider due to its unique API requirements.
  
- **`display_name`**: (Optional) A friendly name shown in logs and the dashboard.

- **`api_base_url`**: The base URL for the provider's API. Can be:
  - A single URL string for single-protocol providers
  - An object mapping API types to specific URLs for multi-protocol providers
  
- **`api_key`**: (Optional) The authentication key for this provider.

- **`enabled`**: (Optional, default: `true`) Set to `false` to temporarily disable a provider.

- **`models`**: The models available from this provider. Can be:
  - An array of model name strings: `["model-a", "model-b"]`
  - An object mapping model names to configuration (for pricing or API access control)

- **`headers`**: (Optional) Custom HTTP headers to include in every request to this provider.

- **`extraBody`**: (Optional) Additional fields to merge into every request body.

- **`discount`**: (Optional) A percentage discount (0.0-1.0) to apply to all pricing for this provider.

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

- **`additional_aliases`**: (Optional) A list of alternative names that should also route to this model configuration.

- **`selector`**: (Optional) The strategy to use for target selection when multiple targets are available:
  - `random`: (Default) Randomly selects a healthy target
  - `cost`: Routes to the lowest-cost healthy provider
  - `performance`: Routes to the highest tokens-per-second provider
  - `latency`: Routes to the lowest time-to-first-token provider

- **`priority`**: (Optional) Determines the routing lifecycle order:
  - `selector` (Default): Choose a provider using the selector strategy, then use the best available API format for that provider
  - `api_match`: Filter for native API compatibility first, then apply the selector. If no providers match the incoming API type, falls back to any viable provider selected by the selector
  
  Use `api_match` when you want maximum compatibility with the incoming request format, even if it means fewer provider options. This is especially useful for:
  - Tools that rely on specific API features (e.g., Claude Code with Anthropic messages)
  - Maximizing pass-through optimization for better performance
  - Ensuring high-fidelity protocol translation

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

Once keys are defined, clients must include the `Authorization: Bearer <secret>` header in their requests. Note that `/v1/models` remains accessible without authentication to support model discovery.

### `adminKey` (Required)
This global setting secures the Admin Dashboard and Management APIs (`/v0/*`).

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

