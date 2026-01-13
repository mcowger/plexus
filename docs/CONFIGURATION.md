# Plexus Configuration Guide

Plexus is configured using a YAML file (usually `config/plexus.yaml`). 

## Specifying the Config File
By default, Plexus looks for `config/plexus.yaml` in the current working directory. You can override this in two ways:

1. **Command Line Argument**: Use the `--config` flag when starting the server.
   ```bash
   bun run dev --config ./my-config.yaml
   ```
2. **Environment Variable**: Set the `PLEXUS_CONFIG_PATH` environment variable.
   ```bash
   PLEXUS_CONFIG_PATH=./my-config.yaml bun run dev
   ```

## Top-Level Sections

- [server](#server): Basic server connectivity settings.
- [admin](#admin): Management API authentication and rate limiting.
- [events](#events): SSE event stream settings.
- [logging](#logging): Level, storage, and retention for various log types.
- [providers](#providers): External LLM provider definitions.
- [models](#models): Model aliases and routing targets.
- [apiKeys](#apikeys): Client authentication keys.
- [resilience](#resilience): Cooldown and health thresholds.
- [pricing](#pricing): Token pricing for cost calculation.

---

## server
Basic HTTP server settings.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `host` | string | `0.0.0.0` | Bind address for the server. |
| `port` | number | `4000` | Port for the server to listen on. |

---

## admin
Configuration for the Management API (`/v0/*`).

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `apiKey` | string | **Required** | The secret key required for admin authentication (Bearer token). |
| `rateLimit.windowMs` | number | `60000` | Time window for rate limiting in milliseconds. |
| `rateLimit.maxRequests` | number | `100` | Maximum requests allowed per window. |

---

## events
Settings for the real-time event stream (`/v0/events`).

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `heartbeatIntervalMs` | number | `30000` | Interval for sending keep-alive pings to SSE clients. |
| `maxClients` | number | `10` | Maximum concurrent SSE connections allowed. |

---

## logging
Configures system logging and structured data capture.

### logging (Basic)
| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `level` | string | `info` | Minimum log level (`silly`, `debug`, `info`, `warn`, `error`). |

### logging.usage
| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `true` | Whether to log successful request usage. |
| `storagePath` | string | `./data/logs/usage` | Directory to store usage logs (JSONL). |
| `retentionDays` | number | `30` | Number of days to keep usage logs. |

### logging.debug
| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `false` | Enable detailed request/response trace capture. |
| `captureRequests` | boolean | `true` | Capture raw incoming and outgoing request bodies. |
| `captureResponses` | boolean | `true` | Capture raw provider and client response bodies. |
| `storagePath` | string | `./data/logs/debug` | Directory to store debug traces. |
| `retentionDays` | number | `7` | Retention period for heavy debug data. |

### logging.errors
| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `storagePath` | string | `./data/logs/errors` | Directory to store error logs. |
| `retentionDays` | number | `90` | Retention period for error records. |

---

## providers
A list of external LLM providers.

| Option | Type | Description |
|--------|------|-------------|
| `name` | string | Unique identifier for the provider (used in routing). |
| `enabled` | boolean | Whether the provider is available for routing. |
| `apiTypes` | array | Supported API formats (`chat`, `messages`, `gemini`). |
| `baseUrls` | object | Endpoint URLs for each supported API type. |
| `auth.type` | string | Authentication method (`bearer` or `x-api-key`). |
| `auth.apiKey` | string | The API key. Can be a direct string (e.g., `"sk-..."`) or an environment variable reference (e.g., `"{env:OPENAI_API_KEY}"`). |
| `models` | array | List of model names supported by this provider. |
| `customHeaders` | object | (Optional) Additional headers to send to the provider. |
| `extraBody` | object | (Optional) Additional fields to merge into every request body. |
| `discount` | number | (Optional) Multiplier applied to token costs for this provider (e.g., `0.8` for 20% off). |
| `cooldown` | object | (Optional) Custom cooldown duration overrides in seconds for this provider. |

---

## models
Definitions for virtual model aliases and their routing strategies.

| Option | Type | Description |
|--------|------|-------------|
| `alias` | string | The client-facing model name (e.g., `smart`, `fast`). |
| `description` | string | (Optional) Text description of the model. |
| `additionalAliases` | array | (Optional) Other names that map to this same config. |
| `selector` | string | Strategy for choosing a target (`random`, `in_order`, `cost`, `latency`, `performance`). |
| `apiMatch` | boolean | (Optional) If true, only targets matching the client's API type are considered. |
| `targets` | array | List of concrete provider/model pairs.

### Model Aliasing

Aliases map a virtual model name to one or more targets. They are defined in the `models` list.

**Passthrough Resolution:**
You can also request a model using the `provider_name/model_name` format (e.g., `openai/gpt-4o`).
*   **Behavior**: This bypasses the alias selector, cooldown checks, and health checks.
*   **Requirements**: The provider must be enabled, and the model must be present in the provider's `models` list.
*   **Use Case**: Testing specific providers or accessing models without defining an explicit alias.

```yaml
models:
  - alias: "gpt-4"
    targets:
``` |

### targets entry
| Option | Type | Description |
|--------|------|-------------|
| `provider` | string | Name of the provider (must match an entry in `providers`). |
| `model` | string | Name of the model on the provider. |
| `weight` | number | (Optional) Relative weight for `random` selection. |

---

## apiKeys
Keys used by clients to authenticate with Plexus.

| Option | Type | Description |
|--------|------|-------------|
| `name` | string | A descriptive name for the key (used in logging/attribution). |
| `secret` | string | The actual token used in the `Authorization: Bearer <secret>` header. |
| `enabled` | boolean | Whether this key is currently active. |

---

## resilience
Settings for system robustness and failover.

### resilience.cooldown
| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `maxDuration` | number | `3600` | Maximum cooldown period in seconds. |
| `minDuration` | number | `5` | Minimum cooldown period in seconds. |
| `storagePath` | string | `./data/cooldowns.json` | Path to the persistent cooldown state file. |
| `defaults` | object | | Default cooldown seconds for various error types (`rate_limit`, `auth_error`, `timeout`, `server_error`, `connection_error`). |

### resilience.health
| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `degradedThreshold` | number | `0.5` | Ratio of unhealthy providers that triggers "degraded" status. |
| `unhealthyThreshold` | number | `0.9` | Ratio of unhealthy providers that triggers "unhealthy" status. |

---

## pricing
Configuration for token-based cost accounting.

| Option | Type | Description |
|--------|------|-------------|
| `models` | object | Map of model names to [SimplePricing](#simplepricing) objects. |
| `tiered` | object | Map of model names to arrays of [TieredPricing](#tieredpricing) objects. |
| `discounts` | object | Map of provider names to discount multipliers. |
| `openrouter.enabled`| boolean | Enable dynamic pricing fetching from OpenRouter. |
| `openrouter.cacheRefreshMinutes` | number | How often to refresh OpenRouter pricing data. |

### SimplePricing
| Option | Type | Description |
|--------|------|-------------|
| `inputPer1M` | number | USD cost per 1 million input tokens. |
| `outputPer1M` | number | USD cost per 1 million output tokens. |
| `cachedPer1M` | number | (Optional) USD cost per 1 million cached input tokens. |
| `reasoningPer1M` | number | (Optional) USD cost per 1 million reasoning tokens. |

### TieredPricing
| Option | Type | Description |
|--------|------|-------------|
| `maxInputTokens` | number | Upper bound of input tokens for this tier. |
| `inputPer1M` | number | Cost in this tier. |
| `outputPer1M` | number | Cost in this tier. |
