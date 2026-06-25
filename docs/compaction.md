# Context Compaction

## What it is

Context compaction is an opt-in feature that automatically reduces conversation context before the upstream model send, to fit large requests under the model's context window. Compaction operates on the **request side only** (responses are never modified).

**Applies to inference-v2 / `/beta/` routes only.** The legacy `/v1/...` Dispatcher path is unaffected.

---

## Strategies

### `native` (default)

Deterministic structural compaction. Truncates verbose JSON arrays and long tool-result / log text blocks, while protecting:
- The system prompt (never compacted)
- The most recent N messages (configurable via `protectRecent`)

Configured via the `native` sub-object (`maxArrayItems`, `maxStringChars`).

### `headroom`

Delegates compaction to a self-hosted [headroom](https://github.com/chopratejas/headroom) proxy via the `headroom-ai` SDK's compress endpoint. Configured via the `headroom` sub-object (`baseUrl`, `apiKey`, `targetRatio`, `timeoutMs`).

> **v1 caveat:** the `headroom` strategy maps the context through OpenAI chat format, which has no representation for assistant **thinking** blocks — so thinking content (and its signatures) is dropped from compacted messages. For Anthropic extended-thinking models used with tools, prefer the `native` strategy (which preserves thinking) until this is addressed. `native` is the default.

---

## Settings & Precedence

Settings resolve in order: **alias > provider > global > default**. Nested `native`/`headroom` objects merge field-by-field (each field inherits independently).

| Field | Default | Description |
|---|---|---|
| `enabled` | `false` | Enable/disable compaction |
| `strategy` | `"native"` | `"native"` or `"headroom"` |
| `triggerRatio` | `0.8` | Fraction of `context_length`; compaction fires when estimated tokens ≥ this ratio × context window |
| `absoluteTriggerTokens` | _(unset)_ | Fallback trigger when context_length is unknown; must be ≥ 1 if set |
| `minTokens` | `2000` | Never compact if estimated input tokens is below this value |
| `protectRecent` | `4` | Number of recent messages to keep verbatim (never compacted) |
| `native.maxArrayItems` | _(strategy default)_ | Maximum items retained in JSON arrays during native compaction |
| `native.maxStringChars` | _(strategy default)_ | Maximum characters retained in long strings during native compaction |
| `headroom.baseUrl` | `"http://localhost:8787"` | URL of the headroom proxy or hosted endpoint |
| `headroom.apiKey` | _(unset)_ | API key for a hosted headroom endpoint |
| `headroom.targetRatio` | _(strategy default)_ | Target compression ratio passed to headroom |
| `headroom.timeoutMs` | _(strategy default)_ | Timeout in ms for the headroom compress call |

---

## Trigger (safety-net)

Compaction fires only when **all** of the following hold:

1. `enabled: true` in the resolved config
2. Estimated input tokens ≥ `triggerRatio × context_length` **or** ≥ `absoluteTriggerTokens` (when context_length is unknown)
3. Estimated input tokens ≥ `minTokens`

Conservative defaults mean only large requests trigger compaction.

---

## Guards

- **Fail-open:** any strategy error or timeout leaves the original context unchanged — the request proceeds as if compaction was not configured.
- **Validation guard:** if the post-compaction token estimate did not drop below the pre-compaction estimate, the original context is used instead.
- **System prompt protection:** the system prompt is never compacted in native strategy v1.
- **Request-side only:** the model response is never altered.

---

## Composition with `enforce_limits`

If an alias also has `enforce_limits` configured, the processing order is **compact → enforce**. Compaction runs first and can rescue a borderline-oversized request; enforcement then validates the (now-reduced) context. This means compaction can prevent a 400 rejection that would have occurred without it.

---

## Configuring

### Via the UI

Open **Settings → Config → Context Compaction**. Global defaults are set here; per-provider and per-alias overrides are available in their respective editor panels. An empty field inherits from the parent level.

### Via the API

```
PATCH /v0/management/config/compaction
Content-Type: application/json

{
  "enabled": true,
  "strategy": "native",
  "triggerRatio": 0.8,
  "minTokens": 2000,
  "protectRecent": 4
}
```

Per-alias or per-provider overrides use the same field names in the alias/provider config objects.

> The global `PATCH` shallow-merges over the stored config, so nested objects (`native`, `headroom`) are **replaced wholesale** — send the complete sub-object when changing one of its fields. (The Config UI always sends the full object.)

---

## Self-Hosted Headroom Setup

1. Run a headroom proxy: `headroom proxy` (default listens on `http://localhost:8787`).
2. Set the global strategy to `"headroom"` and point `headroom.baseUrl` at the proxy:
   ```json
   {
     "strategy": "headroom",
     "headroom": { "baseUrl": "http://localhost:8787" }
   }
   ```
3. For a **hosted** headroom endpoint: set `headroom.baseUrl` to the hosted URL and provide `headroom.apiKey`.

If the headroom proxy is unreachable, all requests still succeed via fail-open — no compaction occurs and a warning is logged.

---

## Observability

### Response headers (non-streaming)

When compaction fires on a non-streaming `/beta/` request, three response headers are set:

| Header | Value |
|---|---|
| `x-plexus-compaction-strategy` | The strategy that ran (`"native"` or `"headroom"`), or empty if strategy was null |
| `x-plexus-compaction-tokens-before` | Estimated input token count before compaction |
| `x-plexus-compaction-tokens-after` | Estimated input token count after compaction |

These headers are absent when compaction did not fire (not enabled, below threshold, or failed-open).

### Streaming

SSE headers are pre-flushed before the stream starts, so compaction headers cannot be appended. Compaction activity for streaming requests is observable via the backend log line:

```
[compaction] strategy=native tokensBefore=45000 tokensAfter=28000
```

### Usage records

The provider-reported `tokensInput` in usage records already reflects the compacted input (what was actually sent upstream). Dedicated compaction usage columns (e.g. original vs. compacted counts) are planned as a follow-up.
