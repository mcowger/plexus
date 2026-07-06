# NOMOV2 — Retire the v2 (pi-ai) inference path, harden v1

Status: implemented. Author-driven; solo project ("I", not "we").

Current checkpoint:
- `a6af66ba` — retires `inference-v2`, removes beta/custom pi-ai surfaces, relocates the
  retained pi-ai helpers and Claude masking code into v1, and adds `auto_compat` support.
- `04ee17a5` — commits the generated `auto_compat` migrations.
- Verification at commit time: pre-commit hooks passed, including changed backend tests,
  frontend build, workspace typecheck, biome checks, and migration-name linting. Full M2
  verification also passed `bun run test`, `bun run typecheck`, `bun run format:check`,
  and browser verification of provider/model Auto Compat controls.
- Documentation follow-up: `docs/CONFIGURATION.md` and OpenAPI provider/pi-ai discovery
  schemas now document builtin registry linkage, `auto_compat`, `pi_ai_provider`, and
  `pi_ai_model_id`.

## Why (one paragraph)
The v2 / `inference-v2` path was an experiment built on `@earendil-works/pi-ai` as the
core intermediate representation (IR). The goal was to get provider *compatibility*
handling (reasoning-effort mapping, message-role quirks, per-model thinking config) "for
free" from pi-ai's model registry. That part works well. The cost is structural: pi-ai
forces every request through a normalizing `Context`/`Tool`/`Message` model, so any
wire feature pi-ai doesn't model (OpenAI `custom`/freeform tools like `apply_patch`,
server-side tools, new fields) is silently dropped unless bypassed with extract-before /
re-inject-after hacks (`builtinTools`, `passthroughTools`, `fetch-tap`). A gateway's job
is fidelity, so the IR is the wrong core. v1 (the `dispatcher`) already has a
**pass-through** design (raw body in same-format flows, raw bytes out, synthetic parse
for usage only) that preserves fidelity *and* keeps observability. Decision: delete v2,
keep pi-ai only as a **library** (model registry + OAuth token management + the compat
math), and fold the genuinely-good v2 pieces back into v1.

This doc covers three milestones:
1. Remove the v2 inference path (routes, beta gating, UI, tests).
2. Make provider/model adapters registry-aware so compat mapping is automatic, not
   hand-authored per model.
3. Port the recent Claude-masking improvements from v2 into v1.

Deferred (later, explicitly out of scope here): general v1 cleanup; folding OAuth2 token
management out of pi-ai.

---

## Critical cross-cutting constraint: preserve-before-delete

`inference-v2/shared/` contains code that **v1 already depends on** or that milestones
2 and 3 need. These MUST be relocated out of `inference-v2/` before M1 deletes the tree:

- **`inference-v2/shared/pi-ai-utils.ts`** — imported by v1 today:
  - `transformers/oauth/oauth-transformer.ts:8` → `piAiModels`
  - `transformers/oauth/oauth-transformer.ts:31` → `buildThinkingOptions`
  - `routes/management/pi-ai-custom.ts:7` → `registerCustomProvidersWithPiAi`
    (**this importer is being deleted** — custom providers do not survive, see M1)
  It is also the **M2 compat source** (`buildReasoningOptionsForModel` and helpers).
  When relocating, keep `piAiModels` (`builtinModels()`), `buildThinkingOptions`, and the
  compat functions; **drop** `registerCustomProvidersWithPiAi` + the `createProvider` /
  `API_IMPLEMENTATIONS` custom-provider machinery.
- **`inference-v2/shared/tool-fingerprint/**`** — currently v2-only (no importers outside
  `inference-v2/`), but it is the **M3 masking payload** to port into v1.
- Supporting type/util modules that the above pull in (verify closure during impl):
  `inference-v2/shared/reasoning.ts` (`ReasoningIntent`, `normalizeEffort`, …),
  `inference-v2/shared/generation.ts` (`GenerationIntent`).
- **`fetch-tap.ts` is NOT relocated — it is deleted with v2.** It only existed to give
  pi-ai an `onReceive`-style response hook it lacked. v1's dispatcher owns the raw HTTP
  response and already exposes `postDispatch` + stream-chunk hooks, so any server-tool
  salvage still required rides those native hooks instead.

**Note:** v1's OAuth/Claude-masking route already executes through pi-ai
(`dispatcher.isPiAiRoute()` → `dispatchOAuthRequest()` → `oauth-transformer.ts`). So
"remove v2" ≠ "remove pi-ai". pi-ai stays as a dependency for: the model registry
(`@earendil-works/pi-ai/providers/all`), OAuth token lifecycle
(`@earendil-works/pi-ai/oauth`), and the OAuth/masking execution in `dispatchOAuthRequest`.

### Recommended execution order
1. **M3 relocation first** (or concurrently with M1 scaffolding): move
   `tool-fingerprint/**` + the compat/reasoning modules to a permanent v1 home, wire M3.
2. **M1** deletion of the remaining `inference-v2/` tree + beta gating + UI once nothing
   outside points into it.
3. **M2** can proceed in parallel with M1 once `pi-ai-utils` compat functions live at
   their new home; it does not depend on the deletion.

New homes (decided — function-grouped):
- `pi-ai-utils.ts` compat/registry helpers → `services/pi-ai/` (e.g.
  `services/pi-ai/registry.ts`, `services/pi-ai/reasoning-compat.ts`).
- `tool-fingerprint/**` + masking orchestration → `transformers/oauth/masking/`.

---

## Milestone 1 — Remove the v2 inference path

Status: done.

### Goal
Delete `inference-v2/`, the `/beta/*` routes, the per-key `beta` routing branch, the
beta key flag end-to-end (schema/db/API/UI), and all v2-only tests. Preserve the shared
modules per the constraint above.

### How v2 is currently reached (two entry points)
1. **Per-key beta flag on standard endpoints** — each v1 route handler short-circuits to
   a v2 handler when the key is beta-flagged:
   - `routes/inference/chat.ts:32` → `handleBetaChatCompletions` (import at `:17`)
   - `routes/inference/messages.ts:30` → beta handler
   - `routes/inference/responses.ts:41` → beta handler
   - `routes/inference/gemini.ts:31` → beta handler
2. **Explicit `/beta/*` routes** — `routes/inference/index.ts:16,43`
   `registerInferenceV2Routes`, which registers (in `inference-v2/index.ts:852+`):
   - `POST /beta/v1/chat/completions`
   - `POST /beta/v1/messages`
   - `POST /beta/v1/responses`
   - `POST /beta/v1beta/models/:modelWithAction` (Gemini generate/stream)

### Backend changes
- **Route handlers**: remove the `if (keyConfig?.beta === true) return handleBeta*()`
  branch and the `handleBeta*` import from `chat.ts`, `messages.ts`, `responses.ts`,
  `gemini.ts`. (Leave the rest of each handler intact.)
- **Route registration**: remove `registerInferenceV2Routes` import + call in
  `routes/inference/index.ts:16,43`.
- **Beta key flag** — DECISION: leave the `keys.beta` **DB column dormant** (no migration,
  no drop), but remove it from the schema reads/writes, API surface, and UI:
  - `config.ts:1024` `beta: z.boolean().optional()` — remove from the key config schema so
    it is no longer read/written or exposed via management API.
  - `db/config-repository.ts:1050, 1105, 1131` — remove the `beta` read/write mapping (the
    column stays in the table but is no longer touched).
  - `utils/auth.ts:18` `beta?: boolean` on `keyConfig` — remove.
  - `routes/management/_principal.ts:41,108,126` and `routes/management/self.ts:75` — remove.
  - **No migration.** Per project rules migrations are never hand-written; since we are
    leaving the column dormant, none is generated. (A cleanup migration can be a future
    task if desired.)
- **Delete** `packages/backend/src/inference-v2/**` EXCEPT the relocated modules (see
  constraint). After relocation, update the remaining importer (`oauth-transformer.ts`)
  to the new paths. (`routes/management/pi-ai-custom.ts` is deleted — see below.)

### `pi_ai_custom_*` config + PiRegistry — DO NOT SURVIVE (decision)
Custom pi-ai providers/models are removed. Keep ONLY `pi_ai_model_id` (the link from a
Plexus model to a **builtin** pi-ai registry entry, needed by M2).
- **Remove**: `config.ts:1132` `pi_ai_custom_providers`, `config.ts:1133`
  `pi_ai_custom_models`, their Zod schemas (`PiAiCustomProviderSchema`,
  `PiAiCustomModelSchema`), and the validation block at `config.ts:1282-1318`.
- **Remove**: `registerCustomProvidersWithPiAi` (in `pi-ai-utils.ts`) and its startup call.
- **Remove**: `routes/management/pi-ai-custom.ts` (management route) and its registration.
- **Keep**: `pi_ai_model_id` (`config.ts:301`) → resolves builtin registry metadata via
  `getBuiltinModel()` for M2. Models without a resolvable builtin entry → M2 compat no-ops.
- **DB/config**: any persisted `pi_ai_custom_*` config becomes dormant/ignored (same
  leave-in-place approach as `keys.beta`); audit `db/config-repository.ts` for read/write
  of these keys and stop touching them.

### Frontend changes (`packages/frontend/src`)
- `pages/Keys.tsx` — remove the beta toggle in the key editor, the beta badges, and the
  beta search term.
- `pages/Playground.tsx` — remove the beta/standard key badge.
- `pages/MyKey.tsx` — remove `beta?: boolean` + the "Beta/Stable" display.
- `pages/Config.tsx` — remove the "Applies to `/beta/` (inference-v2) routes" note (and
  audit whether that whole config section is beta-only).
- `pages/PiRegistry.tsx` — **remove the page entirely** (custom providers/models do not
  survive). Remove its route/nav entry and any `pi_ai_custom_*` API calls in `lib/api.ts`.
- `lib/api.ts` — remove `beta?: boolean` from the key config types + the read/write
  mapping; remove the custom-provider/model API client functions.
- Rebuild CSS/assets per AGENTS.md if any styling changes; verify UI with the
  `frontend-testing` skill after edits.

### Tests
- Delete all v2 suites: `inference-v2/__tests__/**`, `inference-v2/shared/__tests__/**`,
  `inference-v2/{responses,openai,anthropic,gemini}/__tests__/**`.
- `inference-v2/shared/tool-fingerprint/__tests__/**` — **relocate** with the code (M3),
  don't delete.
- Update `db/__tests__/config-repository-multi-quota.test.ts` (references `beta: false`)
  and any key-config fixtures.
- **Keep** `services/__tests__/dispatcher-claude-masking.test.ts` and the
  `transformers/__tests__/oauth-*` tests — these are v1.
- Grep integration tests under `packages/backend/test` for `/beta/` and remove/retarget.
- Run: `bun run test`, `bun run typecheck`, `bun run format:check`.

### Docs / spec
- Audit OpenAPI/redocly (`redocly.yaml`, `docs/`) for `/beta/*` paths and the beta key
  field; update once code is settled.

### Risks / ordering
- Deleting `inference-v2/` before relocating `pi-ai-utils` + `tool-fingerprint` will break
  v1's OAuth transformer and M3. Relocate first.
- Dropping `keys.beta` is a migration; sequence the schema change carefully and generate
  (never hand-write) the migration.

---

## Milestone 2 — Registry-aware adapters (automatic compat)

Status: done.

### Goal
Reasoning/thinking/temperature compat mappings should be derived **automatically** from
the pi-ai model registry per model, instead of requiring users to hand-author
`reasoning_rewrite` adapter rules.

### Current state
- **Adapter layer**: `types/provider-adapter.ts` — `ProviderAdapter` receives only
  `(payload, options)`, *not* the route/model. Hooks: `preDispatch`, `postDispatch`,
  `preDispatchStreamChunk`, `postDispatchStreamChunk`.
- **Resolution**: `services/adapter-resolver.ts` — adapters come from
  `route.config.adapter` + `route.modelConfig.adapter` (config-driven, per provider/model).
- **Registry**: `ADAPTER_REGISTRY` in `transformers/adapters/index.ts`:
  `reasoning_content`, `suppress_developer_role`, `model_override`, `reasoning_rewrite`,
  `web_search_coercion`. All declarative; `reasoning_rewrite` uses hand-authored threshold
  maps.
- **Dispatcher integration**: `services/dispatcher.ts`
  - `shouldUsePassThrough()` `~2686-2710` (passthrough when
    `incomingApiType === targetApiType` and `originalBody` present; disabled for pi-ai
    routes and vision fallthrough).
  - `transformRequestPayload()` `~2716-2805` — passthrough branch clones `originalBody`
    (`:2731`) and sets `model`; transform branch calls `transformer.transformRequest`.
    Adapters applied at `:2792-2795`. `route`, `route.model`, `route.canonicalModel`,
    `route.modelConfig`, `targetApiType`, `request.incomingApiType` are all in scope.
- **Compat math (to port)**: `inference-v2/shared/pi-ai-utils.ts`
  `buildReasoningOptionsForModel()` (`~327-429`), `buildEnabledOptions()`, `intentToEffort`.
  Dependencies: `clampThinkingLevel`, `getSupportedThinkingLevels` (from
  `@earendil-works/pi-ai`), `getBuiltinModel` (from `.../providers/all`), types
  `Model as PiAiModel`, `ModelThinkingLevel`. It is a **pure function of model metadata +
  intent**; no Context/execution coupling (verified). The `createProvider` /
  `API_IMPLEMENTATIONS` block in the same file is execution wiring — not part of the port.
- **Registry link**: model config already has `pi_ai_model_id` (`config.ts:301`) → the
  **builtin** registry entry to resolve for a given model. With custom providers removed
  (M1), compat resolves only against pi-ai's builtin registry; a model without a
  `pi_ai_model_id` that maps to a builtin entry → compat step no-ops (graceful skip).

### Design / changes
1. **Relocate** the compat functions from `pi-ai-utils.ts` into a v1 home (e.g.
   `services/pi-ai/reasoning-compat.ts`) as pure functions.
2. **Add a registry-driven compat step in the dispatcher**, NOT as a vanilla adapter
   (adapters lack route/model). Implement it directly in `transformRequestPayload`, in
   **both** the passthrough branch and the transform branch, where `route.model` /
   `route.modelConfig.pi_ai_model_id` is in scope:
   - Resolve `getBuiltinModel(pi_ai_model_id)` → registry metadata.
   - Extract the client's reasoning intent from the payload (see net-new below).
   - Compute provider fields via `buildReasoningOptionsForModel(model, intent)` and merge
     into `providerPayload` (clamped to what THIS model supports; drop temperature when
     `compat.supportsTemperature === false`).
   - Revisit how this should interact with hand-authored `reasoning_rewrite` adapters.
     They are duplicative with registry-driven compat and should not remain as a parallel
     long-term configuration surface without a deliberate decision.
3. **Net-new work — intent extraction from raw body.** The passthrough path has no
   pre-parsed `ReasoningIntent`. Add a small per-`incomingApiType` reader:
   - chat/completions: `reasoning_effort`
   - responses: `reasoning.effort` / `reasoning.summary`
   - anthropic messages: `thinking` (+ budget)
   Reuse `inference-v2/shared/reasoning.ts` normalizers (relocate them too).
4. **Config**: keep existing declarative adapters working unchanged. Gate the new compat
   step behind **`auto_compat: true`** (opt-in) at provider/model level — default off, so
   no behavior change on upgrade. When enabled but a model has no resolvable builtin
   `pi_ai_model_id`, the step is a no-op (skip compat, no error).

### Frontend
- Provider/model config forms — surface `pi_ai_model_id` (kept) and the new `auto_compat`
  toggle. (`PiRegistry.tsx` is removed in M1.) Verify with `frontend-testing` skill.

### Tests
- Unit-test the ported compat functions (mirror
  `inference-v2/shared/__tests__/pi-ai-executor.test.ts` reasoning cases) at the new home.
- Dispatcher tests: passthrough + transform both inject correct provider reasoning fields
  per model; no-op when `pi_ai_model_id` absent; temperature gating; any decided
  interaction with existing `reasoning_rewrite` adapters.
- Follow project test rules (unit tests in `__tests__/` beside source; `registerSpy`;
  `resetForTesting()`; `bun run test`, never `bun test`).

### Risks
- Duplicative behavior between auto-compat and existing `reasoning_rewrite` configs —
  revisit whether custom rewrites should be removed, narrowed, or treated as an explicit
  escape hatch, then pin that decision with tests.
- Registry drift: a model missing/renamed in the pi-ai registry must degrade gracefully
  (skip compat), not throw.

---

## Milestone 3 — Port Claude-masking improvements into v1

Status: done.

### Goal
Bring v2's richer Anthropic "Claude Code" masking (tool-fingerprint rename registry,
identity/system-prompt replacement, full beta-flag set, billing/CCH signing, server-tool
salvage) into the v1 OAuth/masking path, and relocate `tool-fingerprint/**` out of
`inference-v2/`.

### Current state
- **v1 OAuth/masking already runs through pi-ai**:
  - `dispatcher.isOAuthRoute()` (`api_base_url` starts with `oauth://`) and
    `isClaudeMaskingApiKeyRoute()` (`route.config.useClaudeMasking === true` && messages)
    → `isPiAiRoute()` (`:1772`).
  - `isPiAiRoute` disables passthrough (`shouldUsePassThrough` `:2701`) and dispatches via
    `dispatchOAuthRequest()` (`:512-522`) using the `oauth` transformer.
  - `transformers/oauth/oauth-transformer.ts` does today's masking: detects Claude Code
    token (`isClaudeCodeToken = apiKey.includes('sk-ant-oat')`, `:342`), anthropic-specific
    handling at `:364` and `:442`; imports `piAiModels` + `buildThinkingOptions` from
    `pi-ai-utils`.
- **v2 richer masking (the delta to port)** lives in:
  - `inference-v2/shared/tool-fingerprint/**` — `cc-identity.ts`, `cc-metadata.ts`,
    `cc-constants.ts`, `sign-billing.ts`, `mcp-shape.ts`, `registry.ts`, `apply-masking*`.
  - `inference-v2/shared/pi-ai-executor.ts` `onPayload` (`~1060-1094`):
    `applyClaudeCodeMasking()` (system-prompt/identity replacement, synthetic tool
    injection + dedupe, tool renames, CCH signing), `toolRenamePairs`,
    `getStainlessHeaders()`, `REQUIRED_BETAS` (full 8-flag list vs pi-ai's default 2),
    `reverseToolRenames()` on the response, and `watchForServerToolBlocks()` /
    `inference-v2/shared/fetch-tap.ts` (salvage server-tool blocks pi-ai can't model).

### Delta table (v2 has / v1 lacks)
| Capability | v2 | v1 today |
|---|---|---|
| Tool-fingerprint rename registry + reverse on response | yes (`tool-fingerprint/registry.ts`, `reverseToolRenames`) | partial/none — confirm in `oauth-transformer.ts` |
| Identity / system-prompt replacement | yes (`cc-identity.ts`, `apply-masking`) | confirm |
| Full `anthropic-beta` flag set (`REQUIRED_BETAS`) | yes | pi-ai default (2 flags) |
| Synthetic tool injection + dedupe | yes | confirm |
| Billing / CCH signing | yes (`sign-billing.ts`) | confirm |
| Server-tool block salvage | yes (`fetch-tap.ts` monkeypatch) | via native `postDispatch`/stream hooks if needed (no fetch-tap) |

(Confirm each "v1 today" cell by diffing `oauth-transformer.ts` against `apply-masking`
during impl — treat the table as the checklist.)

### Changes
1. **Relocate** `inference-v2/shared/tool-fingerprint/**` to `transformers/oauth/masking/`
   (`fetch-tap.ts` is dropped, not moved). Move the masking orchestration
   (`applyClaudeCodeMasking`, `getStainlessHeaders`, `REQUIRED_BETAS`, `reverseToolRenames`)
   out of `pi-ai-executor.ts` into a v1-callable module.
2. **Wire into the v1 OAuth path**: apply the masking pipeline at the point v1 builds the
   outbound OAuth payload — inside `dispatchOAuthRequest()` / `oauth-transformer.ts`
   (the v1 equivalent of v2's `onPayload`), for `provider === 'anthropic'` +
   Claude-Code-token / `useClaudeMasking` routes. Set `anthropic-beta` from
   `REQUIRED_BETAS`.
3. **Response side**: apply `reverseToolRenames()` on both non-streaming and streaming
   responses using v1's native `postDispatch` / `postDispatchStreamChunk` hooks. If
   server-tool block salvage is still required, implement it on the same native hooks
   (fetch-tap is gone).
4. Because this path is Anthropic-messages-only and already non-passthrough, it does not
   interact with the M2 passthrough compat step; keep them separate.

### Tests
- Relocate `tool-fingerprint/__tests__/**` with the code.
- Keep/extend `services/__tests__/dispatcher-claude-masking.test.ts`,
  `transformers/__tests__/oauth-anthropic-stream-regression.test.ts`,
  `transformers/__tests__/oauth-type-mappers.test.ts`.
- Add coverage for: rename round-trip (request rename → response reverse), beta-flag set,
  identity replacement, signing.

### Token management — unchanged (noted, not done here)
OAuth token lifecycle lives in `services/oauth-auth-manager.ts`,
`services/oauth-login-session.ts`, and `@earendil-works/pi-ai/oauth`. Out of scope;
independent of the masking port. Deferred folding of token management is future work.

### Risks
- Streaming reverse-rename correctness (the historical regression covered by
  `oauth-anthropic-stream-regression.test.ts`) — guard with tests before/after the move.
- Relocation must land before M1 deletes `inference-v2/`.

---

## Decisions made
- **`keys.beta`**: leave the DB column **dormant** (no migration); remove from schema
  reads/writes, API surface, and UI.
- **Custom pi-ai providers/models**: **do not survive** — remove
  `pi_ai_custom_providers/models`, `registerCustomProvidersWithPiAi`, the
  `pi-ai-custom.ts` route, and `PiRegistry.tsx`. Keep `pi_ai_model_id` (builtin registry
  linkage for M2). Persisted `pi_ai_custom_*` config becomes dormant/ignored.
- **`fetch-tap.ts`**: **deleted with v2**, not relocated. It only compensated for pi-ai
  lacking an `onReceive` hook; v1's `postDispatch`/stream-chunk hooks replace it.
- **Auto-compat default**: **opt-in** — off unless a provider/model sets
  `auto_compat: true`. No behavior change for existing deployments on upgrade.
- **Module homes**: **function-grouped** — compat + registry glue → `services/pi-ai/`
  (e.g. `services/pi-ai/registry.ts`, `services/pi-ai/reasoning-compat.ts`); Claude-masking
  (relocated `tool-fingerprint/**` + orchestration) → `transformers/oauth/masking/`.

## Open questions
_All resolved — see "Decisions made" above._

## Definition of done
- No code path reaches `inference-v2/`; directory deleted; `beta` key flag gone end-to-end
  from schema reads/writes, API surface, routing, and UI. The dormant `keys.beta` DB column
  remains intentionally untouched; no drop migration was generated.
- `auto_compat` has generated SQLite/Postgres migrations committed separately in
  `04ee17a5`.
- OAuth/Claude routes retain (and improve on) current masking behavior via the relocated
  pipeline; all OAuth/masking tests green.
- Reasoning/thinking/temperature compat is applied automatically from the registry on both
  passthrough and transform paths, with declarative adapters still working as overrides.
- `bun run test`, `bun run typecheck`, `bun run format:check` all pass; frontend verified
  via the `frontend-testing` skill.
