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

### 2.2 Subscription quotas with a single periodic window

| Checker               | Window      | Unit                       | Notes                                                  |
|-----------------------|-------------|----------------------------|--------------------------------------------------------|
| `copilot`             | monthly     | requests **or** percentage | Falls back to % when entitlement missing               |
| `apertis-coding-plan` | monthly     | requests                   | `cycle_*` fields                                       |
| `wisdomgate`          | monthly     | dollars                    | Returns `total_usage`/`total_available`; cycle-bound   |
| `minimax-coding`      | "custom"    | requests                   | API field is misnamed; remaining lives in `usage_count`|
| `gemini-cli`          | "five_hour" | percentage                 | Aggregated per-model bucket                            |
| `antigravity`         | "five_hour" | percentage                 | Per-model rows                                         |

### 2.3 Subscription quotas with multiple independent windows

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

### 2.4 Hybrid: balance **and** subscription quota together

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
  quantity). Three completely different things, all stored under the
  same name.
- `percentage` is encoded as `limit=100, used=<percent>, remaining=<percent>`
  rather than just storing the percentage in `used` and letting the
  consumer treat the unit as the unit. Mostly cosmetic, but it leaks
  into every history graph.

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
3. **One unit per number, never overloaded.** kWh is `kwh`, points are
   `points`, percentages are `percentage`. We never pretend a kWh
   reading is a "point" so that the schema enum is shorter.
4. **No magic strings to wire up the UI.** The model carries enough
   self-describing metadata that a generic balance row and a generic quota
   row can render any checker. Per-checker custom UI is only needed when a
   provider has genuinely unusual semantics — and even then it is opt-in,
   not the default.
5. **One source of truth for checker registration.** Type list,
   frontend dropdown, factory map should derive from a single
   declaration. Don't repeat the same list in three places.
6. **No SQL enums on values that change with every new checker.**
   Plain text columns; validation lives in code, not in a migration
   that has to ship every time we add a provider.

This is a rethink, not a refactor. There is no requirement to preserve
the current data model, the current wire format, or any stored history.

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
  | 'tokens'      // LLM tokens
  | 'requests'    // API calls / interactions / "flows" / coding-plan calls
  | 'kwh'         // kilowatt-hours
  | 'points'      // opaque provider-specific units — used only when the
                  // provider's docs literally call them "points" and there
                  // is no better mapping (Poe is the canonical case)
  | 'percentage'  // when the provider only tells us a fraction and there
                  // is no underlying count we can recover
```

Notes:

- The unit names what is being counted, not the measurement. `kwh` is a
  unit; "energy" is the measurement, and we don't need to encode the
  measurement separately — the label and subject already say "Energy
  quota."
- `percentage` is a real unit, not a degenerate one. Several providers
  (Claude Code, Codex, Antigravity, Gemini-CLI) only expose a fraction,
  and inventing a fake "limit=100, used=N" requests count would lie
  about what we know. When `unit: 'percentage'`, `used`/`remaining` are
  on the 0..100 scale and the formatter prints `N%`.
- `points` is reserved for opaque provider currencies. Energy quotas
  use `kwh`. Per-cycle "flows" and "interactions" are `requests`. There
  is no `'points'`-as-anything-else.

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
  checkerId: string;     // unique instance id chosen by the operator
  checkerType: string;   // 'claude-code', 'neuralwatt', etc.
  provider: string;      // routing provider this checker is attached to
  checkedAt: string;     // ISO-8601
  success: boolean;
  error?: string;

  meters: Meter[];       // 0..N independent meters
  rawResponse?: unknown; // for debugging only
}
```

Notes:

- `meters` is the only payload. There are no `windows`, no `groups`,
  no checker-level `category`. If a provider exposes per-model rows
  (Antigravity, Gemini-CLI), each row becomes a meter with the model
  name in `subject`.
- `oauthProvider`/`oauthAccountId` are **not** on the result. They're
  duplicative: a checker is configured against a single OAuth account,
  so `(checkerType, checkerId)` already identifies the account.
  Anything that needs to display the OAuth account name resolves it
  from the checker's config, not from each snapshot.

### 5.7 Worked examples (existing providers in the new model)

**Naga** (pure dollar balance, one meter):
```js
meters: [{
  key: 'balance', label: 'Account balance',
  kind: 'balance', unit: 'usd',
  remaining: 12.34, utilizationPercent: 0, status: 'ok',
}]
```

**Wisdom Gate** (monthly subscription credit allowance):
```js
meters: [{
  key: 'monthly_credits', label: 'Wisdom Gate subscription',
  kind: 'allowance', unit: 'usd',
  limit: 50, used: 18.20, remaining: 31.80,
  period: { duration: {value: 1, unit: 'month'}, cycle: 'fixed',
            resetsAt: '2026-05-01T00:00:00Z' },
  utilizationPercent: 36.4, status: 'ok',
}]
```

**Claude Code** (two allowances, percentage-only):
```js
meters: [
  { key: 'five_hour', label: '5-hour quota',
    kind: 'allowance', unit: 'percentage',
    used: 27, remaining: 73,
    period: { duration: {value: 5, unit: 'hour'}, cycle: 'rolling',
              resetsAt: '2026-04-25T18:00:00Z' },
    utilizationPercent: 27, status: 'ok' },
  { key: 'weekly', label: 'Weekly quota',
    kind: 'allowance', unit: 'percentage',
    used: 41, remaining: 59,
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

**Neuralwatt** (hybrid: balance + monthly energy allowance):
```js
meters: [
  { key: 'credits', label: 'Credit balance',
    kind: 'balance', unit: 'usd',
    limit: 100, used: 23.50, remaining: 76.50, ...},
  { key: 'energy', label: 'Energy quota',
    kind: 'allowance', unit: 'kwh',
    limit: 50, used: 12.4, remaining: 37.6,
    period: { duration: {value: 1, unit: 'month'}, cycle: 'fixed',
              resetsAt: '2026-05-01T00:00:00Z' }, ...},
]
```

**Apertis** (one checker, both PAYG balance and the cycle quota when
the account is also a subscriber — both come from the same response):
```js
meters: [
  { key: 'payg', label: 'PAYG balance',
    kind: 'balance', unit: 'usd', remaining: 8.42, ...},
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

A new table — `meter_snapshots` — is created from scratch. The existing
`quota_snapshots` table is left alone and ignored by the new code. There
is no data migration. Anything historical that someone wants from the old
table can be addressed separately, later.

### 6.1 `meter_snapshots`

One row per (checker invocation, meter). Columns:

| Column                  | Type        | Notes                                            |
|-------------------------|-------------|--------------------------------------------------|
| `id`                    | int PK      |                                                  |
| `checker_id`            | text        | operator-chosen instance id                      |
| `checker_type`          | text        | e.g. `'claude-code'`                             |
| `provider`              | text        | routing provider this checker is attached to     |
| `meter_key`             | text        | checker-local id, e.g. `'five_hour'`, `'balance'`|
| `kind`                  | text        | `'balance'` or `'allowance'`                     |
| `unit`                  | text        | `'usd'`, `'tokens'`, `'requests'`, `'kwh'`, `'points'`, `'percentage'` |
| `label`                 | text        | human-readable, set by the checker               |
| `subject`               | text NULL   | optional sub-scope (e.g. model name)             |
| `limit`                 | real NULL   |                                                  |
| `used`                  | real NULL   |                                                  |
| `remaining`             | real NULL   |                                                  |
| `utilization_percent`   | real        | 0..100                                           |
| `status`                | text        | `'ok'` / `'warning'` / `'critical'` / `'exhausted'` |
| `period_duration_value` | int NULL    | only for allowances                              |
| `period_duration_unit`  | text NULL   | `'minute'` / `'hour'` / `'day'` / `'week'` / `'month'` |
| `period_cycle`          | text NULL   | `'fixed'` / `'rolling'`                          |
| `resets_at`             | timestamp NULL | when the meter next regains capacity          |
| `success`               | bool        | did the checker call succeed                     |
| `error_message`         | text NULL   |                                                  |
| `checked_at`            | timestamp   |                                                  |
| `created_at`            | timestamp   |                                                  |

Indexes:

- `(checker_id, meter_key, checked_at)` — primary access path for the
  history modal and the "latest meter" lookup.
- `(provider, checked_at)` — for any cross-provider scans.
- `(checked_at)` — for retention sweeps.

### 6.2 No SQL enums

All categorical columns (`kind`, `unit`, `period_cycle`,
`period_duration_unit`, `status`, `checker_type`) are plain `text`.
Validation lives in code: the checker base class only emits valid
values, and the API layer rejects anything malformed. Adding a new
checker type or a new unit therefore costs zero database migrations.

The trade-off is well understood: a typo on the write path becomes a
runtime bug instead of a database error. We accept that — typos are
caught by the checker's tests and the type system.

## 7. Backend

### 7.1 Checker registration

A checker is a class plus an options-schema. They live together in the
checker's own module and self-register:

```ts
// packages/backend/src/services/quota/checkers/claude-code.ts
import { defineChecker } from '../checker-registry';

export default defineChecker({
  type: 'claude-code',
  optionsSchema: z.object({
    endpoint: z.string().url().optional(),
    oauthAccountId: z.string().optional(),
    maxUtilizationPercent: z.number().min(1).max(100).optional(),
  }),
  async check(ctx): Promise<Meter[]> {
    // hits the API, returns meters
  },
});
```

`defineChecker` adds the entry to a module-private registry. Importing
the checker file is enough; there is no separate factory map, no enum
list, no parallel array of types in `config.ts`. The registry exposes:

- `getCheckerTypes(): string[]` — for the management API.
- `validateProviderConfig(cfg)` — uses the per-type `optionsSchema`.
- `instantiate(type, options)` — replaces the old `createChecker`.

The frontend calls `/v0/management/quota-checker-types` and uses what it
gets back. There is no fallback list duplicated in the frontend — if the
API is unreachable, the dropdown shows a loading state.

### 7.2 Base behaviour

Each checker's `check(ctx)` returns a `Meter[]`. Helpers on the context
build meters with derived fields filled in:

```ts
ctx.balance({ key, label, unit, remaining, limit?, subject? })
ctx.allowance({ key, label, unit, used, limit?, remaining?,
                period: { duration, cycle, resetsAt? },
                subject? })
```

`utilizationPercent` and `status` are derived inside the helper — the
checker does not compute them. There is no checker-level `category`,
`window`, or `category` getter.

Configuration like `maxUtilizationPercent` lives in the checker's own
options schema. If a checker wants to expose per-meter overrides, it
does so via its own option shape; the base class doesn't pretend to
solve it generically.

### 7.3 Cooldown / scheduler

Cooldown injection iterates over the latest meters for each checker.
Only allowance meters with a known `resetsAt` participate — a balance
meter at zero is a billing failure, not a rate-limit, and there is
nothing to wait for. The "strictest threshold" calculation looks at all
allowance meters across all checkers attached to a provider.

### 7.4 API response shape

`GET /v0/management/quotas` returns:

```ts
{
  checkerId: string;
  checkerType: string;
  provider: string;
  latest: {
    checkedAt: string;
    success: boolean;
    error?: string;
    meters: Meter[];
  };
}[]
```

The "latest" meters are reconstructed from `meter_snapshots` by taking
the most recent row for each `(checker_id, meter_key)`. There is no
`checkerCategory`, no `oauthAccountId`, no `oauthProvider` on the
response — the frontend asks the provider-config endpoint when it wants
to label an OAuth account.

## 8. Frontend changes

### 8.1 Two generic display components, not 21

Replace the per-checker `XxxQuotaDisplay.tsx` family with two generic
components:

- `BalanceMeterRow` — wallet icon, label, formatted `remaining` value,
  optional progress bar when `limit` is known.
- `AllowanceMeterRow` — progress bar with `utilizationPercent`, a label,
  `used / limit` formatted by unit, and a countdown to `period.resetsAt`
  if present.

`MeterValue.tsx` formats a number based on `unit`:

```ts
function formatMeterValue(v: number, unit: MeterUnit) {
  switch (unit) {
    case 'usd':        return formatCost(v);
    case 'tokens':     return formatTokens(v);
    case 'requests':   return `${formatNumber(v)} reqs`;
    case 'kwh':        return `${v.toFixed(3)} kWh`;
    case 'points':     return `${formatPointsFull(v)} pts`;
    case 'percentage': return `${Math.round(v)}%`;
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

## 9. Implementation Order

This is a greenfield build alongside the existing one, then a cutover.
There is no historical-data migration to worry about. Suggested order:

1. **New types and base class.** Land `Meter`, `MeterKind`, `MeterUnit`,
   `Period`, the `defineChecker` helper, and the `meter_snapshots`
   schema. No checkers yet.
2. **Build new checkers from scratch.** One per existing provider, in
   the new base class. The hybrid (Neuralwatt) and multi-meter cases
   (Synthetic, NanoGPT, Codex, Claude) are the most informative to do
   early — they prove the model. Apertis is a single checker emitting
   both meters from one response; `apertis-coding-plan` does not exist
   in the new world.
3. **New API endpoints.** `/v0/management/quotas` returns the new
   shape. The old endpoint is left in place but unused, and is removed
   at the end.
4. **New frontend components.** `BalanceMeterRow`, `AllowanceMeterRow`,
   the presentation registry, the config-component lookup. The Quotas
   page and the sidebar render from `meters` directly.
5. **Cutover.** The new scheduler reads from `meter_snapshots`; the new
   provider-config UI writes the new options; the old code is deleted
   in the same PR. There is no double-write, no compatibility shim.
   The old `quota_snapshots` table is left untouched in the database
   and ignored by the application.

Each step except the cutover is independently shippable behind code
that nothing else calls, so a half-finished step doesn't break anything
in production.

## 10. What this fixes, concretely

Tying it back to the issues from § 3:

| Problem                                       | Resolution                                              |
|-----------------------------------------------|---------------------------------------------------------|
| `category` on the wrong object                | Moved to `kind` on each meter.                          |
| `windowType` conflates four axes              | Split into `kind`, `period.duration`, `period.cycle`, `subject`. |
| `unit: 'points'` overloaded for kWh           | New `kwh` unit. `points` reserved for opaque provider currencies. |
| Hybrid checkers need manual override sets     | Mixed checkers naturally emit meters of both kinds.     |
| 21 near-duplicate display components          | Two generic row components + a presentation registry.   |
| 4 parallel checker-type registrations         | `defineChecker` self-registers; a single in-process registry serves API, factory, and validation. |
| Apertis pays for two API calls                | Single checker emits both meters from one response.     |
| `getTrackedWindowsForChecker` 23-arm switch   | Deleted — every meter is rendered the same way.         |
| OAuth fields duplicated on every snapshot     | Removed from the wire shape; resolved from checker config only when needed. |

## 11. Open questions

- **Per-meter exhaustion thresholds.** Today `maxUtilizationPercent` is
  a checker-level option. For checkers with multiple meters the
  operator may want to cool down on the 5-hour window at 95% but
  tolerate 99% on the weekly. Suggest allowing the option as either a
  number (applies to all meters) or a `Record<meterKey, number>`. Each
  checker can opt in via its own options schema; the base class doesn't
  need to know.
- **Rolling-window reset semantics.** Truly rolling windows don't have
  a single "reset moment" — they recover continuously. Today the code
  pretends they do (using `nextTickAt`/`resetTime` from the API). The
  new model keeps `resetsAt` populated when the API supplies one and
  documents that for `cycle: 'rolling'` it means "earliest moment
  capacity will visibly improve," not "everything resets."
- **Multiple balance currencies on one provider.** Moonshot exposes
  `cash_balance` and `voucher_balance` separately. Today only
  `available_balance` is recorded. The new model has no obstacle to
  emitting both as separate meters with `subject: 'cash'` /
  `subject: 'voucher'`; whether to do so is a UX call per provider.

