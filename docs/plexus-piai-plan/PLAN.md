# PLAN.md — Plexus pi-ai Native Transformation: Milestone Index

**Companion to:** `DESIGN.md` (the authoritative design). This plan decomposes
that design into ordered milestones with concrete, verifiable tasks. Read
`DESIGN.md` first for rationale; read the per-milestone files (`M1.md` …
`M6.md`) for the task breakdown.

**Audience:** an implementer who will execute one milestone at a time. Each
task says *what* to do and *where*, names the real symbols/files involved, and
states how to verify it — but stops short of dictating full code. Where a
decision is open, the task says so and points at the design section that owns
it.

---

## Ground rules (apply to every milestone)

These come from `AGENTS.md` and the verified state of the repo. Re-read before
starting any milestone.

- **Working dir:** all backend paths below are relative to
  `packages/backend/src/` unless stated otherwise. Frontend paths are under
  `packages/frontend/src/`.
- **Never commit/push/PR** unless the user explicitly asks, each time.
- **DB migrations:** never hand-write SQL, never edit existing migrations,
  never run `drizzle-kit generate` directly. Edit the Drizzle schema, then run
  `bun run generate-migrations --name <name>` (on `main`, `--name` is
  required) and `bun run lint:migrations`. Read the `db-schema-migrations`
  skill first.
- **Tests:** unit tests in `__tests__/` beside the source; integration tests in
  `test/integration/`. Run with `bun run test` (never `bun test`). Use
  `registerSpy` from `test/test-utils.ts`. `utils/logger` and
  `@earendil-works/pi-ai` are **globally mocked** in `test/vitest.setup.ts` —
  do not re-mock them. Reset singletons via `resetForTesting()` in
  `beforeEach`. Read the `vitest` skill first.
- **Frontend CSS/assets:** follow the Tailwind rules in `AGENTS.md` (build via
  `@tailwindcss/cli`, no CSS imports into `.ts`/`.tsx`).
- **Verification gates per milestone:** `bun run typecheck`, `bun run test`,
  `bun run format:check`, and (when migrations change) `bun run
  lint:migrations` must all pass before a milestone is considered done.

---

## Verified baseline (as of this plan)

These facts were confirmed against the working tree and `node_modules`. They
correct or sharpen statements in `DESIGN.md`:

- **pi-ai is pinned to `0.78.1`** in `packages/backend/package.json` (bumped
  from `0.77.0`). Backend `bun run typecheck` passes clean on `0.78.1`. The
  API surface the design relies on is present and unchanged:
  `getModel`, `getModels`, `stream`, `complete`, `calculateCost` (from
  `models`/`stream`), and the types `Context`, `AssistantMessage`,
  `AssistantMessageEvent`, `ProviderStreamOptions` (= `StreamOptions &
  Record<string, unknown>`), `Model`, `TextContent`, `ImageContent`,
  `ThinkingContent`, `ToolCall`, `ToolResultMessage`, `UserMessage`.
- **`jsonSchemaToTypeBox` is NOT a pi-ai export.** It is a Plexus-internal
  helper that currently lives **unexported** at
  `transformers/oauth/type-mappers.ts:234`. The PoC imported it from
  `type-mappers`. M1 must export it (or relocate it) so the beta parsers can
  share it. Do not expect it from `@earendil-works/pi-ai`.
- **`buildThinkingOptions` is NOT a pi-ai export.** It is a Plexus function at
  `transformers/oauth/oauth-transformer.ts:44`. M1 moves it to
  `beta/pi-ai-utils.ts` and leaves a re-export behind.
- **No `beta/` directory exists on `main`.** It is created in M1/M2.
- **Config has no pi-ai fields yet.** `ProviderConfigSchema` (config.ts
  ~L558–620) and `ModelProviderConfigSchema` (config.ts ~L168–180) lack
  `pi_ai_provider` / `pi_ai_model_id`. `pi_model` exists separately at
  config.ts:767 (alias-level, unrelated — do not conflate).
- **DB schemas** (`drizzle/schema/{postgres,sqlite}/providers.ts` and
  `provider-models.ts`) have no pi-ai columns yet.
- **Route registration:** beta routes register inside the protected block of
  `routes/inference/index.ts` (after `registerResponsesRoute`, ~L37), so they
  inherit the auth hook + bearer auth.
- **PoC reference branch:** `feat/piai-parallel-chat-completions-inference-path`
  contains `src/beta/{run.ts,openai-to-context.ts,context-to-openai.ts,index.ts}`.
  `run.ts` (~330 lines) is the Stage-1 executor *without* full Dispatcher
  integration. Read it as reference; do not build on it.

All Dispatcher/Router/Cooldown/Concurrency/Stall/Quota/Usage/Debug/Responses
symbols named in `DESIGN.md`'s "Full Dispatcher Integration" section were
confirmed to exist with the expected signatures (see `DESIGN.md` and the
per-milestone files for exact references).

---

## Milestone map

The milestones are ordered by dependency. M1 is a hard prerequisite for all
others. M2 establishes the executor + beta pattern that M3–M5 reuse almost
verbatim. M6 is production promotion planning and can begin per-stage as soon as
the corresponding beta stage is validated.

| Milestone | Title | Depends on | Outcome |
|---|---|---|---|
| **M1** | Foundation: config, DB, repo, frontend, shared utils | — | pi-ai hint fields exist end-to-end (schema → DB → repo → UI); shared `beta/pi-ai-utils.ts` extracted; `jsonSchemaToTypeBox` exported; startup validation. No request path changes yet. |
| **M2** | Stage 1: `/beta/v1/chat/completions` + full executor | M1 | The stage-agnostic `beta/pi-ai-executor.ts` with the complete Dispatcher integration (failover, cooldown, concurrency, stall, quota, usage, debug, raw-response capture), plus OpenAI inbound/outbound and the beta route. |
| **M3** | Stage 2: `/beta/v1/messages` (Anthropic) | M2 | Anthropic inbound/outbound + beta route reusing the M2 executor. |
| **M4** | Stage 3: `/beta/v1/responses` (OpenAI Responses) | M2 | Responses inbound/outbound + beta route, including `previous_response_id`/`conversation` loading and post-response storage via the `onSuccess` hook. |
| **M5** | Stage 4: `/v1beta/.../generateContent` (Gemini) | M2 | Gemini inbound/outbound + beta route, including NDJSON streaming and stream-action detection. |
| **M6** | Forced production promotion & deprecation | per-stage M2–M5 | Per-stage routing/code event that makes the validated beta/pi-ai route family production-facing; rollback story; Transformer deprecation (not deletion). |

---

## The beta parallel-path pattern (shared by M2–M5)

Every stage adds, under `beta/`:
1. An **inbound parser** `beta/<wire>-to-context.ts` — wire format → pi-ai
   `Context` + a `ProviderStreamOptions` fragment.
2. An **outbound serialiser** `beta/context-to-<wire>.ts` — `AssistantMessage`
   / `AssistantMessageEvent` → the client's wire format (object for
   non-streaming, frame strings for streaming).
3. A **route** `POST /beta/v1/...` registered in `beta/index.ts`, which:
    calls `debug.startLog`, runs quota middleware, parses inbound, invokes the
    **shared executor** (`beta/pi-ai-executor.ts`), and writes the JSON or
    stream. It considers only candidates with valid `pi_ai_provider` /
    `pi_ai_model_id` hints and fails closed if no beta-compatible candidate is
    available.

The executor (built once in M2) is wire-format-agnostic: it owns routing,
failover, cooldown, concurrency, stall detection, usage, and debug. Stages
differ only in their parser, serialiser, `incomingApiType` tag, and (for M4)
the streaming-detection source and (for M4) NDJSON vs SSE framing, plus (M4)
the `onSuccess` storage hook.

This is **zero-regression** during beta validation: existing `/v1/...` inference
routes are untouched and remain exclusively on the Transformer path. There is no
failover across execution families: `/beta/v1/...` requests never fall back to
the legacy Transformer path, and `/v1/...` requests never use the pi-ai path.

---

## How to use the milestone files

Each `Mn.md` contains:
- **Goal & exit criteria** — what "done" means and how to prove it.
- **Tasks** — numbered, each with: files touched, what to change, key real
  symbols to use, and a per-task verification note.
- **Open decisions** — choices the design left to implementation time, with the
  recommended default and the design section that owns the call.
- **Test plan** — the unit/integration tests this milestone must add.
- **Risks / gotchas** — verified footguns (base-URL stripping, option loss via
  `streamSimple`, registry-miss panics, concurrency release on streaming,
  raw-response capture, etc.).

Work milestones top to bottom. Do not start a milestone until its dependencies'
exit criteria are met.
