# OpenAPI Documentation Plan

Goal: bring `docs/openapi/openapi.yaml` (the multi-file split entry point) to full parity with `docs/API.md` (and beyond),
then delete `docs/API.md`. The target is **Option C** from the audit: every
operation, schema property, parameter, and enum is documented, plus global
narrative sections that replace the reference tables currently in API.md.

The work is grouped into **15 independent phases**. Phase 1 ships shared
vocabulary used by later phases; the rest can be done in any order. Each
phase has an explicit scope, a checklist, and a "done" test.

## Current coverage snapshot (baseline)

Measured on `docs/openapi/openapi.yaml` (split entry point — individual paths live in `docs/openapi/paths/`, schemas in `docs/openapi/components/schemas/`):

| Artifact             | Total | Documented | Gap  |
|----------------------|------:|-----------:|-----:|
| Operations           |   107 |         38 |   69 |
| Schema properties    |   289 |         21 |  268 |
| Parameters           |    78 |         17 |   61 |
| Enums (per-value)    |    41 |          0 |   41 |

Re-run the audit any time with:

```bash
bun -e '
import yaml from "yaml"; import fs from "fs";
// Bundle first so $refs are resolved, then parse
const doc = yaml.parse(require("child_process").execSync("npx @redocly/cli bundle docs/openapi/openapi.yaml --format yaml 2>/dev/null").toString());
let ops=0,opsNoDesc=0; for(const[p,pi]of Object.entries(doc.paths))for(const m of["get","post","put","delete","patch"])if(pi[m]){ops++;if(!pi[m].description)opsNoDesc++}
let props=0,propsNoDesc=0; for(const s of Object.values(doc.components.schemas))for(const p of Object.values(s.properties||{})){props++;if(!p.description)propsNoDesc++}
console.log({opsNoDesc,ops,propsNoDesc,props})
'
```

## Working process per phase

1. Read the relevant source files listed under **Source material**.
2. Edit the relevant file under `docs/openapi/` (`paths/` for operations, `components/schemas/` for schemas) — descriptions only, never touch the endpoint list, schema structure, or lint config.
3. Run `bun run lint:openapi` (lints `docs/openapi/openapi.yaml`) — must pass with 0 warnings.
4. Optional: `bun run preview:openapi` (`npx @redocly/cli preview-docs docs/openapi/openapi.yaml`) to visually confirm before committing.
5. Tick the phase off in the checklist at the bottom of this file.

## Global invariants (enforced by every phase)

- Do not rename schema paths or change their shape. Edits are pure annotation.
- When the underlying source has authoritative wording (e.g. a JSDoc block
  above a route handler), quote it verbatim where possible — don't paraphrase
  away nuance.
- For pass-through inference endpoints, link to the upstream provider docs and
  only describe **Plexus-specific** additions (routing, cache headers,
  attribution, storage), not re-documenting the whole OpenAI/Anthropic schema.
- Every description ends with a period. Every enum value is introduced with a
  bullet on its own line.
- When a phase adds global narrative, put it in `info.description` or on the
  relevant tag, not duplicated across every operation.

---

## Phase 1 — Shared vocabulary (foundation, do first)

**Why first:** these definitions are referenced by every subsequent phase.
Doing them once in `info.description` and on `components.schemas` lets other
phases cross-reference instead of duplicating.

### Scope

Add a structured `info.description` replacing the current inline block, and
annotate all shared enums with per-value semantics.

### Checklist

- [x] `info.description` — reorganize into sections, keep the existing
      auth/public endpoint content, plus:
  - [x] Attribution suffix (`:label`) behaviour and where it surfaces
        (`usage.attribution`, `api_key_attribution_*` metrics).
  - [x] Principal model — `admin` vs `limited`, what each can see,
        `?keyName=` override on `/self/*` routes.
  - [x] Environment variables that affect behaviour: `ADMIN_KEY`,
        `CONFIG_FILE`, `LOG_LEVEL`, `DEBUG`, `PLEXUS_METRICS_CACHE_TTL_MS`,
        `DATABASE_URL`, encryption env. Point to `docs/CONFIGURATION.md`
        for the full list.
  - [x] Header forwarding — which client headers get forwarded, stripped,
        echoed into `plexus_metadata.clientHeaders` (`x-app`, `session_id`,
        `x-client-request-id`).
- [x] Document every enum value for the following schemas (add to the
      enum's `description`, one bullet per value):
  - [x] `UsageRecord.costSource` — `default | simple | openrouter | defined | per_request`
  - [x] `UsageRecord.responseStatus` — `success | error | pending`
  - [x] `UsageRecord.incomingApiType` — `chat | messages | responses | gemini | embeddings | transcriptions | speech | images | oauth`
  - [x] `QuotaSample.windowType` — `subscription | hourly | five_hour | daily | weekly | monthly | custom`
  - [x] `QuotaSample.status` — `ok | warning | critical | exhausted` (include utilisation thresholds from API.md)
  - [x] `UserQuotaDefinition.type` — `rolling | daily | weekly`
  - [x] `UserQuotaDefinition.limitType` — `requests | tokens`
  - [x] `AliasConfig.type` — `chat | messages | responses | gemini | embeddings | transcriptions | speech | image`
  - [x] `OAuthSession.status` — `waiting | prompt | manual-code | complete | failed | cancelled`
  - [x] `SpeechRequest.voice` — list every voice and which models each is compatible with
  - [x] `SpeechRequest.response_format` / `stream_format`
  - [x] `McpUsageRecord.method` — `GET | POST | DELETE` plus what each means for the MCP proxy
- [x] Add reference tables (Markdown) inside tag descriptions for:
  - [x] Tag `Management — Quotas (Provider)` → window types and status
        thresholds (port from API.md "Reference Tables").
  - [x] Tag `Management — Usage` → cost-source semantics.
  - [x] Tag `Inference — Chat` (or a new overview tag) → retry/cooldown
        model one-paragraph summary with link to the Usage tag.

### Source material

- `packages/backend/src/utils/calculate-costs.ts`
- `packages/backend/src/types/usage.ts`
- `packages/backend/src/services/cooldown-manager.ts`
- `packages/backend/src/services/quota/types.ts`
- `packages/backend/src/config.ts` (Zod schemas)
- `docs/API.md` (Reference Tables section)

### Done when

`lint:openapi` passes; rerun the baseline audit query — `enumsWithDesc`
counter should jump from 0 to ≥ 12.

---

## Phase 2 — Core inference endpoints

### Scope

The 9 pass-through inference routes under `/v1/*` and `/v1beta/*`. For each,
add operation `description`, request-body `description`, and property-level
docs for the **Plexus-specific** fields (not the full upstream schema).

### Checklist

- [ ] `POST /v1/chat/completions` — expand description: transformer pipeline
      one-line summary, how routing works (`model` → alias → target), cache
      routing headers, attribution, streaming behaviour (SSE format).
- [ ] `POST /v1/messages` — same treatment; note Anthropic-specific quirks
      (`system` as top-level, `max_tokens` required, tool_use blocks).
- [ ] `POST /v1/responses` — full description: `previous_response_id` vs
      `conversation` merge semantics, `store` default, `prompt_cache_key`
      behaviour, `x-client-request-id` / `session_id` headers. Add a
      multi-turn example.
- [ ] `POST /v1/codex/responses` — cross-reference `/v1/responses`; note it
      exists solely for Codex CLI compatibility.
- [ ] `GET /v1/responses/{response_id}` and `DELETE` — add descriptions; note
      the 7-day cleanup job.
- [ ] `GET /v1/conversations/{conversation_id}` — describe the stored items
      array and where it's populated from.
- [ ] `POST /v1beta/models/{modelWithAction}` — clarify path-param format,
      supported actions, alpha/beta behaviour differences.
- [ ] `POST /v1/embeddings` — flag pass-through, note embeddings cost
      calculation, required `type: embeddings` on the alias.
- [ ] `POST /v1/audio/transcriptions` — multipart field semantics, file size
      limit, MIME allow-list, `response_format` values.
- [ ] `POST /v1/audio/speech` — model-compatibility matrix for
      `instructions` and `stream_format: sse`, binary response MIMEs per
      `response_format`.
- [ ] `POST /v1/images/generations` — describe every parameter including
      provider-specific `quality` / `style` values.
- [ ] `POST /v1/images/edits` — multipart mask semantics, PNG requirement.

Schemas to annotate property-by-property:

- [ ] `ChatCompletionRequest`, `ChatCompletionResponse`
- [ ] `AnthropicMessagesRequest`, `AnthropicMessagesResponse`
- [ ] `ResponsesRequest`, `ResponsesResponse`
- [ ] `GeminiGenerateContentRequest`, `GeminiGenerateContentResponse`
- [ ] `EmbeddingsRequest`, `EmbeddingsResponse`
- [ ] `TranscriptionRequest`
- [ ] `SpeechRequest`
- [ ] `ImageGenerationRequest`, `ImageEditRequest`, `ImageResponse`

### Source material

- `packages/backend/src/routes/inference/*.ts`
- `packages/backend/src/transformers/*` (for which fields are
  transformer-aware)
- `docs/RESPONSES_API.md`

### Done when

All 9 `/v1/*` and 1 `/v1beta/*` operations have descriptions ≥ 80 chars;
all listed schemas have 100% property-doc coverage.

---

## Phase 3 — Model discovery & metadata

### Scope

Public inference endpoints for listing and searching models.

### Checklist

- [ ] `GET /v1/models` — describe alias enrichment rules (what requires a
      `metadata` block), note direct-syntax aliases (`provider/model`) are
      excluded, explain `additional_aliases` behaviour.
- [ ] `GET /v1/openrouter/models` — note startup-loaded catalog requirement.
- [ ] `GET /v1/metadata/search` — document source catalogs
      (`openrouter | models.dev | catwalk`), why `custom` is rejected, and
      load-state 503 behaviour.
- [ ] `GET /v1/metadata/lookup` — describe return shape, typical UI use
      case (auto-populate override form).
- [ ] Schemas `ModelList`, `ModelListEntry`, `NormalizedModelMetadata` —
      per-property descriptions (what counts as `architecture`, `pricing`
      value units, supported_parameters semantics).

### Source material

- `packages/backend/src/routes/inference/models.ts`
- `packages/backend/src/services/model-metadata-manager.ts`
- `packages/backend/src/services/pricing-manager.ts`

---

## Phase 4 — Usage & observability schemas

### Scope

The highest-value property-documentation work: `UsageRecord` alone has 40+
fields that are currently undocumented.

### Checklist

- [ ] `UsageRecord` — every field. Use the table in API.md as the starting
      point, then cross-reference `packages/backend/src/types/usage.ts` and
      `drizzle/schema/sqlite/request-usage.ts` to ensure accuracy.
      Specifically call out:
  - Token fields' provenance (what reports them, when they're estimated).
  - `retryHistory` / `allAttemptedProviders` JSON encoding.
  - `kwhUsed` calculation source (needs `model_architecture` on alias).
  - `hasDebug` / `hasError` — which tables they mirror.
- [ ] `UsageSummary` — per-field docs on `series[]`, `stats`, `today`
      sub-objects. Note `stats` is always a 7-day window, `today` is local
      midnight, `range` only affects `series`.
- [ ] `DebugLog` — describe each of the raw/transformed/snapshot pairs and
      when each is populated.
- [ ] `McpUsageRecord` — every field, especially `jsonrpc_method` vs
      `tool_name` and when either is null.
- [ ] `Cooldown` — clarify that `expiry` is absolute epoch ms and
      `timeRemainingMs` is derived.
- [ ] `PerformanceRow` — explain sample aggregation window, what `sample_count`
      excludes (errors, streamed failures).

### Source material

- `packages/backend/src/types/usage.ts`
- `packages/backend/drizzle/schema/sqlite/*.ts`
- `packages/backend/src/services/usage-storage.ts`
- `packages/backend/src/services/cooldown-manager.ts`
- `packages/backend/src/services/debug-manager.ts`

---

## Phase 5 — Usage / debug / errors / MCP-logs endpoints

### Scope

All read/delete operations backed by the storage services, plus their query
parameters. This is where limited-principal scoping rules matter most.

### Checklist

- [ ] `GET /v0/management/usage` — describe every query parameter
      (`sortBy` valid values, `fields` projection, `*Date` formats, filter
      semantics, limited-principal force-scoping).
- [ ] `GET /v0/management/usage/summary` — bucket-size adaptive algorithm,
      `range=custom` rules, scoping note.
- [ ] `DELETE /v0/management/usage` — admin-only note, `olderThanDays`
      semantics.
- [ ] `DELETE /v0/management/usage/{requestId}` — admin-only, 404 rules.
- [ ] `GET /v0/management/concurrency` — full dual-mode explanation, the
      100-bucket cap, `groupBy` trade-offs, `durationMs IS NULL` semantics
      for `live` mode.
- [ ] `GET /v0/management/events` — SSE event types (`started`, `updated`,
      `completed`, legacy `created`), payload shape for each, ping interval,
      scoping.
- [ ] `GET /v0/management/debug` — describe both response shapes (admin vs
      limited), how `providers` filter interacts with per-key toggles.
- [ ] `PATCH /v0/management/debug` — mutation semantics; mention that
      limited users must use `/self/debug/toggle` instead.
- [ ] `GET /v0/management/debug/logs` and `GET /v0/management/debug/logs/{requestId}`
      — capture lifecycle, what triggers log creation, retention.
- [ ] `DELETE` variants — admin scoping.
- [ ] `GET /v0/management/errors` and `DELETE` variants — capture triggers,
      retention.
- [ ] `GET /v0/management/mcp-logs` and `DELETE` variants — `serverName`
      filter usage, retention.
- [ ] `GET /v0/system/logs/stream` — SSE `syslog` event shape, level filter
      behaviour (does current level affect stream? yes — document it),
      ping.

### Source material

- `packages/backend/src/routes/management/usage.ts`
- `packages/backend/src/routes/management/debug.ts`
- `packages/backend/src/routes/management/errors.ts`
- `packages/backend/src/routes/management/mcp-logs.ts`
- `packages/backend/src/routes/management/system-logs.ts`
- `packages/backend/src/routes/management/_principal.ts`

---

## Phase 6 — Configuration CRUD

### Scope

Schemas `Config`, `ProviderConfig`, `AliasConfig`, `KeyConfig`,
`McpServerConfig` and every CRUD operation that reads/writes them.

### Checklist

- [ ] Property docs on every config schema. These are the
      user-facing shape of `plexus.yaml`, so accuracy matters. Pull
      descriptions from the Zod schema `.describe()` calls in
      `packages/backend/src/config.ts` — they are already authoritative.
- [ ] Operation descriptions:
  - [ ] `GET /v0/management/config` — JSON shape, vs `/config/export`.
  - [ ] `GET /v0/management/config/status` — meaning of
        `adminKeyFromYaml`, migration context.
  - [ ] `GET /v0/management/config/export` — YAML shape.
  - [ ] `GET|PATCH /v0/management/config/vision-fallthrough` — what
        vision fallthrough does at dispatch time.
  - [ ] `GET|PATCH /v0/management/system-settings` — general bulk-merge
        semantics, link to `docs/CONFIGURATION.md`.
  - [ ] `GET|PUT|PATCH|DELETE /v0/management/providers/*` — wildcard
        slug routing, validation rules, cascade behaviour. Describe
        `?cascade=true` result keys (`removedTargets`, `affectedAliases`)
        which API.md calls out but the spec currently doesn't expose.
  - [ ] `POST /v0/management/providers/fetch-models` — SSRF rules,
        10 s timeout, Ollama/OpenAI normalisation.
  - [ ] `GET /v0/management/aliases` + `PUT|PATCH /v0/management/aliases/{slug}`
        — energy recalculation side-effect when `model_architecture`
        changes.
  - [ ] `DELETE /v0/management/models` + `/models/{aliasId}` — cascade
        note.
  - [ ] `GET /v0/management/keys` + `PUT|DELETE /v0/management/keys/{name}`
        — what fields get encrypted, rotation interaction with `/self/rotate`.
  - [ ] `GET|PUT|DELETE /v0/management/mcp-servers*` — name regex,
        which fields affect proxy auth.
  - [ ] `GET /v0/management/quota-checker-types` — relationship to
        `ProviderConfig.quota.type` enum.

### Source material

- `packages/backend/src/config.ts`
- `packages/backend/src/services/config-service.ts`
- `packages/backend/src/routes/management/config.ts`
- `packages/backend/src/routes/management/providers.ts`
- `docs/CONFIGURATION.md`

---

## Phase 7 — Self-service / principal

### Scope

The `/v0/management/self/*` family plus `/auth/verify`. All of these have
dual behaviour (admin with `?keyName=` vs limited).

### Checklist

- [ ] `GET /v0/management/auth/verify` — both response shapes documented
      with their trigger conditions.
- [ ] `GET /v0/management/self/me` — admin vs limited shape, what
      `traceEnabled` vs `traceEnabledGlobal` mean operationally.
- [ ] `POST /v0/management/self/rotate` — new-secret-in-response
      lifecycle, auditing, that historical data stays attached to the
      key name (not the secret).
- [ ] `PATCH /v0/management/self/comment` — freeform field, no length
      limit.
- [ ] `POST /v0/management/self/debug/toggle` — per-key capture vs
      global, precedence rules.
- [ ] `GET /v0/management/self/quota` — describe why this returns 200
      with nulls when no quota is assigned (UI rendering requirement).

### Source material

- `packages/backend/src/routes/management/self.ts`
- `packages/backend/src/routes/management/_principal.ts`

---

## Phase 8 — OAuth provider onboarding

### Scope

The 8 `/v0/management/oauth/*` endpoints. Currently a bare list; needs a
session-lifecycle diagram and per-route behaviour.

### Checklist

- [ ] Tag-level description on `Management — OAuth` — embed a state-machine
      diagram (ASCII) showing `waiting → prompt ↔ manual-code → complete`,
      plus `cancelled` / `failed` terminals. Note which providers use the
      callback server (`usesCallbackServer: true`) vs which require manual
      code paste.
- [ ] `GET /v0/management/oauth/providers` — list which providers are
      supported, their nicknames, callback-server support.
- [ ] `POST /v0/management/oauth/sessions` — `providerId`/`accountId`
      semantics; why `accountId` matters (multi-account support).
- [ ] `GET /v0/management/oauth/sessions/{id}` — describe the `authInfo`,
      `prompt`, `progress` fields and when each is populated.
- [ ] `POST /v0/management/oauth/sessions/{id}/prompt` — which `status`
      values accept a prompt submission; value format.
- [ ] `POST /v0/management/oauth/sessions/{id}/manual-code` — providers
      that need this (Codex CLI, Claude Code), expected format.
- [ ] `POST /v0/management/oauth/sessions/{id}/cancel` — state after cancel.
- [ ] `DELETE /v0/management/oauth/credentials` — disk location, impact on
      pending sessions, 404 conditions.
- [ ] `GET /v0/management/oauth/credentials/status` — polling semantics.
- [ ] `GET /v0/management/oauth/models` — cross-reference to pi-ai static
      catalog.
- [ ] `OAuthSession` schema — every field + sub-object documented.

### Source material

- `packages/backend/src/routes/management/oauth.ts`
- `packages/backend/src/services/oauth-login-session.ts`
- `packages/backend/src/services/oauth-auth-manager.ts`
- `@mariozechner/pi-ai` package docs

---

## Phase 9 — Provider quotas

### Scope

The 4 `/v0/management/quotas*` routes plus their schemas. Centre of gravity
is `QuotaCheckerSnapshot` and `QuotaSample`.

### Checklist

- [ ] `GET /v0/management/quotas` — note the path difference vs API.md's
      old `/v0/quotas/*`, polling cadence, which providers contribute
      snapshots.
- [ ] `GET /v0/management/quotas/{checkerId}` — same shape, single checker.
- [ ] `GET /v0/management/quotas/{checkerId}/history` — `since` parameter
      both formats (ISO and `Nd`), `windowType` filter effect.
- [ ] `POST /v0/management/quotas/{checkerId}/check` — triggers an
      immediate check outside the scheduler cadence, doesn't bypass
      provider-side rate limits.
- [ ] `QuotaCheckerSnapshot` and `QuotaSample` — every field, with unit
      conventions (`dollars`, `tokens`, `requests`, `percentage`).
- [ ] Document `checkerCategory` (`balance | rate-limit`) — what each
      renders as in the UI.

### Source material

- `packages/backend/src/routes/management/quotas.ts`
- `packages/backend/src/services/quota/quota-scheduler.ts`
- `packages/backend/src/services/quota/checkers/*`

---

## Phase 10 — User quotas / enforcement

### Scope

Definition CRUD plus the two enforcement endpoints, plus the 429 error
shape.

### Checklist

- [ ] Tag-level description on `Management — Quotas (User)` — definition
      lifecycle, how `keys[*].quota` wires a key to a definition,
      assignment-vs-enforcement separation.
- [ ] CRUD operations — describe name regex, PUT-vs-PATCH semantics,
      409 conflict behaviour on delete.
- [ ] `POST /v0/management/quota/clear` — audit note, what counters reset.
- [ ] `GET /v0/management/quota/status/{key}` — both response shapes
      (assigned vs unassigned), why it returns 200 for "no quota".
- [ ] `UserQuotaDefinition` — `type` × `duration` combinations, what
      `limitType: tokens` counts (sum of `tokensInput + tokensOutput +
      tokensCached + tokensCacheWrite`, or just input?).
- [ ] Document the 429 `quota_exceeded` response as a shared example
      (already referenced in inference endpoints via
      `#/components/responses/QuotaExceeded`) — flesh out when it's
      returned.

### Source material

- `packages/backend/src/services/quota/quota-enforcer.ts`
- `packages/backend/src/services/quota/quota-middleware.ts`
- `packages/backend/src/routes/management/user-quotas.ts`
- `packages/backend/src/routes/management/quota-enforcement.ts`

---

## Phase 11 — Admin operational endpoints

### Scope

`/metrics`, `/logging`, `/restart`, `/test`, `/performance`, `/cooldowns`,
`/models/huggingface`. Small individually but operationally important.

### Checklist

- [ ] `GET /v0/management/metrics` — enumerate every Prometheus metric
      family (there are ~40), grouped by domain (cumulative, today,
      per-provider, per-model, perf, cooldown, in-flight). Port from the
      source file comments. Mention the cache header.
- [ ] `GET|PUT|DELETE /v0/management/logging/level` — supported levels,
      runtime-only caveat, `startupLevel` derivation.
- [ ] `POST /v0/management/restart` — process-manager assumption, SIGTERM
      vs hard-exit behaviour.
- [ ] `POST /v0/management/test` — template per `apiType`, why it returns
      200 even on failure (UI consumption), `direct/<provider>/<model>`
      bypass.
- [ ] `GET|DELETE /v0/management/performance` — aggregation pipeline,
      which table stores it, delete scope (per-model).
- [ ] `GET /v0/management/cooldowns` + `DELETE` variants — trigger
      conditions (consecutive failures), backoff curve, admin-only clear
      rationale, scoping exceptions for `disable_cooldown`.
- [ ] `GET /v0/management/models/huggingface/{modelId}` — what uses it
      (energy estimator), rate-limit behaviour, caching.

### Source material

- `packages/backend/src/routes/management/metrics.ts`
- `packages/backend/src/routes/management/logging.ts`
- `packages/backend/src/routes/management/restart.ts`
- `packages/backend/src/routes/management/test.ts`
- `packages/backend/src/routes/management/performance.ts`
- `packages/backend/src/routes/management/cooldowns.ts`
- `packages/backend/src/routes/management/models.ts`
- `packages/backend/src/services/huggingface-model-fetcher.ts`

---

## Phase 12 — MCP proxy

### Scope

`/mcp/{name}` (GET/POST/DELETE) plus OAuth discovery (`.well-known/*`,
`/register`).

### Checklist

- [ ] Tag-level description on `MCP Proxy` — header forwarding rules
      (stripping `Authorization`/`x-api-key`, using config-static
      `headers`), redaction behaviour, session semantics.
- [ ] `POST /mcp/{name}` — JSON-RPC request/response flow, when the
      response is streamed (`text/event-stream`) vs JSON, 502/504 triggers.
- [ ] `GET /mcp/{name}` — SSE stream lifecycle, query-string passthrough.
- [ ] `DELETE /mcp/{name}` — upstream session termination semantics.
- [ ] `.well-known/*` routes — document what metadata each returns, and
      why they exist (MCP client compat, not functional OAuth).
- [ ] `POST /register` — static response explanation.

### Source material

- `packages/backend/src/routes/mcp/index.ts`
- `packages/backend/src/services/mcp-proxy/mcp-proxy-service.ts`

---

## Phase 13 — Errors & common responses

### Scope

Strengthen the shared component responses so inference endpoints don't need
to re-document them individually.

### Checklist

- [ ] `OpenAIError` schema — document every sub-field (`type`, `code`,
      `param`, `routing_context.provider`, etc.) and which routes populate
      `routing_context`.
- [ ] `AuthErrorBody` — when `type: auth_error` vs `type: forbidden` is
      returned.
- [ ] `ValidationError` (response) — shape of `details[]` (Zod issue
      objects), point at
      `packages/backend/src/config.ts` schemas.
- [ ] `QuotaExceeded` — cross-reference to Phase 10; list every route that
      can emit it.
- [ ] `ProviderError` — scenarios (upstream 5xx, network error, dispatcher
      exhausted retries) and what fields survive.

---

## Phase 14 — Examples

### Scope

Add concrete request/response examples for every endpoint that currently
has none (most). Redocly's rendered output becomes much more useful with
examples.

### Checklist

- [ ] One `examples:` entry per inference endpoint that doesn't already
      have one — minimum one simple call, one with tools if applicable.
- [ ] Streaming example snippets in the endpoint description (curl
      invocation plus 2–3 SSE frames).
- [ ] Multi-turn `/v1/responses` example chain (initial response,
      continuation via `previous_response_id`).
- [ ] Attribution suffix example on `/v1/chat/completions`.
- [ ] Request/response examples for management CRUD (provider save,
      alias save, key save) — the Zod error shape on validation failure
      is the most useful because it's non-obvious.
- [ ] EventSource usage snippets in description bodies of the two SSE
      endpoints.
- [ ] Prometheus scrape example output (10–20 lines).

---

## Phase 15 — Cut-over

### Scope

Final plumbing to retire `docs/API.md` without information loss.

### Checklist

- [ ] Grep API.md for any facts not yet in the spec and port the
      remaining ones (final diff).
- [ ] Add a `docs/` README section or top-of-file comment in
      `docs/openapi/openapi.yaml` linking the rendered spec preview command
      (`bun run preview:openapi`) and build
      command (`npx @redocly/cli build-docs docs/openapi.yaml -o docs/api.html`
      — note: `docs/openapi.yaml` is CI-generated; run `bun run bundle:openapi` locally first).
- [ ] Update top-level `README.md` and `AGENTS.md` — any links to
      `docs/API.md` become links to `docs/openapi/openapi.yaml` (or the rendered
      HTML).
- [x] Add a CI step (GitHub Actions) that runs `bun run lint:openapi` and
      regenerates `docs/openapi.yaml` on every merge to `main` touching `docs/openapi/`
      (`generate-openapi-bundle.yml`). PRs that touch the generated bundle are
      blocked by `check-no-openapi-bundle-in-pr.yml`.
- [ ] Delete `docs/API.md`.
- [ ] Update any CHANGELOG entries or migration notes.

### Done when

Repo-wide grep for `docs/API.md` returns nothing; `bun run lint:openapi`
green; rendered `preview-docs` reads as the primary reference.

---

## Phase index / tracking

| #  | Phase                                  | Status       | Notes |
|---:|----------------------------------------|--------------|-------|
|  1 | Shared vocabulary (enums + info.desc)  | ✅ done        | 14 enums annotated, info.description rewritten |
|  2 | Core inference endpoints                | ✅ done        | All endpoints documented, schemas annotated |
|  3 | Model discovery & metadata              | ✅ done        | + openrouter startup req, schema property docs |
|  4 | Usage & observability schemas           | ✅ done        | All schemas fully documented (40+ fields) |
|  5 | Usage / debug / errors / MCP-logs       | ✅ done        | Endpoint descriptions, scoping, retention, params |
|  6 | Configuration CRUD                      | ✅ done        | Config schemas + all CRUD operations documented |
|  7 | Self-service / principal                | ✅ done        | /self/* endpoints, dual admin/limited behavior |
|  8 | OAuth provider onboarding               | ✅ done        | Session lifecycle diagram, all 10 endpoints documented |
|  8 | OAuth provider onboarding               | ⬜ not started |       |
|  9 | Provider quotas                         | ⬜ not started |       |
| 10 | User quotas / enforcement               | ⬜ not started |       |
| 11 | Admin operational endpoints             | ⬜ not started |       |
| 12 | MCP proxy                               | ⬜ not started |       |
| 13 | Errors & common responses               | ⬜ not started |       |
| 14 | Examples                                | ⬜ not started |       |
| 15 | Cut-over (delete API.md)                | ⬜ not started |       |

Status legend: ⬜ not started · 🟨 in progress · ✅ done
