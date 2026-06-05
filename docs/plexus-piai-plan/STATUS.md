# pi-ai native inference path — implementation status

Branch: `chore/plexus-planning`
Last updated: 2026-06-05 (frontend verification complete)

---

## Milestone summary

| Milestone | Description | Status | Commit |
|---|---|---|---|
| M1 | Config fields, DB schema, shared utils, frontend dropdowns | Done | `daed2e41` |
| M2 | `POST /beta/v1/chat/completions` (OpenAI Stage 1) | Done | `daed2e41` |
| M3 | `POST /beta/v1/messages` (Anthropic Stage 2) | Done | `e0482297` |
| M4 | `POST /beta/v1/responses` (OpenAI Responses Stage 3) | Done | `32bfe05f` |
| M5 | `POST /v1beta/models/:model/generateContent` + `:streamGenerateContent` (Gemini Stage 4) | Done | `01276e5a` |
| Migrations | SQLite `0049_add_pi_ai_hint`, Postgres `0063_add_pi_ai_hint` | Done | `94651adc` |
| Refactor | `beta/` → `inference-v2/`; subdirectory layout; full unit test suite | Done | `01276e5a` |
| Staging validation | All 8 beta routes confirmed working (4 wire formats × streaming/non-streaming) | Done | — |
| Frontend icons | Outgoing API type icons for all 4 inference-v2 types (`google-generative-ai`, `openai-completions`, `anthropic-messages`, `openai-responses`) | Done | `fef48063` |
| M6 | Production promotion (one stage at a time) | Not started | — |

---

## What is live on the branch

### New inference path (`src/inference-v2/`)

All four wire formats are implemented and tested via the pi-ai native executor:

| Route | Stage | Wire format |
|---|---|---|
| `POST /beta/v1/chat/completions` | 1 | OpenAI chat-completions |
| `POST /beta/v1/messages` | 2 | Anthropic messages |
| `POST /beta/v1/responses` | 3 | OpenAI Responses API |
| `POST /v1beta/models/:model/generateContent` | 4 | Gemini (non-streaming) |
| `POST /v1beta/models/:model/streamGenerateContent` | 4 | Gemini (NDJSON streaming) |

### Directory layout

```
src/inference-v2/
  index.ts                     — registerInferenceV2Routes()
  shared/
    pi-ai-utils.ts             — buildThinkingOptions, resolveBaseUrl, buildPiAiModel, buildReasoningOptions
    pi-ai-executor.ts          — failover loop, cooldown, concurrency, stall, quota, usage
    fetch-tap.ts               — global fetch tap for debug raw-response capture
    __tests__/pi-ai-utils.test.ts
  openai/
    openai-to-context.ts       — OpenAI chat-completions → pi-ai Context
    context-to-openai.ts       — pi-ai → OpenAI wire (non-streaming + SSE)
    __tests__/
  anthropic/
    anthropic-to-context.ts    — Anthropic messages → pi-ai Context
    context-to-anthropic.ts    — pi-ai → Anthropic wire (non-streaming + SSE)
    __tests__/
  responses/
    responses-to-context.ts    — Responses API input → pi-ai Context
    context-to-responses.ts    — pi-ai → Responses wire (non-streaming + SSE)
    __tests__/
  gemini/
    gemini-to-context.ts       — Gemini contents → pi-ai Context
    context-to-gemini.ts       — pi-ai → Gemini wire (non-streaming + NDJSON)
    __tests__/
```

### Schema / config changes

- `providers` table: `pi_ai_provider` column (SQLite `0049`, Postgres `0063`)
- `provider_models` table: `pi_ai_model_id` column (same migrations)
- `ProviderConfigSchema` + `ModelProviderConfigSchema` in `config.ts`
- `config-repository.ts`: persists and deserialises both fields
- Frontend `Provider` interface, `ProviderAdvancedEditor`, `ProviderModelsEditor`: dropdowns for both fields
- `transformers/oauth/oauth-transformer.ts`: `buildThinkingOptions` re-exported from `inference-v2/shared/pi-ai-utils`

### Manual staging validation (2026-06-05)

All 8 beta route combinations confirmed working on `https://plexus.home.cowger.us`:

| Route | Streaming | Result |
|---|---|---|
| `POST /beta/v1/chat/completions` | No | OK |
| `POST /beta/v1/chat/completions` | Yes | OK |
| `POST /beta/v1/messages` | No | OK |
| `POST /beta/v1/messages` | Yes | OK |
| `POST /beta/v1/responses` | No | OK |
| `POST /beta/v1/responses` | Yes | OK |
| `POST /v1beta/models/:model/generateContent` | No | OK |
| `POST /v1beta/models/:model/streamGenerateContent` | Yes | OK |

Usage logs healthy. `outgoingApiType`, `tokensInput`, `tokensOutput`, and `responseStatus` all recorded correctly. Known instrumentation gaps documented in `docs/BUGS.md`.

Native Anthropic provider (`pi_ai_provider: "anthropic"`) also validated — produces `outgoingApiType: "anthropic-messages"` as expected.

### Test coverage

396 tests passing (42 test files). New tests cover all 8 parser/serialiser modules:
`openai-to-context`, `context-to-openai`, `anthropic-to-context`, `context-to-anthropic`,
`responses-to-context`, `context-to-responses`, `gemini-to-context`, `context-to-gemini`.

---

## Deployment notes

**Safe to deploy to staging.** All production routes (`/v1/...`, `/v1beta/models/...` via the
existing Transformer path) are unchanged. The new routes are additive and only activated by
clients that deliberately call `/beta/v1/...` or the inference-v2 Gemini endpoints.

Two things to be aware of:

1. **Migrations run on startup.** Both are additive `ADD COLUMN` with no NOT NULL constraints —
   safe against existing data.

2. **Global fetch tap is installed at startup** (`installFetchTap()` in `inference-v2/index.ts`).
   It wraps `globalThis.fetch` once but is a no-op pass-through for all requests that do not
   have an active inference-v2 debug session (`debugRequestIdStorage` unset). Zero behaviour
   change for Transformer-path traffic; negligible overhead.

---

## What M6 requires

M6 is production promotion — a deliberate routing/code change per stage, not a provider-hint
opt-in. Key invariants from `DESIGN.md`:

- `/v1/...` handlers stay Transformer-only. Do not add `pi_ai_provider` checks there.
- `/beta/v1/...` (or the promoted replacement) stays pi-ai-only. No Transformer fallback.
- No cross-execution-family failover within a single request.
- Rollback is a routing/code rollback, not a config edit.

Tasks: T6.1 (chat), T6.2 (passthrough boundary verification), T6.3 (messages),
T6.4 (responses), T6.5 (Gemini), T6.6 (rollback verification), T6.7 (deprecation notes),
T6.8 (optional: unify OAuth + key-auth executors). See `M6.md` for full detail.

Each stage's promotion should be validated against live staging traffic before the next
stage is promoted.
