# DESIGN.md — Plexus pi-ai Native Transformation

**Status:** Living design document — update as stages are implemented.

> **Note on the proof-of-concept.** Branch `feat/piai-parallel-chat-completions-inference-path` contains a working PoC of Stage 1 (`/beta/v1/chat/completions`) that validated the approach against live providers (`anthropic-messages`, `openai-responses`, `openai-completions`, `google-generative-ai`). This document describes the full production design for `main`. The PoC code on `feat/piai-parallel-chat-completions-inference-path` is a reference and source of lessons, not a base to build from — it is missing full Dispatcher integration (failover, cooldowns, concurrency, stall detection, quota) and should be treated as a prototype only.

---

## Executive Summary

Plexus today routes every inference request through a hand-written transformation pipeline: inbound wire format (OpenAI, Anthropic, Gemini) is parsed into a `UnifiedChatRequest`, dispatched via HTTP to an upstream provider, and the raw HTTP response is parsed back through a `Transformer` into `UnifiedChatResponse` before being re-serialised to the client's expected wire format.

The `@earendil-works/pi-ai` library already handles the upstream half of this pipeline natively — it takes a provider-agnostic `Context` + options, selects the correct SDK, signs requests, and streams back a typed `AssistantMessage`. Plexus currently uses pi-ai only for OAuth providers (via `OAuthTransformer`). The proof-of-concept on branch `feat/piai-parallel-chat-completions-inference-path` demonstrated that pi-ai can be used for any key-auth upstream provider, removing the need for per-provider request-building code inside Plexus, and doing so for all four API types pi-ai supports: `anthropic-messages`, `openai-completions`, `openai-responses`, and `google-generative-ai`.

The goal of this design is a staged, zero-regression rollout that replaces the custom Transformer implementations for chat completions, Anthropic messages, OpenAI Responses, and Gemini with pi-ai native transformation, while fully integrating Dispatcher machinery (cooldowns, failover, stall detection, concurrency, quota enforcement) that the PoC left aside. Embeddings, transcriptions, speech, and image generation stay on the custom path because pi-ai does not support them.

---

## Current Architecture Overview

### The Transformer pipeline

Each incoming API surface (`/v1/chat/completions`, `/v1/messages`, `/v1/responses`, `/v1beta/models/:model/...`) has a corresponding route handler that instantiates a `Transformer` and calls `dispatcher.dispatch()`.

```
Client request
    ↓
Route handler  (chat.ts / messages.ts / responses.ts / gemini.ts)
    ↓ transformer.parseRequest()
UnifiedChatRequest
    ↓ dispatcher.dispatch()
        ↓ Router.resolve() — pick provider + model
        ↓ transformer.transformRequest() — build provider payload (JSON)
        ↓ fetch() to upstream URL
        ↓ transformer.transformResponse() / transformStream() — parse body
    UnifiedChatResponse / stream
    ↓ handleResponse()
        ↓ transformer.formatResponse() / formatStream() — re-serialise to client shape
Client response
```

The `Dispatcher` is the orchestration hub. Inside its `dispatch()` loop it handles:
- Candidate selection and ordering (`Router.resolveCandidates`)
- Cooldown checking (`CooldownManager.isProviderHealthy`)
- Concurrency slot acquisition (`ConcurrencyTracker.acquire`)
- Vision fallthrough preprocessing
- Context-limit enforcement
- Stall detection wiring (`wireStallDetection`, TTFB probes)
- Failover loop across candidates
- Success/failure recording (`CooldownManager.markProviderSuccess/Failure`)
- Sticky session tracking
- Usage metric recording

For OAuth providers, `dispatch()` delegates to `dispatchOAuthRequest()`, which calls `OAuthTransformer.executeRequest()`. That method calls `stream()` or `complete()` from pi-ai directly. All the Dispatcher machinery (cooldown, concurrency, failover) is applied at the same layer that decides to call `dispatchOAuthRequest()`.

### What the UnifiedChatRequest/Response types do

`UnifiedChatRequest` and `UnifiedChatResponse` are a normalised mid-layer representation. They exist because the Dispatcher needs to be format-agnostic: it must be able to apply adapters, build debug logs, and record usage without knowing whether the incoming request was OpenAI or Anthropic shaped. The Transformer interface bridges the gap between wire formats and this normalised form.

### What pi-ai provides and what it does not

**pi-ai provides:**
- `getModel(provider, modelId)` — returns a `Model` record with `api`, `baseUrl`, `compat`, `thinkingLevelMap`, and token pricing.
- `stream(model, context, options)` / `complete(model, context, options)` — takes a pi-ai `Context` (messages, systemPrompt, tools) and `ProviderStreamOptions`, handles all SDK interaction (auth, request building, response parsing), and returns `AsyncIterable<AssistantMessageEvent>` or `AssistantMessage`.
- `calculateCost(model, usage)` — returns cost breakdown (input, output, cacheRead, cacheWrite, total) from pi-ai's internal pricing table.
- `getModels()` — list of all models in the registry (already used by `Dispatcher` to validate OAuth model coverage).
- Native support for `anthropic-messages`, `openai-completions`, `openai-responses`, `openai-codex-responses`, `google-generative-ai`, `azure-openai-responses`, and more.

**pi-ai does NOT provide:**
- Inbound parsing — callers must build the `Context` themselves from whatever wire format the client sent.
- Outbound serialisation — pi-ai returns `AssistantMessage`; callers must convert that into the OpenAI / Anthropic / Gemini shape the client expects.
- Embeddings, transcriptions, speech, image generation — these stay on the custom HTTP + Transformer path.

### Why `stream()` and not `streamSimple()`

`streamSimple()` (and `completeSimple()`) are convenience wrappers that accept a `ThinkingLevel` string and internally translate it to per-provider thinking options. They also call `buildBaseOptions()` internally, which only threads a fixed set of known fields to the provider and silently drops everything else — including `toolChoice`, `parallelToolCalls`, and any non-standard pass-through fields. Using `streamSimple()` would silently break tool routing for any provider that respects `tool_choice`.

`stream()` (and `complete()`) accept a `ProviderStreamOptions` object defined as `StreamOptions & Record<string, unknown>`. Every field passes through unchanged to the underlying SDK call. We replicate only the thinking/reasoning mapping that `streamSimple()` does (via `buildThinkingOptions`), and get full option fidelity for everything else.

---

## Configuration Additions

Two new fields must be added to the Plexus config schema. The PoC validated these fields end-to-end — schema, DB columns (both postgres and sqlite dialects), config-repository persistence/deserialization, and frontend UI (ProviderAdvancedEditor + ProviderModelsEditor). On `main` these changes need to be applied fresh:

**`ProviderConfigSchema.pi_ai_provider`** (`string`, optional)
A pi-ai provider name (e.g. `"anthropic"`, `"openai"`, `"google"`). One pi-ai provider maps to one Plexus provider record. When this field is set and the matched model also has `pi_ai_model_id`, the beta inference path is used for that provider/model combination.

**`ModelProviderConfigSchema.pi_ai_model_id`** (`string`, optional)
The pi-ai model ID within that provider (e.g. `"claude-opus-4-6"`, `"gpt-4.1"`, `"gemini-2.5-pro"`). Each Plexus model entry maps to a different pi-ai model ID.

These two fields are intentionally separate from `ModelConfigSchema.pi_model`, which is an alias-level reference used for GET /v1/models `compat` metadata display. The beta inference fields live at the provider-model level (inside `models: { "model-name": { pi_ai_model_id: "..." } }` within a provider record), not at the alias level. They answer "which pi-ai model should the beta/pi-ai executor call for this provider:model target", not "what are this alias's advertised capabilities". Production `/v1/...` Transformer handlers do not read these fields.

**DB schema:** Add `pi_ai_provider: text('pi_ai_provider')` to the `providers` table and `pi_ai_model_id: text('pi_ai_model_id')` to the `provider_models` table in both postgres and sqlite Drizzle schemas. Generate a migration per the `db-schema-migrations` skill (run `bun run generate-migrations --name add_pi_ai_hint`).

**Config-repository:** In `saveProvider()`, persist `piAiProvider: config.pi_ai_provider ?? null` on the provider row and `piAiModelId: cfg.pi_ai_model_id ?? null` on each model row. In `rowToProviderConfig()`, deserialize both fields back.

**Frontend UI:** Add a "pi-ai Provider" text input to `ProviderAdvancedEditor.tsx` bound to `provider.pi_ai_provider`. Add a "pi-ai Model ID" text input per model in `ProviderModelsEditor.tsx`. Add `pi_ai_provider?: string` to the `Provider` interface in `lib/api.ts`, include it in `getProviders()` mapping, and include it in the `saveProvider()` request body. (The models object is `Record<string, any>` and passes through automatically.)

---

## The Beta Parallel Path Pattern

Every stage in this rollout follows the same structural pattern. The PoC validated this pattern end-to-end for Stage 1:

1. A `/beta/v1/...` route handler lives in `src/beta/` and is registered in addition to the existing `/v1/...` route.
2. The beta handler invokes the shared pi-ai execution core, which resolves candidates and filters them to routes with present and registry-valid `pi_ai_provider` + `pi_ai_model_id` hints. If no beta-compatible candidate remains, the handler rejects with a protocol-shaped 400 (the request should never have been sent to the beta route — client configuration error).
3. For beta-compatible providers, the beta handler bypasses `Dispatcher.dispatch()` and calls into the shared pi-ai execution core directly.
4. The existing `/v1/...` route is unchanged. Traffic only reaches the beta path if the client explicitly targets it — typically by configuring the upstream Plexus URL with the `/beta` prefix in a gateway or test harness.
5. Once a stage has been proven stable, a later forced production promotion can make the beta/pi-ai route family production-facing. That is an explicit routing/code event. The `/v1/...` inference handlers remain exclusively Transformer handlers and do not inspect pi-ai hints.

This pattern is zero-regression: no existing traffic is affected, no provider that does not have `pi_ai_provider` set is touched, and the beta route fails closed (400) for misconfigured calls rather than silently falling back.

### Path isolation: no cross-path failover

The beta and non-beta request paths are isolated by design:

- Requests entering `/beta/...` consider **only** candidates with valid `pi_ai_provider` + `pi_ai_model_id` hints. If no beta-compatible candidate remains after routing policy, cooldown, concurrency, and registry validation, the beta request fails. It must not fall back to the legacy Transformer path.
- Requests entering existing `/v1/...` production endpoints use **only** the existing Transformer/Dispatcher path. They do not check `pi_ai_provider`, `pi_ai_model_id`, or pi-ai registry validity.
- Production promotion is a forced routing/code change, done per endpoint/stage, that makes the beta/pi-ai implementation production-facing. It is not conditional per provider/model and does not mix beta-compatible and legacy candidates in one failover loop.

This preserves observability boundaries: route family selects the execution family. `/v1/...` inference routes are Transformer-only. `/beta/v1/...` inference routes are pi-ai-only. There is no failover across execution families.

---

## Shared Infrastructure to Extract

Before implementing Stage 2 onward, several pieces from `run.ts` and `oauth-transformer.ts` should be extracted into shared utilities. The PoC duplicated some of this logic and others remain buried in files with misleading names.

### `src/beta/pi-ai-utils.ts`

**`resolveBaseUrl(apiBaseUrl, upstreamApi, incomingApiType)`**

Currently inlined in `run.ts`. Must become shared because all four endpoint stages need it. The rule: for `anthropic-messages`, strip a trailing bare `/v1` from the configured URL because the Anthropic SDK appends `/v1` itself. For all other API types (`openai-completions`, `openai-responses`, `google-generative-ai`), preserve the full configured URL including `/v1` because those SDKs only append the endpoint path (e.g. `/chat/completions`).

The function must also resolve `api_base_url` from the `string | Record<string, string>` union. When it is a record, pick the key matching the upstream pi-ai API, then known Plexus aliases for that upstream API, then `"default"`, then take the first value.

**`buildReasoningOptions(piApi, piModelId, effort?)`**

Currently inlined in `run.ts` with a call to `buildThinkingOptions` imported from `oauth-transformer.ts`. That import is an awkward layering violation. The function should live in `pi-ai-utils.ts` and export `buildThinkingOptions` re-exported from there (with `oauth-transformer.ts` updated to import from the shared location instead of defining it).

The semantics:
- When `effort` is provided, delegate to `buildThinkingOptions(piApi, piModelId, effort)`.
- When `effort` is absent, explicitly disable thinking per provider: `{ thinkingEnabled: false }` for `anthropic-messages`; `{ thinking: { enabled: false } }` for `google-generative-ai`; nothing (empty object) for OpenAI-family APIs. This mirrors what `streamSimple` does internally and prevents silent thinking token consumption.

**`buildPiAiModel(providerConfig, piAiProvider, piAiModelId, incomingApiType)`**

Wraps `getModel()` and applies the `baseUrl` override from the plexus config. Returns a shallow copy of the pi-ai `Model` with `baseUrl` set to the resolved configured URL. This is the canonical "give me the pi-ai Model ready to call" function used by all stages.

Important: base URL resolution must key off the **upstream pi-ai API** (`piModel.api`), not the client-facing route type. A `/beta/v1/chat/completions` request can legitimately route to a pi-ai model whose upstream API is `anthropic-messages`, `openai-responses`, or `google-generative-ai`. When `api_base_url` is a record, first select the key matching `piModel.api`; then fall back through known Plexus aliases for that upstream API (`chat` for `openai-completions`, `responses` for `openai-responses`, `messages` for `anthropic-messages`, `gemini` for `google-generative-ai`); then `default`; then the first value. The `incomingApiType` remains useful for routing, usage, and protocol framing, but it must not be the primary key for upstream base URL selection.

### `src/beta/pi-ai-executor.ts`

The core execution logic — responsible for routing, concurrency, cooldown, stall detection, usage recording, and debug logging. As stages 2–4 are added, this executor should be stage-agnostic. The caller (route handler or inbound-parser layer) passes:
- the client model alias; the executor resolves candidates and applies beta-compatible filtering
- a pi-ai `Context` (built by the inbound parser for this stage)
- a `ProviderStreamOptions` fragment (options extracted from the inbound request)
- an outbound serialiser callback (turns `AssistantMessage` / `AssistantMessageEvent` into the client's wire format)
- metadata for usage recording (incomingApiType, toolsDefined, messageCount, etc.)

This design means the executor is ignorant of wire format while the inbound parsers and outbound serialisers are ignorant of routing and Dispatcher machinery. See the Dispatcher Integration section for full detail on what the executor must implement.

---

## Stage 1: `/v1/chat/completions` (OpenAI-compatible)

**Status: Approach proven via PoC on branch `feat/piai-parallel-chat-completions-inference-path`.**

The PoC demonstrated the full round-trip for OpenAI chat-completions format through pi-ai for `anthropic-messages`, `openai-responses`, `openai-completions`, and `google-generative-ai` backends. Streaming and non-streaming both work. Usage recording and debug logging are wired. `buildThinkingOptions` correctly maps `reasoning_effort` to per-provider option shapes. The `onPayload` callback captures the real upstream request for debug logging.

The PoC is **not** the production implementation. It is missing:
- Cooldown pre-check per attempt
- Concurrency slot acquisition/release
- Failover across candidates (uses `Router.resolve()` only, not `Router.resolveCandidates()`)
- Stall detection (TTFB probe and byte-rate monitoring)
- Quota enforcement
- Sticky session recording

When implementing Stage 1 on `main`, refer to the PoC files on `feat/piai-parallel-chat-completions-inference-path` as a reference, but implement all of the above from the start.

### Inbound parser: `beta/openai-to-context.ts`

Converts OpenAI chat-completions JSON directly to pi-ai `Context`. Must handle:
- `system` and `developer` role messages collapsed into `context.systemPrompt`
- `user` messages with text and base64 image content
- `assistant` messages with text and tool calls
- `tool` role messages as `ToolResultMessage`
- Tool definitions via `jsonSchemaToTypeBox`
- `temperature`, `max_tokens` / `max_completion_tokens`, `tool_choice`

Gaps to close before Stage 1 production promotion:
- URL image content is currently rejected with an error; some providers support URL images. Decide: convert to base64 at the gateway, or pass through if the backend is known to support URLs. For now keep the error.
- Multiple consecutive system messages are concatenated with `\n\n`; this matches the existing behaviour but should be documented.

### Outbound serialiser: `beta/context-to-openai.ts`

Converts `AssistantMessage` → `OpenAIChatCompletion` and `AssistantMessageEvent` → `OpenAIChatChunk`. Must handle text, thinking/reasoning (`reasoning_content`), tool calls (with correct 0-based `tool_calls` array index separate from content block index), usage, and stop reason mapping. `chunkToSSE` emits `data: {...}\n\n` frames; a terminal `data: [DONE]\n\n` frame closes the stream. When `AssistantMessage.stopReason === 'error'`, surface `message.errorMessage` as the content so the caller can see the upstream error.

### Dispatcher integration for Stage 1

The full integration requires replacing the `Router.resolve()` call in `run.ts` with `Router.resolveCandidates()` and wrapping the pi-ai call in a failover loop. The loop structure mirrors what `Dispatcher.dispatch()` does for the OAuth branch:

```
candidates = await Router.resolveCandidates(model, 'chat')
for each candidate:
  if CooldownManager.isProviderHealthy() === false → skip, appendSkippedAttempt
  if ConcurrencyTracker.acquire() === false → skip, appendSkippedAttempt
  try:
    build piModel, context, options
    wire stall detection addStallConfig per provider overrides
    call stream() or complete() with attemptTimeout.signal
    on success: CooldownManager.markProviderSuccess, release slot, record usage
  catch:
    CooldownManager.markProviderFailure / markProviderStallFailure
    release slot
    if retryable and more candidates: continue
    else: throw
throw buildAllTargetsFailedError if all candidates exhausted
```

For pi-ai, "retryable errors" are:
- Any error where `signal` was not aborted (client disconnect is never retried)
- `AbortError` from the attempt timeout (maps to upstream_timeout, retryable if more candidates)
- Network-level errors (ECONNREFUSED, ETIMEDOUT)
- HTTP errors from pi-ai that surface as exceptions with status 5xx

There is no `probeStreamingStart()` for the pi-ai path because pi-ai does not return a raw `Response` — it returns an `AsyncIterable<AssistantMessageEvent>`. The equivalent of TTFB stall detection is: start a timer when the stream is initiated and race it against the awaited stream event. If no event arrives within `stallTtfbMs`, abort the upstream. This may trigger failover only if no client frame has been emitted yet; after the first client frame, the stream must fail in-protocol without switching providers.

Quota enforcement is the simplest integration: the route handler calls `checkQuotaMiddleware(request, reply, quotaEnforcer)` before calling the executor. If quota is exceeded, return early. On success, the quota enforcer receives a `UsageRecord` at the end (already done via `usageStorage.saveRequest`).

### Testing approach for Stage 1

- Unit tests for `openai-to-context.ts`: cover all message role combinations, multi-part content, tool definitions, reasoning_effort pass-through. Mock pi-ai types only.
- Unit tests for `context-to-openai.ts`: cover all event types, tool call index computation, usage field mapping, stop reason mapping.
- Integration test (existing pattern in `__tests__/`): mock pi-ai `stream` and `complete` with known `AssistantMessageEvent` sequences, assert SSE output and usage record shape.
- Manual end-to-end: already done in PoC (typecheck + live API calls with multiple providers).

### Production promotion for Stage 1

When confidence is established, production promotion is a forced routing/code
change that makes the beta/pi-ai chat-completions route production-facing. Do not
add a provider-hint predicate or a conditional fast path to the existing `/v1`
Transformer handler. The `/v1/chat/completions` handler remains a Transformer
handler.

The `OpenAITransformer` class is not deleted during promotion unless a later cleanup
confirms there are no remaining consumers.

---

## Stage 2: `/v1/messages` (Anthropic-compatible)

### What changes

The Anthropic messages wire format is structurally different from OpenAI chat-completions:
- `system` is a top-level field (string or array of content blocks), not a message role.
- `messages[].content` is an array of typed blocks: `text`, `image`, `tool_use`, `tool_result`, `thinking`.
- The response is `{ type: "message", role: "assistant", content: [...], stop_reason, usage }`.
- Streaming uses SSE with event types: `message_start`, `content_block_start`, `content_block_delta`, `content_block_stop`, `message_delta`, `message_stop`.
- `thinking` blocks in history must be preserved as pi-ai `ThinkingContent` in the assistant turn.

The existing `parseAnthropicRequest()` in `transformers/anthropic/request-parser.ts` already handles this conversion to `UnifiedChatRequest`. The pi-ai equivalent needs to go directly from Anthropic JSON to pi-ai `Context`, bypassing `UnifiedChatRequest`.

### New file: `beta/anthropic-to-context.ts`

This is the Stage 2 inbound parser. It mirrors `openai-to-context.ts` in structure but speaks the Anthropic wire format:

**System prompt:** Accept both `string` and `ContentBlock[]` forms. For the array form, concatenate text blocks with `\n\n`. Cache control annotations on system blocks are part of the Anthropic prompt caching protocol; they can be passed through as-is if pi-ai propagates them, or stripped if not. Determine pi-ai's behaviour here before finalising.

**User messages:** Content arrays with `text` (→ `TextContent`), `image` with `source.type === "base64"` (→ `ImageContent`), and `image` with `source.type === "url"`. The URL image handling decision is the same as in Stage 1.

**Assistant messages:** Must handle `thinking` blocks in history. The existing `parseAnthropicRequest()` maps these to `UnifiedMessage.thinking`. The pi-ai `AssistantMessage.content` array supports `ThinkingContent` blocks (`{ type: "thinking", thinking: string }`). When building an `AssistantMessage` from history, preserve any thinking blocks so pi-ai passes them correctly to Anthropic (Anthropic requires thinking blocks in history when extended thinking is active).

**Tool use/result:** `tool_use` blocks in assistant turns → `ToolCallContent` blocks. `tool_result` blocks in user turns → `ToolResultMessage`.

**Tool definitions:** Anthropic tool format is `{ name, description, input_schema }`. Map `input_schema` through `jsonSchemaToTypeBox` (same as Stage 1).

**Reasoning:** The Anthropic messages format uses `{ thinking: { type: "enabled", budget_tokens: N } }` to enable thinking. Map this to a `reasoning_effort` string via `getThinkLevel()` (already exists in `transformers/utils.ts`), then pass to `buildReasoningOptions()`.

### New file: `beta/context-to-anthropic.ts`

Outbound serialiser from `AssistantMessage` / `AssistantMessageEvent` → Anthropic messages wire format.

**Non-streaming:** Produce `{ id, type: "message", role: "assistant", model, content: [...], stop_reason, stop_sequence: null, usage }`. Content array: `thinking` blocks first (if present), then `text` block, then `tool_use` blocks. Stop reason: `"end_turn"` for `stop`, `"tool_use"` for `toolUse`, `"max_tokens"` for `length`. Usage: `{ input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens }`.

**Streaming:** Emit the Anthropic SSE event sequence. This is already implemented in `transformers/anthropic/stream-formatter.ts` as `formatAnthropicStream()` — it operates on a `ReadableStream` of OpenAI-shaped chunks. For the pi-ai path, we consume `AssistantMessageEvent` directly and emit Anthropic SSE events:

- On `start`: emit `message_start` with an empty content array and usage from the initial event (input tokens if available).
- On `text_delta`: if no active text block, emit `content_block_start { type: "text", text: "" }`, then `content_block_delta { type: "text_delta", text: delta }`.
- On `thinking_delta`: if no active thinking block, emit `content_block_start { type: "thinking", thinking: "" }`, then `content_block_delta { type: "thinking_delta", thinking: delta }`.
- On `toolcall_delta`: on first delta for a tool, emit `content_block_start { type: "tool_use", id, name, input: {} }`, then `content_block_delta { type: "input_json_delta", partial_json: delta }`.
- On `done`: emit `content_block_stop` for any open block, then `message_delta { stop_reason, stop_sequence: null }` with final usage, then `message_stop`.
- On `error`: emit `message_delta` with stop_reason `"error"` and close.

The existing `formatAnthropicStream` in `stream-formatter.ts` should be studied for edge cases (multiple tool calls, interleaved thinking and text) before finalising this implementation.

### Route: `beta/index.ts` extension

Add `POST /beta/v1/messages` to `registerBetaRoutes()`. The handler follows the same pattern as `/beta/v1/chat/completions`: read body as Anthropic messages JSON, call `anthropicRequestToContext()`, call the pi-ai executor, write either the JSON response or the Anthropic SSE stream.

Error responses for this route must follow the Anthropic format: `{ type: "error", error: { type, message } }`, not the OpenAI `{ error: { message, type } }` shape. This is already the case in the existing `/v1/messages` handler.

### Dispatcher integration for Stage 2

Identical to Stage 1. The executor is agnostic to wire format — it takes a `Context`, calls `stream()`/`complete()`, and invokes the outbound serialiser callback with the result. The only difference is `incomingApiType: 'messages'` in the usage record.

### Testing approach for Stage 2

- Unit tests for `anthropic-to-context.ts`: multi-block system prompts, thinking blocks in history, tool use/result interleaving, Anthropic thinking configuration mapping.
- Unit tests for `context-to-anthropic.ts`: full SSE event sequence for text-only, thinking + text, tool call, multi-tool; non-streaming response shape.
- Integration test: mock pi-ai with a known event sequence, assert the SSE output matches the Anthropic streaming protocol byte-for-byte (use the existing `anthropic-stream.test.ts` as reference for expected output shape).

---

## Stage 3: `/v1/responses` (OpenAI Responses API)

### What changes

The OpenAI Responses API has a fundamentally different input shape than chat-completions:
- `input` is either a string or an array of items with `type`, `role`, and `content`.
- `previous_response_id` triggers server-side context loading from `ResponsesStorageService`.
- The response format is `{ id, object: "response", output: [...], usage }` — not `{ choices: [...] }`.
- Streaming uses SSE with event types from the Responses API spec (`response.created`, `response.output_item.added`, `response.content_part.added`, `response.output_text.delta`, `response.completed`, etc.).

The existing `ResponsesTransformer` handles this in the current path. The Responses API route handler also integrates with `ResponsesStorageService` for `previous_response_id` and `conversation` context loading, and for post-response storage (`body.store !== false`). These storage integrations must be preserved in the beta path.

### New file: `beta/responses-to-context.ts`

Converts OpenAI Responses API `input` array to pi-ai `Context`.

**Input normalization:** The existing `normalizeInput()` helper in `responses.ts` already handles the string → array conversion. Borrow this logic. Each item has `type: "message"` with `role` and `content` array (items with `type: "input_text"`, `type: "input_image"`, `type: "output_text"`, `type: "tool_call"`, `type: "tool_result"`).

**Message mapping:**
- `role: "user"` with `input_text` content → `UserMessage`
- `role: "assistant"` with `output_text` → `AssistantMessage` (history)
- `role: "assistant"` with `tool_call` items → `AssistantMessage` with `ToolCallContent`
- Tool result items → `ToolResultMessage`

**System message:** The Responses API does not have a top-level `system` field, but `input` items can have `role: "system"`. Collect these and build `context.systemPrompt`.

**Tools:** Same `jsonSchemaToTypeBox` mapping.

**Reasoning:** The Responses API uses `reasoning: { effort, summary }`. Map `effort` through `buildReasoningOptions()`.

Note: `previous_response_id` and `conversation` resolution must happen in the route handler before calling `responsesToContext()` — the same as in the current `responses.ts` handler. By the time the inbound parser is called, `body.input` already contains the full concatenated history.

### New file: `beta/context-to-responses.ts`

Converts `AssistantMessage` / `AssistantMessageEvent` to OpenAI Responses API wire format.

**Non-streaming response:** `{ id, object: "response", status: "completed", model, output: [...], usage: { input_tokens, output_tokens, ... } }`. Output items: each text block → `{ type: "message", role: "assistant", content: [{ type: "output_text", text }] }`; reasoning content → `{ type: "reasoning", summary: [{ type: "summary_text", text }] }` (when requested); tool calls → `{ type: "function_call", call_id, name, arguments }`.

**Streaming:** Responses API streaming uses a more verbose event schema than chat-completions. Events include `response.created`, `response.output_item.added`, `response.content_part.added`, `response.output_text.delta`, `response.output_text.done`, `response.content_part.done`, `response.output_item.done`, `response.completed`. Study the existing `ResponsesTransformer.formatStream()` and `ResponsesTransformer.transformStream()` for the exact event sequence before implementing.

**Post-response storage:** After a successful non-streaming response, if `body.store !== false`, call `responsesStorage.storeResponse()` and optionally `responsesStorage.updateConversation()`. This is identical to what the current `responses.ts` handler does after `handleResponse()`. The beta path must replicate this.

### Dispatcher integration for Stage 3

Same failover loop as Stages 1–2. `incomingApiType: 'responses'` in usage record.

---

## Stage 4: `/v1beta/models/:model/generateContent` (Gemini-compatible)

### What changes

Gemini uses a structurally distinct wire format:
- URL encodes the model name: `/v1beta/models/{model}:generateContent` or `:streamGenerateContent`.
- Request body has `contents: [{ role, parts: [...] }]`, `systemInstruction`, `tools`, `generationConfig`.
- Parts have `text`, `inlineData` (base64 images), `functionCall`, `functionResponse`.
- Response is `{ candidates: [{ content, finishReason, ... }], usageMetadata }`.
- Streaming is NDJSON (one JSON object per line), not SSE.

The existing `GeminiTransformer` and its `request-parser.ts` / `response-formatter.ts` / `stream-formatter.ts` handle this today.

### New file: `beta/gemini-to-context.ts`

Converts Gemini `contents` array to pi-ai `Context`.

**System instruction:** `systemInstruction.parts[].text` → `context.systemPrompt`.

**Contents:** Each `{ role: "user" | "model", parts: [...] }`. `role: "model"` maps to assistant. Parts: `text` → `TextContent`; `inlineData` (base64) → `ImageContent`; `functionCall` → `ToolCallContent`; `functionResponse` → goes into a `ToolResultMessage` (Gemini encodes tool results as `functionResponse` parts within a `user` role turn — this is the trickiest mapping).

**Tools:** Gemini's `functionDeclarations` → pi-ai `Tool` via `jsonSchemaToTypeBox`. Gemini uses OpenAPI-style schemas which are mostly compatible.

**Reasoning:** Gemini 2.5+ models have `generationConfig.thinkingConfig`. Map to `buildReasoningOptions('google-generative-ai', ...)`. For models that support thinking levels (Gemini 2.5 Pro, Flash), map the level string to the effort string.

**Streaming detection:** The Gemini route detects streaming from the URL action suffix (`:streamGenerateContent` vs `:generateContent`), not from a request body field. The route handler must parse this and pass `streaming: boolean` to the executor.

### New file: `beta/context-to-gemini.ts`

Converts `AssistantMessage` / `AssistantMessageEvent` to Gemini wire format.

**Non-streaming:** `{ candidates: [{ content: { role: "model", parts: [...] }, finishReason, ... }], usageMetadata: { promptTokenCount, candidatesTokenCount, totalTokenCount } }`. Parts: text → `{ text: "..." }`; thinking → `{ thought: true, text: "..." }` (Gemini 2.5 format); tool calls → `{ functionCall: { name, args } }`.

**Streaming:** NDJSON — one Gemini response object per line, each with a partial candidate. This differs from SSE. Each `text_delta` event produces a line with `{ candidates: [{ content: { parts: [{ text: delta }] } }] }`. The final line includes `usageMetadata`.

Study `transformers/gemini/stream-formatter.ts` and `stream-transformer.ts` before implementing.

---

## What Stays on the Custom Path

The following API surfaces are not touched by this design. They remain on the existing Transformer + HTTP fetch path:

| Surface | Route | Reason |
|---|---|---|
| Embeddings | `/v1/embeddings` | pi-ai has no embedding support |
| Transcriptions | `/v1/audio/transcriptions` | pi-ai has no audio support |
| Speech | `/v1/audio/speech` | pi-ai has no TTS support |
| Image generation | `/v1/images/generations` | pi-ai has no image generation |
| Image edits | `/v1/images/edits` | pi-ai has no image editing |

These five dispatch paths (`dispatchEmbeddings`, `dispatchTranscription`, `dispatchSpeech`, `dispatchImageGenerations`, `dispatchImageEdits`) in `Dispatcher` are permanent. They will continue to call their respective Transformer implementations.

---

## Full Dispatcher Integration Design

This section describes what the fully-integrated pi-ai executor must implement. The PoC implementation in `run.ts` is a starting point, not the final design. The executor described here is what `pi-ai-executor.ts` should become.

### Interface

```typescript
interface PiAiExecutorInput {
  requestId: string;
  incomingApiType: string;       // 'chat' | 'messages' | 'responses' | 'gemini'
  modelAlias: string;            // original alias from client
  context: Context;              // built by inbound parser
  streamOptions: ProviderStreamOptions; // options from inbound parser (sans apiKey/signal)
  streaming: boolean;
  request: FastifyRequest;       // for IP, keyName, attribution
  usageStorage: UsageStorageService;
  quotaEnforcer?: QuotaEnforcer;
  signal?: AbortSignal;          // from wireUpstreamTimeout + wireEarlyDisconnectDetection
  onSuccess: (msg: AssistantMessage) => void | Promise<void>; // post-processing hook
}

interface PiAiExecutorResult {
  response?: unknown;            // wire-format non-streaming response
  stream?: AsyncIterable<string>; // wire-format SSE or NDJSON frames
}
```

The `onSuccess` hook covers stage-specific post-processing: for Stage 3, this stores the response via `ResponsesStorageService`. For other stages it is a no-op.

### Failover loop

```
candidates = await Router.resolveCandidates(modelAlias, incomingApiType)
if candidates.length === 0: candidates = [await Router.resolve(modelAlias, incomingApiType)]
candidates = applyKeyAccessPolicy(candidates)

for i, route in candidates:
  if signal?.aborted: throw buildCancelledError()

  attemptTimeout = createAttemptTimeout(signal, route.config.timeoutMs)

  if not CooldownManager.isProviderHealthy(route.provider, route.model):
    attemptTimeout.cleanup()
    appendSkippedAttempt(...)
    continue

  acquired = ConcurrencyTracker.acquire(route.provider, route.model)
  if not acquired:
    attemptTimeout.cleanup()
    appendSkippedAttempt(...)
    continue

  piAiProvider = route.config.pi_ai_provider
  piAiModelId = route.modelConfig?.pi_ai_model_id
  if not piAiProvider or not piAiModelId:
    release slot
    throw 400 missing_pi_ai_hint

  piModel = buildPiAiModel(route.config, piAiProvider, piAiModelId, incomingApiType)

  resolve stall config (global merged with route overrides)
  call addStallConfig(route overrides) to update StallInspector

  try:
    result = await callPiAi(piModel, context, {
      ...streamOptions,
      apiKey: route.config.api_key,
      headers: route.config.headers,
      signal: attemptTimeout.signal,
      onPayload: (p) => debug.addTransformedRequest(requestId, p),
    })

    if non-streaming:
      CooldownManager.markProviderSuccess(route.provider, route.model)
      appendSuccessAttempt(...)
      release slot
      attemptTimeout.cleanup()
      return result

    if streaming:
      return wrapped stream result
      // the wrapper owns mark-success, release, timeout cleanup, usage save,
      // quota recording, and debug flush after the terminal event or error

  catch err:
    effectiveErr = attemptTimeout.isTimedOut() ? buildTimeoutError() : err
    if signal?.aborted: throw buildCancelledError()

    CooldownManager.markProviderFailure / markProviderStallFailure
    release slot
    attemptTimeout.cleanup()

    canRetry = failoverEnabled and i < candidates.length - 1 and isRetryable(effectiveErr)
    appendFailureAttempt(..., canRetry)

    if canRetry:
      saveIntermediateError(...)
      continue

    throw buildAllTargetsFailedError(...)

throw buildAllTargetsFailedError(...)
```

### Stall detection for pi-ai streaming

The raw HTTP path can probe TTFB via `probeStreamingStart()` because it has access to the raw `Response` object before streaming begins. The pi-ai path does not expose a `Response` — `stream()` returns an `AsyncIterable<AssistantMessageEvent>` that is already consuming the HTTP response internally.

The equivalent TTFB detection for pi-ai streaming: wrap stream iteration with a race against a timeout that starts when `stream()` returns (i.e., when the HTTP connection is established). If no event of type other than `start` arrives within `stallTtfbMs`, abort the upstream via the signal and treat it as a stall.

Implementation sketch inside `buildSSEStream`:
```typescript
const iterator = eventStream[Symbol.asyncIterator]();
let sawContentEvent = false;

while (true) {
  const next = stallConfig?.ttfbMs != null && !sawContentEvent
    ? await nextWithTimeout(iterator.next(), stallConfig.ttfbMs, () => {
        attemptAbortController.abort(new StallError('TTFB stall: no content within ttfbMs'));
      })
    : await iterator.next();

  if (next.done) break;

  const event = next.value;
  if (event.type !== 'start') sawContentEvent = true;
  // ... process event
}
```

Checking the wall clock inside a `for await` body is insufficient: if no event arrives, the loop body never runs. The timeout must race the awaited `next()` promise and actively abort the upstream attempt.

When a stall is detected, abort the upstream signal and surface the error to the failover loop. The loop calls `CooldownManager.markProviderStallFailure()` and may retry the next candidate only if no client frame has been emitted yet.

Note: `stall_cooldown: false` on the provider config means stall failures do not trigger a cooldown (same semantics as the HTTP path). Check `route.config.stall_cooldown` before calling `markProviderStallFailure`.

### Streaming failure boundary

Streaming failover is only safe before any bytes have been emitted to the client. Once a route has yielded the first SSE or NDJSON frame, switching to another provider would produce a mixed protocol stream and corrupt the client-visible response.

The streaming wrapper must track `hasEmittedClientFrame`:
- If pi-ai errors, times out, or stalls before the first client frame, the executor may treat the attempt as retryable and continue to the next beta-compatible candidate.
- If an error happens after the first client frame, do **not** retry. Record the failure on the selected attempt, release concurrency, clean up timeout state, save usage/error/debug information, and close the stream using the current protocol's best available error/terminal shape.

This boundary applies to SSE stages and Gemini NDJSON. It is stricter than non-streaming failover, but it is required for protocol correctness.

### Concurrency release for streaming

For non-streaming responses, the concurrency slot is released immediately after `complete()` returns. For streaming responses, the slot must not be released until the stream is fully consumed (or errored). The stream wrapper must also keep the attempt timeout active until the terminal event or error; otherwise a hung stream can outlive its provider timeout. `CooldownManager.markProviderSuccess()` should run only after a terminal successful stream, not immediately after `stream()` returns. The `buildSSEStream` generator must call `doRelease()` and timeout cleanup exactly once in its terminal path. This mirrors the `ReadableStream` wrapper in `Dispatcher.dispatch()` that wraps streaming responses to hook `pull` and `cancel`.

### Quota enforcement

Quota checking happens at the route handler level, before the executor is called. The pattern is the same as the existing handlers:

```typescript
if (quotaEnforcer) {
  const allowed = await checkQuotaMiddleware(request, reply, quotaEnforcer);
  if (!allowed) return;
}
```

Post-request quota recording must happen after usage and cost are finalized, using the same `recordQuotaUsage()` helper as the existing response handlers. `usageStorage.saveRequest()` persists usage and emits UI events, but it does not by itself consume quota. The executor must call `recordQuotaUsage(keyName, usageRecord, quotaEnforcer)` for successful pi-ai requests when a quota enforcer and key name are present.

### Usage recording

The executor populates a `UsageRecord` incrementally:
- `emitStartedAsync()` immediately (request received)
- `emitUpdatedAsync()` with `{ requestId, provider, selectedModelName, canonicalModelName }` after route is resolved
- `saveRequest(usageRecord)` after streaming completes or non-streaming response is built

Fields populated from pi-ai:
- `tokensInput` / `tokensOutput` / `tokensCached` / `tokensCacheWrite` — from `AssistantMessage.usage`
- `costInput` / `costOutput` / `costCached` / `costCacheWrite` / `costTotal` — from `calculateCost(piModel, usage)`
- `costSource: 'pi-ai'`
- `finishReason` — mapped from `AssistantMessage.stopReason`
- `toolCallsCount` — count of `ToolCallContent` blocks in `AssistantMessage.content`
- `ttftMs` — time from stream start to first non-`start` event
- `durationMs` — total wall time
- `attemptCount` / `retryHistory` — populated from the failover loop

`responseStatus` is set to `'success'`, `'error'`, `'timeout'`, or `'cancelled'` depending on outcome.

### Debug logging

The executor calls:
- `debug.startLog(requestId, body, sanitizedHeaders)` — in the route handler before calling executor
- `debug.addTransformedRequest(requestId, payload)` — via `onPayload` callback in `ProviderStreamOptions`
- `debug.addTransformedResponse(requestId, openAiResponse)` — for non-streaming (or a snapshot of the response)
- `debug.flush(requestId)` — after usage is saved

For streaming responses, `addTransformedResponse` can capture the reconstructed response object after the stream is fully consumed (same as the PoC's `lastMessage` pattern). `debug.flush()` is called in the `finally` block of the stream generator.

The `debug.setProviderForRequest(requestId, provider)` call should happen immediately after route resolution, same as the PoC.

---

## Production Promotion Shape

Production `/v1/...` inference handlers remain exclusively on the existing Transformer + `Dispatcher.dispatch()` path. They do not check `pi_ai_provider`, `pi_ai_model_id`, or pi-ai registry validity, and they do not contain a provider-level pi-ai fast path.

After a beta stage is validated, production promotion is a deliberate routing/code change that makes the beta/pi-ai route family production-facing. This is a forced stage-level event, not a per-provider opt-in. It must not be implemented as a conditional branch inside the `/v1` Transformer handlers.

Because the execution family is selected by route family, not by provider hints, there is no failover across execution families. A `/beta/v1/...` request only considers beta-compatible pi-ai candidates. A `/v1/...` request only uses the Transformer path.

When both the OAuth path and the key-auth pi-ai path are mature, the two execution cores can be merged into a single shared pi-ai executor that `dispatchOAuthRequest()` also uses. At that point, the `OAuthTransformer.executeRequest()` method becomes a thin shim.

---

## Migration and Promotion Strategy

### Phase 1: Beta validation (current)

- `/beta/v1/chat/completions` is live. Opt-in per provider via `pi_ai_provider` + `pi_ai_model_id` config.
- Stages 2–4 beta routes are added in successive PRs.
- Each stage is validated against live providers with real traffic from a test harness.
- The full Dispatcher integration (failover loop, cooldown, concurrency, stall) is added to the beta executor before Stage 1 is declared ready for production.

### Phase 2: Forced production promotion (per stage)

For Stage 1 first:
1. A deliberate routing/code change makes the validated `/beta/v1/chat/completions` pi-ai implementation production-facing.
2. The `/v1/chat/completions` Transformer handler remains Transformer-only and does not branch on `pi_ai_provider` hints.
3. Monitor: usage records, error rates, cost accuracy, tool call correctness, reasoning token counts.

For Stage 2–4: same forced stage-level promotion, one endpoint family at a time.

### Phase 3: Transformer deprecation

Once beta/pi-ai routes have been deliberately promoted and any old Transformer consumers are no longer needed, Transformer classes can be marked deprecated if appropriate. They are not deleted unless a later cleanup explicitly removes their remaining consumers.

The `UnifiedChatRequest` / `UnifiedChatResponse` types are also not deleted. They remain as the intermediary representation for the non-pi-ai HTTP path and for OAuth-with-legacy-formatting cases.

### Rollback

After a beta/pi-ai route family has been promoted, rollback is a code/routing rollback or follow-up code change that stops sending production traffic to that beta/pi-ai route family. Removing `pi_ai_provider` is not a `/v1` rollback mechanism because `/v1/...` does not branch on pi-ai hints. Beta `/beta/...` traffic remains pi-ai-only and will fail closed if no valid pi-ai-compatible candidate is available.

---

## Design Decisions

### Passthrough elimination

The current HTTP Transformer path has a `shouldUsePassThrough()` optimisation in `Dispatcher.transformRequestPayload()` (dispatcher.ts ~L2637). When the incoming API type matches the target API type (e.g. client sends OpenAI chat-completions and the upstream is also OpenAI-compatible), the Dispatcher skips the full parse → transform cycle and forwards the original request body directly, substituting only the model name. This exists because `UnifiedChatRequest` is a lossy representation — fields in the original body that don't map to unified types are dropped in `parseRequest()` and never reach the upstream.

The pi-ai path does not eliminate this lossiness — converting the original body to a pi-ai `Context` is also a lossy transformation, as the Context only represents fields pi-ai understands. This is an accepted regression: we are trading the passthrough optimisation (zero-loss forwarding for same-format requests) for the benefit of pi-ai's authoritative per-provider transformation. The expectation is that pi-ai's transformation is more correct and complete than Plexus's hand-written Transformer implementations, and that any fields pi-ai drops are fields that shouldn't be forwarded blindly anyway.

The passthrough check in `Dispatcher.shouldUsePassThrough()` remains part of the Transformer path. The pi-ai route family must not reuse that path or pass raw request bodies through it; pi-ai handlers build a `Context` directly and have no passthrough equivalent.

### Raw response capture

The existing HTTP path captures the raw upstream response body into the debug log via `DebugManager.addRawResponse()`. This is possible because the Dispatcher has direct access to the `Response` object from `fetch()`.

pi-ai does **not** expose the raw HTTP response body. `stream()` and `complete()` return only `AssistantMessageEvent` / `AssistantMessage`. The `onResponse` callback in `ProviderStreamOptions` is called with the HTTP `Response` object (status + headers only), but the body is already being consumed by pi-ai's SDK internals at that point and cannot be independently read.

The two viable approaches for implementation:

1. **Global `fetch` monkey-patch** — at server startup (before registering any pi-ai routes), wrap `globalThis.fetch` with a body-tapping interceptor. When a response arrives for a URL that matches a known pi-ai upstream, clone and buffer the response body, write it to `DebugManager.addRawResponse(requestId, body)`, then let the original response continue to pi-ai's SDK unchanged. This is straightforward because Plexus's `fetch` is used exclusively for upstream inference requests — there are no other fetch calls to worry about. The interceptor can be scoped to only tap responses when debug mode is active for the current request (thread the `requestId` via an `AsyncLocalStorage` context).

2. **HTTP proxy tap** — in debug mode, override `model.baseUrl` to point at a local Fastify reverse-proxy that mirrors the raw response body to the debug log before forwarding it to pi-ai's intended upstream. Slightly more infrastructure but fully transparent to pi-ai's SDK and avoids global state.

Both approaches require maintaining a correlation between the in-flight pi-ai request and a Plexus `requestId`. The `onPayload` callback already fires synchronously with the request and can set up this correlation in `AsyncLocalStorage`. The fetch interceptor or proxy then resolves the `requestId` from that context when the response arrives.

`onPayload` must still be used to capture the outbound request payload — this is complementary, not an alternative. Both outbound payload and raw inbound response must be captured for complete debugging.

The global `fetch` monkey-patch is the recommended initial implementation given its simplicity and the fact that Plexus is the only fetch caller in this process.

---

## Known Issues and Gaps from the PoC

### Base URL stripping (resolved in PoC, needs documentation)

The Anthropic SDK appends `/v1` to the base URL it is given. If Plexus is configured with `api_base_url: "https://api.anthropic.com/v1"`, pi-ai must be given `"https://api.anthropic.com"` (without `/v1`). The `resolveBaseUrl()` function in `run.ts` handles this by stripping the trailing `/v\d+` for `anthropic-messages` only. All other API types receive the full configured URL.

This is a subtle footgun: if a new API type is added to pi-ai that also strips the trailing path, `resolveBaseUrl()` will need updating. The correct approach is to test each new API type against a live provider at integration time.

### `streamSimple()` option loss (resolved in PoC)

Using `stream()` instead of `streamSimple()` was a deliberate PoC decision after discovering that `streamSimple()` calls `buildBaseOptions()` which only threads `temperature`, `maxTokens`, `systemPrompt`, `tools`, and `sessionId`. `toolChoice`, `parallelToolCalls`, and any non-standard options were silently dropped. The correct API is `stream()` with `ProviderStreamOptions`. Document this in any future pi-ai upgrade notes — if `streamSimple()` is ever updated to use `ProviderStreamOptions` internally, the switch back would be safe.

### pi-ai model registry coverage

`getModel()` panics (throws) if the provider/modelId pair is not in the registry. A provider configured with `pi_ai_provider: "anthropic"` and `pi_ai_model_id: "claude-4-opus"` (a model not yet in the pi-ai registry) can fail at request time unless validated. Mitigation: validate at config load time that `getModel(pi_ai_provider, pi_ai_model_id)` succeeds. Add this validation to `hydrateConfig()` or as a startup check in the executor.

This startup check should be non-fatal (a warning, not a config parse error) because the pi-ai registry may lag behind new model releases. Runtime behaviour depends on the request path:
- `/beta/...` paths are beta-only: an unrecognised pi-ai pair makes that candidate invalid for beta consideration. If no valid beta-compatible candidate remains, return a beta/protocol-shaped error. Do not fall back to the HTTP Transformer path.
- Production `/v1/...` paths ignore pi-ai hints entirely.
- `/beta/v1/...` paths use the pi-ai implementation by route family, not by conditional hint checks on the old Transformer path. Invalid pi-ai hints are configuration errors for the pi-ai implementation, not a signal to fall back to Transformer within the same request.

### Thinking options for non-thinking models

`buildThinkingOptions()` checks model IDs with string-includes for adaptive thinking detection (e.g. `modelId?.includes('sonnet-4-6')`). This is fragile against model ID changes. A more robust approach: check `piModel.compat` or `piModel.thinkingLevelMap` to determine if thinking is supported and which mode applies. This is deferred post-PoC but should be addressed before Stage 2 (Anthropic messages) ships to production.

### Multi-system-prompt concatenation

Both `openai-to-context.ts` and `anthropic-to-context.ts` collapse multiple system messages into a single `context.systemPrompt` by concatenating with `\n\n`. If a client sends cache-control annotations on individual system blocks (Anthropic prompt caching), this concatenation loses the per-block cache control. The proper fix for Anthropic-to-pi-ai is to check whether pi-ai's Anthropic SDK integration propagates `cache_control` on system blocks — if it does, pass the array; if not, the current concatenation is acceptable since pi-ai manages caching at a different level.

### Responses API state storage in beta

The current `/beta/v1/chat/completions` beta route does not implement `previous_response_id` or `conversation` context loading (those are Responses API features, not chat-completions). When the beta route for `/v1/responses` is implemented, it must replicate the `responsesStorage.getResponse()` / `responsesStorage.getConversation()` calls from the existing handler.

### Debug logging for streaming

The production implementation must capture a reconstructed response object for streaming requests, just as for non-streaming. For streaming, this means tapping the `AssistantMessageEvent` stream as it is consumed, accumulating content blocks and usage, and calling `debug.addTransformedResponse(requestId, reconstructedMessage)` with the final assembled `AssistantMessage` after the `done` event. This is the same approach as `addReconstructedRawResponse` in the existing HTTP streaming path, which captures a snapshot of the accumulated response for later inspection.

The raw response body for streaming must also be captured via the `fetch` interceptor described above — for streaming responses, the interceptor wraps the response body in a `TransformStream` that passes chunks through unchanged while writing copies to the debug log as they arrive — not `tee()`, which creates backpressure on the upstream.

### `attachAttemptMetadata` / retry history on beta responses

In the full Dispatcher, `attachAttemptMetadata()` stamps `plexus` metadata (attemptedProviders, retryHistory, provider, model) onto the `UnifiedChatResponse`. The beta path returns plain OpenAI/Anthropic/Gemini JSON directly. The `x-request-id` response header is already set. Retry history and attempt metadata are recorded in the usage record via `retryHistory` field. If clients need `X-Plexus-*` headers with routing metadata (some clients check these), the executor should set them on the reply object explicitly.

---

## File Map

All paths are relative to `packages/backend/src/`.

### New files (Stage 1)
- `beta/index.ts` — route registration for all beta endpoints
- `beta/pi-ai-utils.ts` — shared utilities: `resolveBaseUrl`, `buildReasoningOptions`, `buildPiAiModel`
- `beta/pi-ai-executor.ts` — full executor with failover loop, cooldown, concurrency, stall, quota, usage, debug
- `beta/openai-to-context.ts` — Stage 1 inbound parser (OpenAI chat-completions → pi-ai Context)
- `beta/context-to-openai.ts` — Stage 1 outbound serialiser (AssistantMessage/Event → OpenAI wire format)

### New files (Stage 2)
- `beta/anthropic-to-context.ts` — Stage 2 inbound parser
- `beta/context-to-anthropic.ts` — Stage 2 outbound serialiser

### New files (Stage 3)
- `beta/responses-to-context.ts` — Stage 3 inbound parser
- `beta/context-to-responses.ts` — Stage 3 outbound serialiser

### New files (Stage 4)
- `beta/gemini-to-context.ts` — Stage 4 inbound parser
- `beta/context-to-gemini.ts` — Stage 4 outbound serialiser

### Files to modify (all stages)
- `config.ts` — add `pi_ai_provider` to `ProviderConfigSchema`; add `pi_ai_model_id` to `ModelProviderConfigSchema`; add startup validation
- `db/config-repository.ts` — persist and deserialize both new fields
- `drizzle/schema/{postgres,sqlite}/providers.ts` — add `piAiProvider` column
- `drizzle/schema/{postgres,sqlite}/provider-models.ts` — add `piAiModelId` column
- `transformers/oauth/oauth-transformer.ts` — move `buildThinkingOptions` definition to `beta/pi-ai-utils.ts`, keep a re-export for backward compatibility

### Files to modify (promotion, one per stage)
- Promotion routing/code entrypoint for Stage 1 chat-completions
- Promotion routing/code entrypoint for Stage 2 Anthropic messages
- Promotion routing/code entrypoint for Stage 3 OpenAI Responses
- Promotion routing/code entrypoint for Stage 4 Gemini

### Key reference files on branch `feat/piai-parallel-chat-completions-inference-path`
Read these for implementation guidance; do not import or build on them directly:
- `src/beta/run.ts` — reference implementation of Stage 1 executor (without full Dispatcher integration)
- `src/beta/openai-to-context.ts` — reference inbound parser with `jsonSchemaToTypeBox` tool handling
- `src/beta/context-to-openai.ts` — reference outbound serialiser including tool call index computation and error surfacing
- `src/services/dispatcher.ts` — `dispatchOAuthRequest()` method for the failover loop pattern to mirror
- `src/transformers/oauth/oauth-transformer.ts` — `buildThinkingOptions()` function to extract and `executeRequest()` for auth/header patterns
