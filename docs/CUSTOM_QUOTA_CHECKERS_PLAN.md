# Plan: Custom (Plugin) Quota Checkers

## Goal

Let admins write their own quota checker logic (pasted JS) instead of requiring
a maintainer-authored file for every new provider integration.

## Current state

Today a quota checker is fully hard-coded (31 checkers in
`packages/backend/src/services/quota/checkers/`). Per the repo's
`add-quota-checker` skill, shipping one new checker touches 8 places:

- `checkers/{name}-checker.ts` (implements `defineChecker()`)
- manual `await import(...)` line in `loadAllCheckers()` (`checker-registry.ts`)
- an `optionsSchema` z.object + a literal entry in `ProviderQuotaCheckerSchema`'s
  `discriminatedUnion` (`config.ts`)
- a Postgres enum value (`drizzle/schema/postgres/enums.ts`)
- a `{Name}QuotaConfig.tsx` form component
- a `QUOTA_CONFIG_MAP` entry in `ProviderQuotaEditor.tsx`
- validation logic in `useProviderForm.tsx`

The actual checker contract is small: `check(ctx): Promise<Meter[]>` where
`ctx` gives `getOption`/`requireOption`/`balance()`/`allowance()`, and the
checker body is just `fetch()` + shape the response (see
`synthetic-checker.ts`). That's exactly the kind of logic an admin
integrating their own provider could write, if they didn't have to go
through the whole pipeline above.

## Decisions made

- **Threat model: trusted admins only.** Self-hosted / single-operator or
  trusted team already has full config + secrets access. We are protecting
  against bugs (infinite loops, crashes, hangs), not against a malicious
  admin. This means **worker-thread isolation is sufficient** — we do not
  need a true capability sandbox (wasm/QuickJS) for v1.
- **Language: JS only for v1.** No transpile step. TypeScript support can be
  added later via Bun's transpiler if wanted.
- Note for the record: `isolated-vm` (the usual Node sandboxing answer)
  doesn't work here — it's a V8 embedder addon and this project runs on Bun
  (JavaScriptCore), not Node/V8. Ruled out.

## Target shape

One generic custom checker definition stored under the same text `type` field
used by built-in checkers that:

- stores **source code** + basic metadata in the DB instead of a file on disk
- is interpreted/executed at check time instead of imported
- reuses the exact same `MeterContext` API (`balance`, `allowance`,
  `getOption`, `requireOption`) and adds configured `fetch` helpers so a plugin author can write
  what's in `synthetic-checker.ts` today, just pasted instead of committed

Plugin source is constrained to a **function body**, not a full ES module —
e.g. the admin pastes the body of `async check(ctx) { ... }`, executed via
`new Function('ctx', code)`. This avoids import/module-resolution entirely
(no `import fs from 'fs'`, no reaching for arbitrary npm packages), which
keeps the execution model simple and avoids a whole class of footguns.

## Design update: `type` becomes plain text, not an enum/discriminated union

This applies to *all* checkers (built-in and custom), not just the plugin
path, and is a bigger simplification than originally scoped:

- **Postgres**: `quotaCheckerType` is currently `quotaCheckerTypeEnum(...)`
  (`drizzle/schema/postgres/providers.ts:40`) — the only place a Postgres
  enum exists for checker type. SQLite already stores it as plain `text()`.
  Drop the enum; make the column `text` on both dialects. One migration,
  done once, never touched again for new checker types.
- **`config.ts`**: replace `ProviderQuotaCheckerSchema`'s discriminated union
  (currently ~30 literal branches, each with its own duplicated
  `{Name}QuotaCheckerOptionsSchema`) with one generic shape:
  ```ts
  z.object({
    type: z.string(),
    enabled: z.boolean().default(true),
    intervalMinutes: z.number().min(1).default(30),
    id: z.string().trim().min(1).optional(),
    options: z.record(z.string(), z.any()).default({}),
  })
  ```
- **Validation moves from static schema to the registry.** Each checker
  already declares `optionsSchema` on its `CheckerDefinition`
  (`checker-registry.ts:49`) — today it's unused for validation, and
  `config.ts` maintains a separate, drifting duplicate (e.g.
  `synthetic-checker.ts`'s own schema includes `apiKey`;
  `SyntheticQuotaCheckerOptionsSchema` in `config.ts` doesn't). Instead: in
  the provider-save route (`routes/management/config.ts:197`/`230`, where
  `ProviderConfigSchema.safeParse` already runs), after the loose parse
  succeeds, look up `getCheckerDefinition(type)` from the registry and run
  `def.optionsSchema.safeParse(options)`. Single source of truth, no drift,
  zero maintenance per checker going forward. Unknown `type` (not in the
  registry) is rejected here too.

**Net effect on the existing 8-step checklist**: this removes the
`config.ts` schema step *and* the Postgres enum step for **every** checker,
not just custom ones. New built-in checkers drop to 2 backend steps (file +
`loadAllCheckers()` import) until `import.meta.glob` lands, then 1.

**For custom checkers specifically**: no `customCheckerId` indirection or
reserved `type: 'custom'` literal needed — a custom checker registers into
the same `REGISTRY` under its own admin-chosen type string (e.g.
`'acme-quota'`), exactly like a built-in one. Add a guard at registration
time: reject a custom checker whose type string collides with an existing
registry key (built-in or another custom checker).

## Implementation plan

### 1. DB layer

- New table `custom_checkers`: `id`/`type` (text PK — the registry key),
  `displayName`, `code` (text, function body), `enabled`, `createdAt`,
  `updatedAt`.
- `quotas.type` (and the Postgres `providers.quota_checker_type` column) is
  now plain `text` per the design update above — no schema change needed to
  reference a custom checker vs a built-in one, they look identical to the
  rest of the system.
- Drizzle schema files for both `sqlite` and `postgres` dialects + migration
  (generated, not hand-written — per repo convention).

### 2. Execution (`checker-registry.ts` + new `custom-checker-runtime.ts`)

- `loadCustomCheckers()`: reads enabled rows from `custom_checkers`,
  registers each as a `CheckerDefinition` in the same `REGISTRY`, keyed by
  its own `type` string. Reject registration if `type` collides with an
  existing registry key (built-in or another custom checker). `check(ctx)`
  delegates to the sandboxed runner.
- Runner: spins up a Bun `Worker` per invocation, enforces a hard timeout
  (default e.g. 10s, configurable), `terminate()`s the worker on timeout.
  Surfaces timeout vs runtime-error vs syntax-error distinctly.
  - `ctx.balance()`/`ctx.allowance()` build `Meter` objects and can't cross
    the worker `postMessage` boundary as live functions. Two options:
    - (a) worker returns raw `{key,label,unit,...}` param objects, main
      thread calls `ctx.balance()`/`ctx.allowance()` after the fact, or
    - (b) reconstruct an equivalent lightweight `MeterContext` shim inside
      the worker (duplicate the pure derivation logic from
      `checker-registry.ts`).
      Prefer (a) — keeps a single source of truth for meter-shape derivation.
  - Custom code should prefer `ctx.fetch(url, init)` or
    `ctx.requestHeaders()` with ambient `fetch`. The configured provider
    API key, auth header/prefix, and additional headers are applied by these
    helpers; the raw key is not displayed in the UI.
- Needs a reload path so editing a plugin doesn't require a server restart —
  mirror the existing `QuotaScheduler.reload()` pattern.

### 3. Management API (`packages/backend/src/routes/management/`)

- CRUD for `custom_checkers` (list/create/update/delete/enable-disable).
- A dry-run endpoint, e.g. `POST /v0/management/custom-checkers/:id/test`,
  that executes against provided options without persisting a snapshot —
  needed since admins won't have a compile step to catch mistakes otherwise.

### 4. Frontend

- New admin page/section: code editor (plain textarea is fine for v1) +
  generic JSON key/value options editor, replacing the need for a bespoke
  `{Name}QuotaConfig.tsx` per plugin.
- `ProviderQuotaEditor.tsx`: one `custom` entry in `QUOTA_CONFIG_MAP` pointing
  at the generic editor instead of one entry per plugin type.
- Wire the dry-run/test button to the new endpoint so authors get fast
  feedback without waiting for the schedule interval.

### 5. Docs

- Short "write your own quota checker" doc for the custom/plugin path —
  document the `ctx` API, the timeout, and that only `fetch`/`ctx` are
  available (no `require`, no npm packages). Existing `add-quota-checker`
  skill stays as-is for first-party/bundled checkers.

## What this removes from the current 8-step checklist

For admin-authored (custom) checkers, steps 2–4 and 6–7 of the current
checklist disappear entirely: no manual `loadAllCheckers()` import, no
`config.ts` schema/enum edits, no per-type frontend form/`QUOTA_CONFIG_MAP`
entry, no `useProviderForm.tsx` validation. Only truly first-party/bundled
checkers still go through the old file-based path.

## Future work (out of scope for v1)

- True capability sandbox (wasm/QuickJS with a controlled `fetch` bridge,
  no ambient `process`/`fs`/env access) — only worth the investment if this
  becomes multi-tenant / untrusted-admin.
- TypeScript authoring support (via Bun's transpiler, validated/compiled at
  save time).
