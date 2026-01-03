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

### Configuration Sections

#### `providers`
This section defines the upstream AI services you want to connect to.

- **`type`**: The transformer type to use. Supported types include:
    - `OpenAI`
    - `Anthropic`
    - `Gemini`
    - *Note: If the incoming request format (e.g., OpenAI) matches the provider type, Plexus automatically uses **Pass-through Optimization** to minimize latency.*
- **`api_base_url`**: The root URL for the provider's API.
- **`api_key`**: Your authentication token.
- **`discount`**: (Optional) A number between 0 and 1 representing the discount to apply to all models under this provider (e.g., `0.1` for 10% off). This can be overridden by model-specific discounts.
- **`models`**: A list of raw model identifiers available from this specific provider.
    - Can be a simple list of strings: `["model-a", "model-b"]`
    - Or a map for detailed configuration (e.g., pricing):
      ```yaml
      models:
        gpt-4o:
          pricing:
            source: simple
            input: 2.50
            output: 10.00
      ```
- **`headers`**: (Optional) Extra headers to send with every request to this provider (useful for custom gateways or organization IDs).

### Pricing Configuration

You can define pricing for each model within the `providers` configuration. This allows Plexus to track and calculate estimated costs for your usage.

**Schema:**

Pricing is defined under the `pricing` key for a specific model.

1.  **Simple Pricing** (`source: simple`)
    -   `input`: Cost per 1 million input tokens.
    -   `output`: Cost per 1 million output tokens.
    -   `cached`: (Optional) Cost per 1 million cached input tokens.

    ```yaml
    pricing:
      source: simple
      input: 5.00
      output: 15.00
    ```

2.  **OpenRouter Pricing** (`source: openrouter`)
    -   `slug`: The specific OpenRouter model identifier (e.g., `openai/gpt-4o`, `anthropic/claude-3-opus`).
    -   `discount`: (Optional) A number between 0 and 1 representing the discount to apply (e.g., `0.1` for a 10% discount).
    -   *Note: Plexus automatically fetches the latest pricing data from the OpenRouter API on startup and uses it for cost calculations. This ensures your tracked costs stay up-to-date with public rates without manual configuration.*

    ```yaml
    pricing:
      source: openrouter
      slug: openai/gpt-4o
      discount: 0.1
    ```

3.  **Defined (Tiered/Range) Pricing** (`source: defined`)
    -   `range`: An array of pricing tiers based on input token usage.
    -   `lower_bound`: (Optional, default 0) Minimum input tokens for this tier (inclusive).
    -   `upper_bound`: (Optional, default Infinity) Maximum input tokens for this tier (inclusive). Use `.inf` for Infinity in YAML.
    -   `input_per_m`: Cost per 1 million input tokens in this tier.
    -   `output_per_m`: Cost per 1 million output tokens in this tier.

    ```yaml
    pricing:
      source: defined
      range:
        # First 1M tokens
        - lower_bound: 0
          upper_bound: 1000000
          input_per_m: 5.00
          output_per_m: 15.00
        # Anything above 1M tokens
        - lower_bound: 1000001
          upper_bound: .inf
          input_per_m: 4.00
          output_per_m: 12.00
    ```

#### `models`
This section defines the "virtual" models or aliases that clients will use when making requests to Plexus.

- **Model Alias**: The key (e.g., `fast-model`, `gpt-4-turbo`) is the name clients send in the `model` field of their API request.
- **`selector`**: (Optional) The strategy to use for target selection when multiple targets are defined.
    - `random`: (Default) Randomly selects a target.
    - `cost`: Selects the target with the lowest estimated cost based on simulated token usage.
    - `latency`: (Not yet implemented) Will select based on lowest latency.
    - `usage`: (Not yet implemented) Will select based on usage patterns.
- **`targets`**: A list of provider/model pairs that back this alias.
    - `provider`: Must match a key defined in the `providers` section.
    - `model`: The specific model name to use on that provider.

#### `keys`
This section defines the API keys required to access the Plexus gateway inference endpoints (e.g., `/v1/chat/completions`).

- **Key Name**: A unique identifier for the key (e.g., `client-app-1`).
- **`secret`**: The actual bearer token string clients must provide in the `Authorization` header.
- **`comment`**: (Optional) A friendly description or owner name for the key.

keys:
  production-app:
    secret: "sk-plexus-abc-123"
    comment: "Main production application"
  
  testing-key:
    secret: "sk-plexus-test-456"
    comment: "Key for CI/CD tests"

Once keys are defined, clients must include the `Authorization: Bearer <secret>` header in their requests. Note that `/v1/models` remains accessible without authentication to support model discovery.

#### `adminKey` (Required)
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

