# Quota & Balance Tracking Redesign

> Status: **Proposal** — no code changes have been made. This document is the
> design that the implementation should be measured against.

## 1. Problem Statement

Plexus currently tracks two related-but-distinct things under one umbrella:

1. **Account balances** — prepaid amounts that get drawn down as the user
   makes requests, do not refill on a schedule, and are topped up out-of-band
   (e.g. OpenRouter credits, Naga balance, Moonshot cash, Apertis PAYG).
2. **Subscription quotas / rate limits** — recurring entitlements bound to a
   billing cycle or rolling window (e.g. Claude Code 5-hour + weekly limits,
   Codex primary/secondary, Copilot monthly premium interactions).

The current model collapses these into a single `QuotaWindow[]` shape with a
fixed `category: 'balance' | 'rate-limit'` per checker. That works for the
simple cases but breaks down quickly:

- Some providers expose **both at once** (Neuralwatt: dollar credit balance
  *and* a monthly kWh subscription quota; Apertis: a PAYG balance *and* a
  coding-plan cycle quota — solved today by registering two separate
  checkers).
- Some "balances" are actually **bounded** with a known total (Wisdom Gate
  reports `total_usage` and `total_available` — i.e. it's really a cycle
  quota that the code labels as `subscription`/`balance`).
- Some "subscriptions" are denominated in **dollars** (Synthetic weekly
  credits in `$`), some in **points** (Zenmux flows, Poe points), some in
  **percentage only** (Claude Code, Codex, Antigravity, Gemini-CLI), some in
  **tokens** (NanoGPT), and some in **requests** (Copilot, Apertis-coding,
  MiniMax-coding, Kimi-code).
- Some providers have **multiple independent meters** with different units
  (NanoGPT: weekly tokens + daily tokens + daily images; ZAI: 5h tokens +
  monthly MCP requests; Synthetic: rolling-5h requests + hourly search
  requests + rolling-weekly dollars).
- The `unit: 'points'` value is overloaded — Neuralwatt uses it for kWh and
  the frontend has a special-case branch (`if (unit === 'kwh') ...`) that
  never matches the actual data.

The implementation has accumulated workarounds:

- A `BALANCE_CHECKERS_WITH_RATE_LIMIT = new Set(['neuralwatt'])` literal
  duplicated in `Sidebar.tsx` and `Quotas.tsx` to coerce one "balance"
  checker into also appearing in the rate-limit section.
- A `windowType` enum with overlapping/aliased members
  (`five_hour`/`rolling_five_hour`, `weekly`/`rolling_weekly`,
  `subscription`/`monthly`, `custom`) where `subscription` is overloaded to
  mean "this is a balance row, not a periodic quota."
- Per-checker hardcoded display lists in `CompactQuotasCard.getTrackedWindowsForChecker`
  picking which windows to render for each provider.
- 21+ display components, one per checker, most of which differ only in
  which icon and which `windowType` strings they reach for.

The goal of this document is to design a **single, flexible data model** that
can describe every existing provider and any reasonable future one without
needing per-checker conditionals in either the schema or the UI.

## 2. Survey of the 23 Existing Checkers

The matrix below normalises what each checker actually returns. Rows are
grouped by structural shape, not by current `category` label.

### 2.1 Pure prepaid balances (one number, no reset)

| Checker      | Unit    | API exposes                  | Notes                                  |
|--------------|---------|------------------------------|----------------------------------------|
| `naga`       | dollars | `balance`                    |                                        |
| `kilo`       | dollars | `balance`                    |                                        |
| `moonshot`   | dollars | `available_balance`          | Also has cash/voucher subtotals        |
| `novita`     | dollars | `availableBalance`           | Stored in 1/10000 USD, divided in code |
| `minimax`    | dollars | `available_amount`           | Cookie auth                            |
| `apertis`    | dollars | `payg.account_credits`       | Same endpoint as `apertis-coding-plan` |
| `openrouter` | dollars | `total_credits - total_usage`| Computes remaining locally             |
| `poe`        | points  | `current_point_balance`      | Points, not dollars                    |

Today these all emit `windowType: 'subscription'`, `category: 'balance'`,
`limit: undefined`, `used: undefined`, `remaining: <value>`, no `resetsAt`.

### 2.2 Bounded balances with a known total (still no time reset)

| Checker      | Unit    | Exposes                                                            |
|--------------|---------|--------------------------------------------------------------------|
| `wisdomgate` | dollars | `total_usage`, `total_available` → code derives `limit = used + remaining` |

Currently emitted as `windowType: 'subscription'` with a `limit`.
Semantically it's still a balance — it just has a known historical total.

### 2.3 Subscription quotas with a single periodic window

| Checker               | Window      | Unit                       | Notes                                                  |
|-----------------------|-------------|----------------------------|--------------------------------------------------------|
| `copilot`             | monthly     | requests **or** percentage | Falls back to % when entitlement missing               |
| `apertis-coding-plan` | monthly     | requests                   | `cycle_*` fields                                       |
| `minimax-coding`      | "custom"    | requests                   | API field is misnamed; remaining lives in `usage_count`|
| `gemini-cli`          | "five_hour" | percentage                 | Aggregated per-model bucket                            |
| `antigravity`         | "five_hour" | percentage                 | Per-model rows                                         |

### 2.4 Subscription quotas with multiple independent windows

| Checker        | Windows                                                       | Units                                |
|----------------|---------------------------------------------------------------|--------------------------------------|
| `claude-code`  | 5-hour + 7-day                                                | percentage, percentage               |
| `openai-codex` | primary (5-hour) + secondary (7-day)                          | percentage, percentage               |
| `zenmux`       | rolling-5h flows + rolling-7-day flows                        | points, points                       |
| `ollama`       | session (5-hour) + weekly                                     | percentage, percentage               |
| `kimi-code`    | "usage" + N variable rate-limit windows                       | requests                             |
| `zai`          | 5-hour tokens + monthly MCP requests                          | percentage, requests                 |
| `nanogpt`      | weekly input tokens + daily input tokens + daily images       | tokens, tokens, requests             |
| `synthetic`    | rolling-5h requests + hourly search + rolling-weekly credits  | requests, requests, dollars          |

### 2.5 Hybrid: balance **and** subscription quota together

| Checker      | Balance side                       | Subscription side                                       |
|--------------|------------------------------------|---------------------------------------------------------|
| `neuralwatt` | dollar credits remaining (PAYG)    | monthly kWh quota (`unit:'points'` today, mislabelled)  |

This is the case the current model fails most clearly: the checker's single
`category` field is `'balance'`, and the frontend has to special-case
`neuralwatt` in two different `BALANCE_CHECKERS_WITH_RATE_LIMIT` sets to also
render its monthly window in the rate-limit section.

`apertis` and `apertis-coding-plan` sidestep this by being registered as two
*separate* checkers hitting the same endpoint — paying twice for the API
call and producing twice the snapshots.

## 3. Concrete Inconsistencies in the Current Model

Pulled from `packages/backend/src/types/quota.ts`, the checker
implementations, the schema, and the frontend.

### 3.1 `category` is on the wrong object

`QuotaChecker.category: 'balance' | 'rate-limit'` is a *checker-level*
attribute. But "balance vs. rate-limit" is a property of an individual
**meter**, not the API endpoint that returns them. Neuralwatt has both;
Wisdom Gate is recorded as `balance` even though its bounded shape is
indistinguishable from a quota. Apertis only escapes this by being split
into two checkers.

### 3.2 `windowType` conflates four different axes

`QuotaWindowType =
  'subscription' | 'hourly' | 'five_hour' | 'rolling_five_hour' |
  'toolcalls' | 'search' | 'daily' | 'weekly' | 'rolling_weekly' |
  'monthly' | 'custom'`

This single enum tries to express all of:

1. **Kind of meter** — `subscription` is used as "this is a balance, not a
   periodic quota."
2. **Period length** — `hourly`, `five_hour`, `daily`, `weekly`, `monthly`.
3. **Whether the period is fixed-cycle or rolling/sliding** —
   `weekly` vs `rolling_weekly`, `five_hour` vs `rolling_five_hour`.
4. **What the meter is measuring** — `toolcalls`, `search`.

These are independent dimensions and should be modelled as such. Today the
frontend has to do `windows.find(w => w.windowType === 'subscription')` to
locate the balance, and `getTrackedWindowsForChecker` has 16 hard-coded
cases mapping checker name → window-type strings to render.

### 3.3 `unit` carries a misleading value (`points`)

`QuotaUnit = 'dollars' | 'requests' | 'tokens' | 'percentage' | 'points' | 'kwh'`

- `kwh` exists in the type but no checker emits it. Neuralwatt emits
  `'points'` for kilowatt-hours and the frontend has both
  `if (unit === 'kwh')` *and* `if (unit === 'points') ... kWh remaining`
  branches that work around it.
- `points` is used for both **Poe points** (a real currency-like balance)
  and **Zenmux flows** (a per-cycle quota count) and **kWh** (an energy
  quantity). Three completely different things.
- `percentage` is a degenerate unit — it means "we don't know the underlying
  count, only the fraction." Everywhere `unit='percentage'` is used,
  `limit=100`, `used=<percent>`, `remaining=<percent>`, which is a clumsy
  encoding of "no count, just utilization."

### 3.4 Window output is not uniform within a checker

In several checkers the same window field is conditionally either `requests`
or `percentage` depending on what the upstream API returned (e.g.
`copilot-checker` lines 82-112 chooses unit at runtime). This makes
historical comparison meaningless — a snapshot from yesterday in `requests`
is not graphable on the same axis as today's snapshot in `percentage`.

### 3.5 Frontend has 21 near-duplicate display components

Each checker has its own `XxxQuotaDisplay.tsx`. They all do the same thing:

1. Find a window by hardcoded `windowType` string.
2. Render either a `Wallet` icon + formatted number, or a
   `QuotaProgressBar`.
3. Show a reset countdown if there is one.

`CompactQuotasCard.getTrackedWindowsForChecker` further duplicates this
selection logic with a 23-arm switch statement that maps each checker name
to the window types it expects.

### 3.6 Cross-cutting overrides

- `BALANCE_CHECKERS_WITH_RATE_LIMIT = new Set(['neuralwatt'])` — defined
  twice (`Sidebar.tsx:265`, `Quotas.tsx:166`). Both literals must stay in
  sync. They exist purely because `category` cannot be split per-meter.
- `CHECKER_DISPLAY_NAMES` defined three times
  (`Quotas.tsx:39`, `CombinedBalancesCard.tsx:17`, plus implicit
  via `CompactQuotasCard.getTypeDisplayName`).
- `FALLBACK_QUOTA_CHECKER_TYPES` (`api.ts`) and
  `QUOTA_CHECKER_TYPES_FALLBACK` (`Providers.tsx`) duplicate
  `VALID_QUOTA_CHECKER_TYPES` from the backend and the
  `quotaCheckerTypeEnum` postgres enum — four copies of the same list.

### 3.7 Adding a checker requires touching ~10 files

Per `AGENTS.md` § "Adding a Quota Checker": backend Zod schema, checker
class, factory registry, postgres enum, frontend display, frontend config,
frontend index, sidebar arrays, providers page fallback, api.ts fallback,
combined-balances display name, compact-quotas tracked-windows switch.
Most of that is rote.

## 4. Design Goals

1. **One concept, atomically.** A checker emits zero or more independent
   *meters*. A meter is the single unit of "thing that has a value, a unit,
   maybe a limit, maybe a reset, and a status." Balance vs. quota is a
   property of the meter, not the checker.
2. **Orthogonal axes.** Period duration, period kind (rolling vs. fixed),
   unit of measure, and what the meter counts are independent fields. No
   compound enums.
3. **No degenerate units.** `percentage` stops being a unit; it's a
   *display preference* derived from `used/limit`. Units name what is being
   counted (USD, tokens, requests, kWh, opaque-points).
4. **No magic strings to wire up the UI.** The model carries enough
   self-describing metadata that a generic balance row and a generic quota
   row can render any checker. Per-checker custom UI is only needed when a
   provider has genuinely unusual semantics — and even then it is opt-in,
   not the default.
5. **One source of truth for checker registration.** Type list, postgres
   enum, frontend dropdown, factory map should derive from a single
   declaration.
6. **The migration must be backwards-compatible** for stored snapshots —
   we don't want to lose history.

## 5. Proposed Data Model

### 5.1 Vocabulary

- **Checker** — the thing that talks to a provider's billing/usage
  endpoint. Identified by `checkerType` (e.g. `claude-code`) and a
  user-chosen `checkerId`. Configured per-provider.
- **Meter** — a single measurable. The atomic record. Has a kind, a unit,
  a value, optionally a limit, optionally a renewal period.
- **Snapshot** — one observation of one meter at one point in time. The
  database row.

A checker invocation produces *N* meter snapshots (commonly 1–4).

### 5.2 Meter kinds

```ts
type MeterKind =
  | 'balance'    // a stored value drawn down by use; topped up out-of-band
  | 'allowance'  // a per-period entitlement that resets on a schedule
```

Two values, deliberately. "Allowance" replaces today's
`'rate-limit'`/`'subscription'` muddle: it's the right word for "you get
N per cycle." The kind alone tells the UI which icon family to use and
which section of the dashboard the meter lives in. There is no third kind
and there is no checker-level kind.

### 5.3 Units

```ts
type MeterUnit =
  | 'usd'         // dollars / credits expressed in dollars
  | 'tokens'      // LLM tokens (input + output unless qualified by `subject`)
  | 'requests'    // API calls / interactions / "flows" / coding-plan calls
  | 'energy_kwh'  // kilowatt-hours
  | 'points'      // opaque provider-specific units (Poe points, etc.) —
                  // used only when the provider's docs literally call them
                  // "points" and there is no better mapping
```

`percentage` is removed as a unit. When a provider only exposes a
percentage (Claude Code, Codex, Antigravity, Gemini-CLI), the meter is
emitted with `unit: 'requests'`, `limit: 100`, `used: <percent>`,
`remaining: 100 - <percent>`, and a flag `valuesArePercent: true` that
tells the UI not to print "37 requests" but "37%". This keeps the wire
format honest about what we know (only a fraction) without inventing a
fake count.

Alternative considered: keep `percentage` as a unit. Rejected because it
forces every consumer to branch on it ("if percentage, render differently;
if anything else, render normally"), which is exactly the situation we
have today.

### 5.4 Periods

```ts
interface Period {
  // Length of the cycle.
  duration: { value: number; unit: 'minute' | 'hour' | 'day' | 'week' | 'month' };
  // Fixed-window (resets on a calendar boundary; everyone resets together)
  // vs. rolling/sliding (resets N units after the request that spent it).
  cycle: 'fixed' | 'rolling';
  // When the *current* cycle ends / when the meter next regains capacity.
  // Required for fixed cycles when the API returns it; optional for
  // rolling (rolling windows often don't have a single reset moment).
  resetsAt?: string; // ISO-8601
}
```

`Period` is only present on `MeterKind === 'allowance'` meters. Balance
meters have no period.

### 5.5 The Meter shape

```ts
interface Meter {
  // ── Identity ───────────────────────────────────────────────────────────
  /** Stable id within a checker invocation. Two snapshots with the same
   *  (checkerId, key) describe the same meter at two points in time. */
  key: string;
  /** Provider-readable label, e.g. "5-hour quota", "Account balance",
   *  "Search requests". Already localised for the UI. */
  label: string;
  /** Optional refinement, e.g. "Pro models", "Flash models", "Input tokens".
   *  When two meters share a label this disambiguates them. */
  subject?: string;

  // ── Classification ────────────────────────────────────────────────────
  kind: MeterKind;
  unit: MeterUnit;
  /** When true, `used`/`remaining`/`limit` are 0..100 percentages, not
   *  counts of `unit`. Set when the upstream API only reports a fraction. */
  valuesArePercent?: boolean;

  // ── Values ────────────────────────────────────────────────────────────
  /** Total cycle entitlement (allowance) or initial deposit (balance, if
   *  knowable — most providers don't expose this for prepaid balances). */
  limit?: number;
  used?: number;
  remaining?: number;
  /** Always 0..100. Derived if any two of (limit, used, remaining) known. */
  utilizationPercent: number;

  // ── Time ──────────────────────────────────────────────────────────────
  /** Required when kind === 'allowance', omitted when kind === 'balance'. */
  period?: Period;

  // ── Status ────────────────────────────────────────────────────────────
  status: 'ok' | 'warning' | 'critical' | 'exhausted';

  // ── Cooldown gating ───────────────────────────────────────────────────
  /** Per-meter override; falls back to checker default, falls back to 99. */
  exhaustionThreshold?: number;
}
```

Notes:

- `key` is a checker-local identifier (`'five_hour'`, `'weekly'`,
  `'balance'`, `'energy'`, `'search'`). It is **not** a global enum and
  the frontend never branches on its value. It's what `(checkerId, key)`
  uniquely identifies a meter for history graphing.
- `label`/`subject` is what the UI shows. The checker is responsible for
  translating provider-speak into something a human reads. The frontend
  never has to look up "what does `'five_hour'` mean for Claude vs.
  Gemini" — the meter already says "5-hour quota".
- `kind` (not `windowType`) is what divides the UI: balances on one card,
  allowances on another. No `BALANCE_CHECKERS_WITH_RATE_LIMIT` set is
  needed because mixed checkers simply emit meters of both kinds.
- `period` collapses today's `windowType` enum into orthogonal fields.
  Claude's 5-hour limit becomes
  `{ duration: { value: 5, unit: 'hour' }, cycle: 'rolling' }`.
  Synthetic's hourly search becomes
  `{ duration: { value: 1, unit: 'hour' }, cycle: 'fixed' }`.
- The estimation/projection block from the current `QuotaWindow` is kept
  unchanged on `Meter` (omitted above for brevity).

### 5.6 The CheckResult shape

```ts
interface QuotaCheckResult {
  checkerId: string;
  checkerType: string;            // 'claude-code', 'neuralwatt', etc.
  provider: string;
  checkedAt: string;              // ISO-8601
  success: boolean;
  error?: string;

  meters: Meter[];                // 0..N. Replaces `windows` and `groups`.

  oauthAccountId?: string;
  oauthProvider?: string;
  rawResponse?: unknown;
}
```

Notes:

- `meters` replaces both `windows` and `groups`. If a checker wants to
  group meters (e.g. per-model rows), each group member is its own meter
  with `subject` set to the model name.
- No checker-level `category` field.

### 5.7 Worked examples (existing providers in the new model)

**Naga** (pure dollar balance, one meter):
```js
meters: [{
  key: 'balance', label: 'Account balance',
  kind: 'balance', unit: 'usd',
  remaining: 12.34, utilizationPercent: 0, status: 'ok',
}]
```

**Wisdom Gate** (bounded balance — note: still a balance, has no period):
```js
meters: [{
  key: 'balance', label: 'Wisdom Gate balance',
  kind: 'balance', unit: 'usd',
  limit: 50, used: 18.20, remaining: 31.80,
  utilizationPercent: 36.4, status: 'ok',
}]
```

**Claude Code** (two allowances, percentage-only):
```js
meters: [
  { key: 'five_hour', label: '5-hour quota',
    kind: 'allowance', unit: 'requests', valuesArePercent: true,
    limit: 100, used: 27, remaining: 73,
    period: { duration: {value: 5, unit: 'hour'}, cycle: 'rolling',
              resetsAt: '2026-04-25T18:00:00Z' },
    utilizationPercent: 27, status: 'ok' },
  { key: 'weekly', label: 'Weekly quota',
    kind: 'allowance', unit: 'requests', valuesArePercent: true,
    limit: 100, used: 41, remaining: 59,
    period: { duration: {value: 7, unit: 'day'}, cycle: 'rolling',
              resetsAt: '2026-04-30T00:00:00Z' },
    utilizationPercent: 41, status: 'ok' },
]
```

**Synthetic** (mixed: rolling-5h requests, hourly fixed search, rolling-week dollars):
```js
meters: [
  { key: 'rolling_5h', label: 'Rolling 5-hour limit',
    kind: 'allowance', unit: 'requests',
    limit: 200, used: 37, remaining: 163,
    period: { duration: {value: 5, unit: 'hour'}, cycle: 'rolling' }, ...},
  { key: 'search_hourly', label: 'Search requests', subject: 'hourly',
    kind: 'allowance', unit: 'requests',
    period: { duration: {value: 1, unit: 'hour'}, cycle: 'fixed', resetsAt: ...}, ...},
  { key: 'weekly_credits', label: 'Weekly token credits',
    kind: 'allowance', unit: 'usd',
    period: { duration: {value: 7, unit: 'day'}, cycle: 'rolling', resetsAt: ...}, ...},
]
```

**Neuralwatt** (the hybrid case — no special-casing needed):
```js
meters: [
  { key: 'credits', label: 'Credit balance',
    kind: 'balance', unit: 'usd',
    limit: 100, used: 23.50, remaining: 76.50, ...},
  { key: 'energy', label: 'Energy quota',
    kind: 'allowance', unit: 'energy_kwh',
    limit: 50, used: 12.4, remaining: 37.6,
    period: { duration: {value: 1, unit: 'month'}, cycle: 'fixed',
              resetsAt: '2026-05-01T00:00:00Z' }, ...},
]
```

**Apertis** (combined into a single checker — no more two-checker split):
```js
meters: [
  { key: 'payg', label: 'PAYG balance',
    kind: 'balance', unit: 'usd', remaining: 8.42, ...},
  // emitted only if the account is a subscriber:
  { key: 'cycle_quota', label: 'Apertis pro plan',
    kind: 'allowance', unit: 'requests',
    limit: 5000, used: 1200, remaining: 3800,
    period: { duration: {value:1, unit:'month'}, cycle: 'fixed', resetsAt: ...}, ...},
]
```

**Poe** (points balance):
```js
meters: [{
  key: 'balance', label: 'POE point balance',
  kind: 'balance', unit: 'points',
  remaining: 1_350_000, utilizationPercent: 0, status: 'ok',
}]
```

## 6. Database Schema

The current `quota_snapshots` table stores one row per (checker, window,
checkedAt). That granularity is right and should be preserved; only the
column set changes.

### 6.1 New columns (proposed)

| Column                | Type      | Replaces / new                                          |
|-----------------------|-----------|---------------------------------------------------------|
| `id`                  | int PK    | unchanged                                               |
| `provider`            | text      | unchanged                                               |
| `checker_id`          | text      | unchanged                                               |
| `meter_key`           | text      | replaces `window_type`                                  |
| `kind`                | text      | new: `'balance' \| 'allowance'`                         |
| `label`               | text      | replaces `description` for the human-readable name      |
| `subject`             | text NULL | new: optional sub-scope                                 |
| `unit`                | text      | new enum: `'usd'\|'tokens'\|'requests'\|'energy_kwh'\|'points'` |
| `values_are_percent`  | bool      | new                                                     |
| `limit`               | real      | unchanged                                               |
| `used`                | real      | unchanged                                               |
| `remaining`           | real      | unchanged                                               |
| `utilization_percent` | real      | unchanged                                               |
| `period_duration_value`| int NULL | new                                                     |
| `period_duration_unit`| text NULL | new: `'minute'\|'hour'\|'day'\|'week'\|'month'`         |
| `period_cycle`        | text NULL | new: `'fixed'\|'rolling'`                               |
| `resets_at`           | timestamp | unchanged (now nullable for balances, was always so)    |
| `status`              | text      | unchanged                                               |
| `success`             | bool      | unchanged                                               |
| `error_message`       | text      | unchanged                                               |
| `checked_at`          | timestamp | unchanged                                               |
| `created_at`          | timestamp | unchanged                                               |

The compound primary index becomes `(checker_id, meter_key, checked_at)`,
which lines up with how the history modal queries data.

`group_id` is dropped — `subject` covers the per-model case in a way the
UI can render generically.

### 6.2 Postgres enums

- `quota_meter_kind_enum` = `('balance', 'allowance')`
- `quota_meter_unit_enum` = `('usd', 'tokens', 'requests', 'energy_kwh', 'points')`
- `quota_period_duration_unit_enum` = `('minute','hour','day','week','month')`
- `quota_period_cycle_enum` = `('fixed', 'rolling')`
- `quota_checker_type_enum` — kept, but its source-of-truth list is moved
  (see § 7.1).

### 6.3 Migration plan for stored history

A backfill migration maps old rows to new ones with a deterministic
translation table. Critical mappings:

| Old `windowType`      | New `kind`  | New `period`                                            |
|-----------------------|-------------|---------------------------------------------------------|
| `subscription`        | `balance`   | (none)                                                  |
| `hourly`              | `allowance` | `{1, 'hour', 'fixed'}`                                  |
| `five_hour`           | `allowance` | `{5, 'hour', 'rolling'}` (Claude/Codex use rolling)     |
| `rolling_five_hour`   | `allowance` | `{5, 'hour', 'rolling'}`                                |
| `daily`               | `allowance` | `{1, 'day', 'fixed'}`                                   |
| `weekly`              | `allowance` | `{1, 'week', 'fixed'}`                                  |
| `rolling_weekly`      | `allowance` | `{1, 'week', 'rolling'}`                                |
| `monthly`             | `allowance` | `{1, 'month', 'fixed'}`                                 |
| `toolcalls`           | `allowance` | (per-checker; `subject='tool calls'`)                   |
| `search`              | `allowance` | (per-checker; `subject='search'`)                       |
| `custom`              | `allowance` | (per-checker; encoded from API metadata where possible) |

Old `unit='percentage'` rows become `unit='requests'` with
`values_are_percent=true`. Old `unit='points'` rows for Neuralwatt become
`unit='energy_kwh'` (special-case in the migration based on `checker_id`).
Old `unit='kwh'` is renamed to `energy_kwh` for consistency. Other
`unit='points'` rows (Poe, Zenmux) stay as `points`.

For safety, keep the old columns for one release and write to both. The
quota scheduler reads from new columns only; the history modal
double-reads during the transition window.

## 7. Backend changes

### 7.1 Single source of truth for checker registration

Replace the four parallel lists with one declaration per checker:

```ts
// packages/backend/src/services/quota/checkers/registry.ts
export const CHECKER_DEFS = [
  { type: 'naga',         class: NagaQuotaChecker,         optionsSchema: NagaQuotaCheckerOptionsSchema },
  { type: 'claude-code',  class: ClaudeCodeQuotaChecker,   optionsSchema: ClaudeCodeQuotaCheckerOptionsSchema },
  ...
] as const;
```

Derived from this single array:

- `VALID_QUOTA_CHECKER_TYPES` (config.ts)
- `ProviderQuotaCheckerSchema` (the discriminated union, generated by
  mapping over `CHECKER_DEFS`)
- `CHECKER_REGISTRY` (factory)
- `quotaCheckerTypeEnum` values (postgres)
- The response of `/v0/management/quota-checker-types`

The frontend fetches `/v0/management/quota-checker-types` and the
fallback constants in `api.ts` and `Providers.tsx` are removed (a stale
fallback is worse than a brief loading state).

### 7.2 Base class shape

```ts
abstract class QuotaChecker {
  abstract readonly type: string;          // e.g. 'claude-code'
  abstract checkQuota(): Promise<QuotaCheckResult>;

  /** Default exhaustion threshold for the whole checker; overridable
   *  per-meter inside checkQuota(). */
  get exhaustionThreshold(): number {
    return this.config.options.maxUtilizationPercent ?? 99;
  }

  // Helpers — emit a meter, derive utilization, compute status, etc.
  protected balanceMeter(...): Meter;
  protected allowanceMeter(...): Meter;
}
```

Note: no more `category` getter on the checker. The
`getCheckerCategory(checkerId)` function in
`packages/backend/src/routes/management/quotas.ts` is deleted; the API
returns meters with their own `kind` already.

### 7.3 Cooldown / scheduler

`QuotaScheduler.applyCooldownsFromResult` already iterates windows and
picks the most-constrained one. The same logic applies to meters. Two
small adjustments:

1. **Skip balance meters** for cooldown injection. A balance going to
   zero is a billing problem, not a rate-limit problem; the request will
   fail upstream with a clear error. The scheduler should *not* keep
   slamming the cooldown awake/asleep on every poll just because a
   balance was 0 — and it cannot reset itself, so there's nothing to
   wait for. (Today this is implicit because balances have no
   `resetsAt`; making it explicit makes the intent obvious.)
2. The "strictest threshold" calculation iterates `meters`, not
   `windows`.

### 7.4 API response shape

`GET /v0/management/quotas` returns:

```ts
{
  checkerId: string;
  checkerType: string;          // moves up — was always there but now
                                // is the only "what kind of checker is this"
  oauthAccountId?: string;
  oauthProvider?: string;
  latest: {
    checkedAt: string;
    success: boolean;
    error?: string;
    meters: Meter[];            // the most recent snapshot reconstructed
                                // by grouping rows on `meter_key`
  };
}[]
```

`checkerCategory` is removed from the API. Consumers determine kind
per-meter.

## 8. Frontend changes

### 8.1 Two generic display components, not 21

Replace the per-checker `XxxQuotaDisplay.tsx` family with two generic
components:

- `BalanceMeterRow` — wallet icon, label, formatted `remaining` value,
  optional progress bar when `limit` is known.
- `AllowanceMeterRow` — progress bar with `utilizationPercent`, a label,
  `used / limit` formatted via `unit` and `valuesArePercent`, and a
  countdown to `period.resetsAt` if present.

`MeterValue.tsx` formats a number based on `unit` (and
`valuesArePercent`):

```ts
function formatMeterValue(v: number, unit: MeterUnit, asPercent?: boolean) {
  if (asPercent) return `${Math.round(v)}%`;
  switch (unit) {
    case 'usd':         return formatCost(v);
    case 'tokens':      return formatTokens(v);
    case 'requests':    return `${formatNumber(v)} reqs`;
    case 'energy_kwh':  return `${v.toFixed(3)} kWh`;
    case 'points':      return `${formatPointsFull(v)} pts`;
  }
}
```

### 8.2 Sidebar / dashboard sections

A checker no longer has a category. Sections are derived by walking the
meters:

```ts
const balanceMeters  = quotas.flatMap(q => q.meters.filter(m => m.kind === 'balance')
                                                  .map(m => ({ quota: q, meter: m })));
const allowanceMeters = quotas.flatMap(q => q.meters.filter(m => m.kind === 'allowance')
                                                   .map(m => ({ quota: q, meter: m })));
```

The `BALANCE_CHECKERS_WITH_RATE_LIMIT` constants disappear. A hybrid
checker like Neuralwatt naturally appears in both lists because it emits
both kinds of meter.

### 8.3 Per-checker icons (the only thing that stays per-checker)

A small registry that maps `checkerType` to an icon and a display name.
This is purely cosmetic and lives in **one** file:

```ts
// packages/frontend/src/components/quota/checker-presentation.ts
export const CHECKER_PRESENTATION: Record<string, { icon: LucideIcon; name: string }> = {
  'claude-code':  { icon: MessageSquare, name: 'Claude Code' },
  'openai-codex': { icon: Bot,            name: 'OpenAI Codex' },
  // ...
};
```

The three current copies of `CHECKER_DISPLAY_NAMES` collapse into this
single object. `CompactQuotasCard.getTrackedWindowsForChecker`,
`getCheckerCategory`, `getTypeDisplayName`, and `getCheckerIcon` all
delete: there is nothing left to switch on.

### 8.4 Per-checker config components

Config components stay, because each checker has different config inputs
(API key URL, organisation id, cookie name, …). But:

- They're discovered by `checkerType`, not imported one-by-one in
  `Providers.tsx`. A registry like `CONFIG_COMPONENTS[checkerType]`
  replaces the long `if/else` ladder.
- The default config component (no extra fields) is used when no
  registry entry exists, so adding a checker with no extra options
  needs zero frontend changes.

### 8.5 Frontend types

`packages/frontend/src/types/quota.ts` is rewritten to mirror the
backend shape — `Meter`, `MeterKind`, `MeterUnit`, `Period`, etc. The
old `QuotaWindow`/`QuotaWindowType` types are removed.

## 9. Migration / Rollout Plan

The change is large but cleanly stageable:

1. **Land the new types** alongside the old ones (`Meter` next to
   `QuotaWindow`). Add a `meters: Meter[]` field to the wire shape; keep
   `windows: QuotaWindow[]` populated from `meters` for one release so
   nothing breaks during deploy.
2. **Migrate one checker** end-to-end (suggest `naga` — simplest balance
   case) to prove the new base class. Snapshot it with both old and new
   columns.
3. **Generate the schema migration** (new columns nullable, old columns
   nullable). Backfill with a one-shot script using the mapping table
   from § 6.3.
4. **Migrate the remaining checkers**. The hybrid case (Neuralwatt) and
   the multi-meter cases (Synthetic, NanoGPT, Codex, Claude) prove the
   model. Apertis collapses from two checkers into one — provider
   configs that reference `apertis-coding-plan` are mapped to
   `apertis` on read for one release.
5. **Frontend cutover**: ship the generic `BalanceMeterRow` /
   `AllowanceMeterRow`. Delete the 21 per-checker display components in
   the same PR. The two `BALANCE_CHECKERS_WITH_RATE_LIMIT` literals,
   the three `CHECKER_DISPLAY_NAMES` copies, and
   `getTrackedWindowsForChecker` all delete.
6. **Drop the old columns and types** one release later, after the
   double-write window has expired.

Each step is independently shippable; the system stays green throughout.

## 10. What this fixes, concretely

Tying it back to the issues from § 3:

| Problem                                       | Resolution                                              |
|-----------------------------------------------|---------------------------------------------------------|
| `category` on the wrong object                | Moved to `kind` on each meter.                          |
| `windowType` conflates four axes              | Split into `kind`, `period.duration`, `period.cycle`, `subject`. |
| `unit: 'percentage'` is degenerate            | Replaced by `valuesArePercent` flag on the underlying real unit. |
| `unit: 'points'` overloaded for kWh           | New `energy_kwh` unit; `points` reserved for opaque provider currencies. |
| Hybrid checkers need manual override sets     | Mixed checkers naturally emit meters of both kinds.     |
| 21 near-duplicate display components          | Two generic row components + a presentation registry.   |
| 4 parallel checker-type registrations         | One `CHECKER_DEFS` array generates all of them.         |
| Apertis pays for two API calls                | Single checker emits both meters from one response.     |
| History rows mix `requests` and `percentage`  | Stored unit is stable; `valuesArePercent` decides display only. |
| `getTrackedWindowsForChecker` 23-arm switch   | Deleted — every meter is rendered the same way.         |

## 11. Open questions

- **Per-meter exhaustion thresholds.** Today `maxUtilizationPercent` is a
  checker-level config. For checkers with multiple meters the operator
  may want to cool down on the 5-hour window at 95% but tolerate 99% on
  the weekly. Suggest allowing the option as either a number (applies
  to all meters) or a `Record<meterKey, number>`. Out of scope for the
  initial migration; can land later without further schema changes.
- **Rolling-window reset semantics.** Truly rolling windows don't have
  a single "reset moment" — they recover continuously. Today the code
  pretends they do (using `nextTickAt`/`resetTime` from the API).
  Acceptable for now: keep `resetsAt` populated when the API gives us
  one, document that for `cycle: 'rolling'` it means "earliest moment
  capacity will visibly improve."
- **Multiple balance currencies on one provider.** Moonshot exposes
  `cash_balance` and `voucher_balance` separately. Today only
  `available_balance` is recorded. The new model can emit both as
  separate meters if we want to surface them; deferring that decision.
- **Energy units beyond kWh.** Neuralwatt is the only energy meter
  today. If others appear with different units (joules, CO₂eq), promote
  `energy_kwh` to a more general `{ unit: 'energy', subUnit: 'kwh' }`.
  Premature now.

