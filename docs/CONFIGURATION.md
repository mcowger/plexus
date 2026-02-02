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

