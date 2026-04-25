# Quota & Balance Tracking Redesign

> Status: **Proposal** — no code changes have been made. This document is the
> design that the implementation should be measured against.

## 1. Problem

Plexus tracks two distinct things under one model: **prepaid balances**
that drain with use and refill out-of-band, and **periodic allowances**
that reset on a schedule. The current `QuotaWindow[]` + checker-level
`category: 'balance' | 'rate-limit'` collapses them poorly:

- **Hybrid providers don't fit.** Neuralwatt has both a dollar balance
  *and* a monthly kWh quota; Apertis has a PAYG balance *and* a coding
  plan cycle quota. Workaround: a `BALANCE_CHECKERS_WITH_RATE_LIMIT`
  set duplicated across `Sidebar.tsx` and `Quotas.tsx`, and Apertis
  registered twice as two separate checkers hitting the same endpoint.
- **`windowType` flattens four orthogonal axes.** It conflates "this
  is a balance, not a quota" (`subscription`), period length (`hourly`,
  `five_hour`, `daily`, ...), cycle kind (`weekly` vs `rolling_weekly`),
  and what's measured (`toolcalls`, `search`). 11 strings that should
  be 3-4 independent fields.
- **`unit` is overloaded.** `'points'` is used for Poe points (currency),
  Zenmux flows (a per-cycle count), and Neuralwatt kWh (an energy
  quantity). `'kwh'` exists in the enum but nothing emits it.
  `'percentage'` is encoded as `limit=100, used=N, remaining=100-N`.
- **Same checker, different units across snapshots.** Copilot emits
  `requests` or `percentage` depending on whether the API returned
  entitlement counts; history graphs get broken.
- **Frontend lives off magic strings.** 21 near-duplicate
  `XxxQuotaDisplay.tsx` components and a 23-arm switch in
  `CompactQuotasCard.getTrackedWindowsForChecker` mapping checker name
  → which `windowType` strings to render.
- **Four parallel checker-type registrations.**
  `VALID_QUOTA_CHECKER_TYPES` (config.ts), `quotaCheckerTypeEnum`
  (postgres), `FALLBACK_QUOTA_CHECKER_TYPES` (api.ts),
  `QUOTA_CHECKER_TYPES_FALLBACK` (Providers.tsx) — and three copies of
  `CHECKER_DISPLAY_NAMES`.

The 23 existing checkers fall into four shapes:

| Shape                             | Examples                                                                                       |
|-----------------------------------|------------------------------------------------------------------------------------------------|
| Pure prepaid balance              | `naga`, `kilo`, `moonshot`, `novita`, `minimax`, `apertis` (PAYG), `openrouter`, `poe`          |
| Single periodic allowance         | `copilot`, `apertis-coding-plan`, `wisdomgate`, `minimax-coding`, `gemini-cli`, `antigravity`   |
| Multiple independent allowances   | `claude-code`, `openai-codex`, `zenmux`, `ollama`, `kimi-code`, `zai`, `nanogpt`, `synthetic`   |
| Hybrid (balance + allowance)      | `neuralwatt`                                                                                   |

The goal: one self-describing model where any of these shapes is just
*N* independent meters with their own kind, unit, and optional period —
no checker-level category, no window-type enum, no per-checker UI
switches.

## 2. Design Goals

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

## 3. Proposed Data Model

### 3.1 Vocabulary

- **Checker** — the thing that talks to a provider's billing/usage
  endpoint. Identified by `checkerType` (e.g. `claude-code`) and a
  user-chosen `checkerId`. Configured per-provider.
- **Meter** — a single measurable. The atomic record. Has a kind, a unit,
  a value, optionally a limit, optionally a renewal period.
- **Snapshot** — one observation of one meter at one point in time. The
  database row.

A checker invocation produces *N* meter snapshots (commonly 1–4).

### 3.2 Meter kinds

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

### 3.3 Units

`unit` is an **open string**, not a closed enum. The checker emits the
provider's own terminology — `'flows'`, `'interactions'`, `'images'`,
`'tokens'`, `'kwh'`, `'points'`, `'usd'`, `'percentage'`, `'credits'`,
whatever the upstream calls them.

A small set of canonical strings is documented (and recommended where
they fit), with a default formatter for each:

| Canonical    | Renders as                  | Use for upstream terms like        |
|--------------|-----------------------------|------------------------------------|
| `usd`        | currency formatter (`$1.23`)| dollars, credits-in-USD, balance, available_amount |
| `tokens`     | token formatter             | tokens, input_tokens, output_tokens |
| `requests`   | `N` (or `N reqs`)           | requests, interactions, flows, calls, usages, count |
| `kwh`        | `N kWh`                     | kwh, energy                        |
| `points`     | `N pts`                     | points (Poe-style opaque currency) |
| `images`     | `N images`                  | images, image_generations          |
| `percentage` | `N%`                        | percent, percentage, fraction (normalize fractions to 0..100) |

**Conventions:**

- A checker **should** prefer the canonical string when the meaning is
  the same (Copilot's "premium_interactions" → `'requests'`, Zenmux's
  "flows" → `'requests'`). The display shouldn't have to know that
  "flows" means "interactions" means "requests".
- A checker **may** emit a non-canonical string when the provider's
  meaning is genuinely distinct, or when the upstream label is part of
  the user's mental model and shouldn't be flattened. The display
  formats unknown units as `${value} ${unit}` and moves on. Adding a
  new unit costs nothing — no schema change, no enum migration.
- Because `unit` is plain text, `points`-as-kWh is no longer possible;
  the checker either says `'kwh'` or it says `'kwh'`.
- A meter's unit must not change between snapshots (it's how history
  graphs join). If a checker has a fallback path that yields a
  different unit (today's Copilot `requests`-vs-`percentage` flip), it
  should emit two distinct meters with different `key`s instead.

### 3.4 Period (flat fields on Meter)

Period information lives directly on the Meter, not in a nested object.
The fields:

| Field           | Type                                         | When                                     |
|-----------------|----------------------------------------------|------------------------------------------|
| `periodValue`   | number                                       | only when `kind === 'allowance'`         |
| `periodUnit`    | `'minute'` \| `'hour'` \| `'day'` \| `'week'` \| `'month'` | "                              |
| `periodCycle`   | `'fixed'` \| `'rolling'`                     | "                                        |
| `resetsAt`      | ISO-8601 string                              | optional; "earliest moment capacity will visibly improve" |

A balance meter omits all four. An allowance meter sets the first three
and may set `resetsAt`. Examples:

- Claude's 5-hour rolling: `periodValue: 5, periodUnit: 'hour', periodCycle: 'rolling'`
- Copilot's monthly fixed cycle: `periodValue: 1, periodUnit: 'month', periodCycle: 'fixed', resetsAt: '...'`

### 3.5 The Meter shape

```ts
type Utilization = number | 'unknown' | 'not_applicable';

interface Meter {
  // ── Identity ───────────────────────────────────────────────────────────
  /** Stable id within a checker invocation. Two snapshots with the same
   *  (checkerId, key) describe the same meter at two points in time. */
  key: string;
  /** Human-readable, e.g. "5-hour quota", "Account balance", "Search". */
  label: string;

  /** Optional UI grouping. Meters that share a `group` are rendered
   *  together under one heading (e.g. all "Pro models" rows from
   *  Antigravity, or both "5-hour" and "weekly" rows of a single
   *  Claude plan). Pure cosmetic — nothing keys off it. */
  group?: string;

  /** Optional resource scope — the specific thing this meter is
   *  measuring within its checker (e.g. "gemini-2.5-pro", "cash",
   *  "voucher", "search", "input_tokens"). Used to disambiguate
   *  meters that share a label and to label a row in the UI when the
   *  group rolls multiple scopes together. */
  scope?: string;

  // ── Classification ────────────────────────────────────────────────────
  kind: 'balance' | 'allowance';
  unit: string;     // see § 3.3 — open string, canonical names recommended

  // ── Values ────────────────────────────────────────────────────────────
  limit?: number;
  used?: number;
  remaining?: number;
  /** 0..100, OR one of the sentinels:
   *    'unknown'        — checker tried but the provider didn't expose enough
   *                       (e.g. balance with no total deposit known);
   *                       the meter is still useful but no progress bar.
   *    'not_applicable' — % utilization is meaningless for this meter
   *                       (e.g. an unbounded counter). */
  utilizationPercent: Utilization;

  // ── Period (only for allowance) ───────────────────────────────────────
  periodValue?: number;
  periodUnit?: 'minute' | 'hour' | 'day' | 'week' | 'month';
  periodCycle?: 'fixed' | 'rolling';
  resetsAt?: string;       // ISO-8601

  // ── Status ────────────────────────────────────────────────────────────
  status: 'ok' | 'warning' | 'critical' | 'exhausted';

  // ── Cooldown gating ───────────────────────────────────────────────────
  /** For allowance meters: % utilization that triggers cooldown.
   *  For balance meters:    floor on `remaining` (in `unit`) below which
   *                         the provider is cooled down.
   *  Falls back to checker default, then to a global default. */
  exhaustionThreshold?: number;
}
```

Notes:

- `key` is a checker-local identifier. The frontend never branches on
  its value; it identifies the meter for history graphing.
- `label` is what the UI shows; the checker translates
  provider-speak. `group` and `scope` add structure when needed.
- `kind` is what divides the UI: balances on one card, allowances on
  another. Hybrid checkers emit meters of both kinds.
- Period fields are flat. A balance meter omits all of them.
- `utilizationPercent` is required (no `?`); when it's not knowable,
  the checker emits `'unknown'` or `'not_applicable'` explicitly. The
  UI uses these sentinels to suppress the progress bar / colour scale
  and just print the raw `remaining` value instead.
- `exhaustionThreshold`'s meaning depends on `kind` — see § 5.3.
- The estimation/projection block from the current `QuotaWindow` is
  kept unchanged on `Meter` (omitted above for brevity).

### 3.6 The CheckResult shape

```ts
interface QuotaCheckResult {
  checkerId: string;     // unique instance id chosen by the operator
  checkerType: string;   // 'claude-code', 'neuralwatt', etc.
  provider: string;      // routing provider this checker is attached to
  checkedAt: string;     // ISO-8601
  success: boolean;
  error?: string;

  meters: Meter[];       // 0..N independent meters
}
```

Notes:

- `meters` is the only payload. There are no `windows`, no `groups`,
  no checker-level `category`. If a provider exposes per-model rows,
  each row is a separate meter (with the model name in `scope` and an
  optional `group` to roll related models together).
- There is **no `rawResponse` field.** It exists today as a debugging
  aid and gets used as a feature crutch (frontend code reaching into
  raw provider JSON because the modelled fields are insufficient).
  Anything the rest of the system needs goes into a meter; nothing
  else gets a sneak path. Raw provider responses, when needed for
  debugging a checker, are written to the debug log by the checker
  itself.
- `oauthProvider`/`oauthAccountId` are **not** on the result. They're
  duplicative with checker config; the API resolves them on demand
  when the UI needs to label an account.

### 3.7 Worked examples (existing providers in the new model)

**Naga** (pure dollar balance, no known total):
```js
meters: [{
  key: 'balance', label: 'Account balance',
  kind: 'balance', unit: 'usd',
  remaining: 12.34,
  utilizationPercent: 'not_applicable',     // unbounded prepaid
  status: 'ok',
}]
```

**Wisdom Gate** (monthly subscription credit allowance):
```js
meters: [{
  key: 'monthly_credits', label: 'Wisdom Gate subscription',
  kind: 'allowance', unit: 'usd',
  limit: 50, used: 18.20, remaining: 31.80,
  periodValue: 1, periodUnit: 'month', periodCycle: 'fixed',
  resetsAt: '2026-05-01T00:00:00Z',
  utilizationPercent: 36.4, status: 'ok',
}]
```

**Claude Code** (two allowances, percentage-only):
```js
meters: [
  { key: 'five_hour', label: '5-hour quota',
    kind: 'allowance', unit: 'percentage',
    used: 27, remaining: 73,
    periodValue: 5, periodUnit: 'hour', periodCycle: 'rolling',
    resetsAt: '2026-04-25T18:00:00Z',
    utilizationPercent: 27, status: 'ok' },
  { key: 'weekly', label: 'Weekly quota',
    kind: 'allowance', unit: 'percentage',
    used: 41, remaining: 59,
    periodValue: 7, periodUnit: 'day', periodCycle: 'rolling',
    resetsAt: '2026-04-30T00:00:00Z',
    utilizationPercent: 41, status: 'ok' },
]
```

**Synthetic** (mixed: rolling-5h requests, hourly fixed search, rolling-week dollars):
```js
meters: [
  { key: 'rolling_5h', label: 'Rolling 5-hour limit',
    kind: 'allowance', unit: 'requests',
    limit: 200, used: 37, remaining: 163,
    periodValue: 5, periodUnit: 'hour', periodCycle: 'rolling',
    utilizationPercent: 18.5, status: 'ok' },
  { key: 'search_hourly', label: 'Search', scope: 'search',
    kind: 'allowance', unit: 'requests',
    periodValue: 1, periodUnit: 'hour', periodCycle: 'fixed',
    resetsAt: '2026-04-25T18:00:00Z', ... },
  { key: 'weekly_credits', label: 'Weekly token credits',
    kind: 'allowance', unit: 'usd',
    periodValue: 7, periodUnit: 'day', periodCycle: 'rolling', ... },
]
```

**Neuralwatt** (hybrid: balance + monthly energy allowance):
```js
meters: [
  { key: 'credits', label: 'Credit balance',
    kind: 'balance', unit: 'usd',
    limit: 100, used: 23.50, remaining: 76.50,
    utilizationPercent: 23.5, status: 'ok' },
  { key: 'energy', label: 'Energy quota',
    kind: 'allowance', unit: 'kwh',
    limit: 50, used: 12.4, remaining: 37.6,
    periodValue: 1, periodUnit: 'month', periodCycle: 'fixed',
    resetsAt: '2026-05-01T00:00:00Z',
    utilizationPercent: 24.8, status: 'ok' },
]
```

**Apertis** (single checker, both PAYG balance and cycle quota from
one response):
```js
meters: [
  { key: 'payg', label: 'PAYG balance',
    kind: 'balance', unit: 'usd', remaining: 8.42,
    utilizationPercent: 'not_applicable', status: 'ok' },
  { key: 'cycle_quota', label: 'Apertis pro plan',
    kind: 'allowance', unit: 'requests',
    limit: 5000, used: 1200, remaining: 3800,
    periodValue: 1, periodUnit: 'month', periodCycle: 'fixed',
    resetsAt: '2026-05-01T00:00:00Z',
    utilizationPercent: 24, status: 'ok' },
]
```

**Poe** (opaque points balance, no known total):
```js
meters: [{
  key: 'balance', label: 'POE point balance',
  kind: 'balance', unit: 'points',
  remaining: 1_350_000,
  utilizationPercent: 'not_applicable',
  status: 'ok',
}]
```

**Zenmux** (rolling flows in provider's own terminology):
```js
meters: [{
  key: 'flows_5h', label: '5-hour rolling',
  kind: 'allowance', unit: 'flows',     // non-canonical, kept verbatim
  limit: 100, used: 18, remaining: 82,
  periodValue: 5, periodUnit: 'hour', periodCycle: 'rolling',
  resetsAt: '2026-04-25T18:00:00Z',
  utilizationPercent: 18, status: 'ok',
}]
```

**Antigravity** (per-model rows, grouped by family):
```js
meters: [
  { key: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro',
    group: 'Pro', scope: 'gemini-2.5-pro',
    kind: 'allowance', unit: 'percentage',
    used: 12, remaining: 88,
    periodValue: 5, periodUnit: 'hour', periodCycle: 'rolling',
    utilizationPercent: 12, status: 'ok' },
  { key: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash',
    group: 'Flash', scope: 'gemini-2.5-flash',
    kind: 'allowance', unit: 'percentage',
    used: 3, remaining: 97,
    periodValue: 5, periodUnit: 'hour', periodCycle: 'rolling',
    utilizationPercent: 3, status: 'ok' },
  // ... one meter per model, sorted by group in the UI
]
```

**Moonshot** (cash and voucher balances surfaced separately):
```js
meters: [
  { key: 'cash', label: 'Cash balance', scope: 'cash',
    kind: 'balance', unit: 'usd',
    remaining: 4.20, utilizationPercent: 'not_applicable', status: 'ok' },
  { key: 'voucher', label: 'Voucher balance', scope: 'voucher',
    kind: 'balance', unit: 'usd',
    remaining: 25.00, utilizationPercent: 'not_applicable', status: 'ok' },
]
```

## 4. Database Schema

A new table — `meter_snapshots` — is created from scratch. The existing
`quota_snapshots` table is left alone and ignored by the new code. There
is no data migration. Anything historical that someone wants from the old
table can be addressed separately, later.

### 4.1 `meter_snapshots`

One row per (checker invocation, meter). Columns:

| Column                  | Type           | Notes                                                    |
|-------------------------|----------------|----------------------------------------------------------|
| `id`                    | int PK         |                                                          |
| `checker_id`            | text           | operator-chosen instance id                              |
| `checker_type`          | text           | e.g. `'claude-code'`                                     |
| `provider`              | text           | routing provider this checker is attached to             |
| `meter_key`             | text           | checker-local id, e.g. `'five_hour'`, `'balance'`        |
| `kind`                  | text           | `'balance'` or `'allowance'`                             |
| `unit`                  | text           | open string; canonical names recommended (§ 3.3)         |
| `label`                 | text           | human-readable, set by the checker                       |
| `group`                 | text NULL      | optional UI grouping (e.g. "Pro models")                 |
| `scope`                 | text NULL      | optional resource scope (e.g. model name, "cash")        |
| `limit`                 | real NULL      |                                                          |
| `used`                  | real NULL      |                                                          |
| `remaining`             | real NULL      |                                                          |
| `utilization_state`     | text           | `'reported'` / `'unknown'` / `'not_applicable'`          |
| `utilization_percent`   | real NULL      | the 0..100 number when `utilization_state = 'reported'`  |
| `status`                | text           | `'ok'` / `'warning'` / `'critical'` / `'exhausted'`      |
| `period_value`          | int NULL       | only for allowances                                      |
| `period_unit`           | text NULL      | `'minute'` / `'hour'` / `'day'` / `'week'` / `'month'`   |
| `period_cycle`          | text NULL      | `'fixed'` / `'rolling'`                                  |
| `resets_at`             | timestamp NULL | when the meter next regains capacity                     |
| `success`               | bool           | did the checker call succeed                             |
| `error_message`         | text NULL      |                                                          |
| `checked_at`            | timestamp      |                                                          |
| `created_at`            | timestamp      |                                                          |

`utilization_state` is a small derived column rather than overloading
`utilization_percent` with NULL/sentinels. Keeping the number column
purely numeric makes history graphs trivial: `WHERE utilization_state =
'reported'` filters out the rows that don't plot.

Indexes:

- `(checker_id, meter_key, checked_at)` — primary access path for the
  history modal and the "latest meter" lookup.
- `(provider, checked_at)` — for any cross-provider scans.
- `(checked_at)` — for retention sweeps.

### 4.2 No SQL enums

All categorical columns (`kind`, `unit`, `period_cycle`, `period_unit`,
`status`, `utilization_state`, `checker_type`) are plain `text`.
Validation lives in code; the checker layer is the only thing that
writes to this table.

`unit` in particular is intentionally open (see § 3.3) — adding a new
unit (or a new checker type) costs zero database migrations.

## 5. Backend

### 5.1 Checker registration

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

### 5.2 Base behaviour

Each checker's `check(ctx)` returns a `Meter[]`. Helpers on the context
build meters with derived fields filled in:

```ts
ctx.balance({ key, label, unit, remaining, limit?, group?, scope? })
ctx.allowance({ key, label, unit, used, limit?, remaining?,
                periodValue, periodUnit, periodCycle, resetsAt?,
                group?, scope? })
```

`utilizationPercent` and `status` are derived inside the helper — the
checker does not compute them. There is no checker-level `category`,
`window`, or `category` getter.

Configuration like `maxUtilizationPercent` lives in the checker's own
options schema. If a checker wants to expose per-meter overrides, it
does so via its own option shape; the base class doesn't pretend to
solve it generically.

### 5.3 Cooldown / scheduler

Cooldown injection iterates over the latest meters for each checker
attached to a provider. Both kinds of meter participate, but they use
the threshold differently:

**Allowance meters.** `exhaustionThreshold` is a percentage. When
`utilizationPercent >= threshold` (default 99), the provider is cooled
down until the meter's `resetsAt` (if known). If `resetsAt` is unknown
the cooldown lasts until the next checker poll. `utilizationPercent`
sentinels (`'unknown'`, `'not_applicable'`) skip cooldown evaluation
for that meter.

**Balance meters.** `exhaustionThreshold` is a **floor on `remaining`**
in the meter's `unit`. When `remaining <= threshold`, the provider is
cooled down. The cooldown lasts until the **next normally-scheduled
checker poll** — a balance can be topped up out-of-band at any moment,
so we just keep checking at the configured cadence; we do not
accelerate polling when exhausted, and we do not extend the cooldown
beyond it.

Defaults:

- For `unit === 'usd'`, the default floor is **`0.50`** (i.e. cool
  down once the balance falls to fifty cents or below). USD balances
  are the common case and "near zero" is meaningful here.
- For all other units, the default floor is `0`. There is no
  one-size-fits-all "near zero" for points, tokens, or kWh — the
  operator sets the floor per-checker if they want a buffer.

Every meter contributes to the cooldown decision; the most-constrained
one wins. The "strictest threshold" calculation iterates all meters
across all checkers attached to the provider, so a lenient checker
can't lift a cooldown that a strict one set.

### 5.4 API response shape

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

## 6. Frontend

### 6.1 Two generic display components, not 21

Replace the per-checker `XxxQuotaDisplay.tsx` family with two generic
components:

- `BalanceMeterRow` — wallet icon, label, formatted `remaining` value,
  optional progress bar when `limit` is known.
- `AllowanceMeterRow` — progress bar with `utilizationPercent`, a
  label, `used / limit` formatted by unit, and a countdown to
  `resetsAt` if present.

`MeterValue.tsx` formats a number based on `unit`. For canonical units
it uses a known formatter; for **anything else, the unit string is
shown verbatim** as the suffix:

```ts
function formatMeterValue(v: number, unit: string): string {
  switch (unit) {
    case 'usd':        return formatCost(v);
    case 'tokens':     return formatTokens(v);
    case 'requests':   return `${formatNumber(v)} reqs`;
    case 'kwh':        return `${v.toFixed(3)} kWh`;
    case 'points':     return `${formatPointsFull(v)} pts`;
    case 'percentage': return `${Math.round(v)}%`;
    default:           return `${formatNumber(v)} ${unit}`;
  }
}
```

A meter with `unit: 'flows'` therefore renders as `82 flows`, matching
what the provider's docs call them. The provider-config UI shows the
unit string the same way — verbatim, not coerced to a friendly label.

Display also respects the `utilizationPercent` sentinels: `'unknown'`
and `'not_applicable'` suppress the progress bar and colour scale,
showing only the raw `remaining` value.

Meters that share a `group` are rendered under a sub-heading inside
the same checker card; otherwise each meter gets its own row.

### 6.2 Sidebar / dashboard sections

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

### 6.3 Per-checker icons (the only thing that stays per-checker)

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

### 6.4 Per-checker config components

Config components stay, because each checker has different config inputs
(API key URL, organisation id, cookie name, …). But:

- They're discovered by `checkerType`, not imported one-by-one in
  `Providers.tsx`. A registry like `CONFIG_COMPONENTS[checkerType]`
  replaces the long `if/else` ladder.
- The default config component (no extra fields) is used when no
  registry entry exists, so adding a checker with no extra options
  needs zero frontend changes.

### 6.5 Frontend types

`packages/frontend/src/types/quota.ts` is rewritten to mirror the
backend shape — `Meter`, `MeterKind`, `MeterUnit`, `Period`, etc. The
old `QuotaWindow`/`QuotaWindowType` types are removed.

## 7. Implementation Order

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

## 8. What this fixes, concretely

Tying it back to the issues from § 1:

| Problem                                       | Resolution                                              |
|-----------------------------------------------|---------------------------------------------------------|
| `category` on the wrong object                | Moved to `kind` on each meter.                          |
| `windowType` conflates four axes              | Split into `kind`, flat `period*` fields, and `group`/`scope`. |
| `unit: 'points'` overloaded for kWh           | New `kwh` unit. `points` reserved for opaque provider currencies. |
| Hybrid checkers need manual override sets     | Mixed checkers naturally emit meters of both kinds.     |
| 21 near-duplicate display components          | Two generic row components + a presentation registry.   |
| 4 parallel checker-type registrations         | `defineChecker` self-registers; a single in-process registry serves API, factory, and validation. |
| Apertis pays for two API calls                | Single checker emits both meters from one response.     |
| `getTrackedWindowsForChecker` 23-arm switch   | Deleted — every meter is rendered the same way.         |
| OAuth fields duplicated on every snapshot     | Removed from the wire shape; resolved from checker config only when needed. |

## 9. Resolved decisions

For posterity, the points that were called out during review and
folded into the design above:

| Decision                               | Choice                                                      | Where it lives          |
|----------------------------------------|-------------------------------------------------------------|-------------------------|
| Default balance-cooldown floor (USD)   | `$0.50`                                                     | § 5.3                   |
| Default balance-cooldown floor (other) | `0`                                                         | § 5.3                   |
| Polling cadence when exhausted         | Keep the configured cadence; don't accelerate or extend     | § 5.3                   |
| Per-model meter retention              | Store every row; let retention sweeps handle it             | § 4.1                   |
| `subject` overloading                  | Split into `group` (UI rollup) and `scope` (resource id)    | § 3.5, § 3.7, § 4.1     |
| Rolling-window `resetsAt`              | Keep populated; means "earliest visible improvement"        | § 3.4                   |
| Open `unit` strings in the UI          | Render verbatim, don't coerce to friendly labels            | § 3.3, § 6.1            |

