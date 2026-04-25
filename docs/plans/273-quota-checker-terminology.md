# Quota Checker Terminology & Data Model Plan

> **Issue:** #273 — Quota Checker Terminology is Complex and Inconsistent
>
> **Status:** Planning / Design Document — no implementation changes yet

---

## Table of Contents

1. [Current State: What's Wrong](#1-current-state-whats-wrong)
2. [Real-World Provider Quota Patterns](#2-real-world-provider-quota-patterns)
3. [Design Principles](#3-design-principles)
4. [Proposed Data Model](#4-proposed-data-model)
5. [How Each Existing Checker Maps](#5-how-each-existing-checker-maps)
6. [Frontend Rendering Strategy](#6-frontend-rendering-strategy)
7. [Migration Path](#7-migration-path)
8. [Open Questions](#8-open-questions)

---

## 1. Current State: What's Wrong

### 1.1 Binary Category Is Too Simplistic

Every checker declares `category: 'balance' | 'rate-limit'`. This binary is insufficient:

| Checker | Has Balance? | Has Rate Limit? | Current Category |
|---------|-------------|-----------------|-----------------|
| Neuralwatt | ✅ USD credits | ✅ Monthly kWh subscription | `balance` (with hack) |
| WisdomGate | ✅ USD subscription (with limit) | ❌ | `balance` |
| Apertis | ✅ PAYG USD | Also has coding plan (separate checker) | `balance` |
| Synthetic | ❌ | ✅ Multiple windows (5h, weekly, search) | `rate-limit` |

**Workaround:** The frontend maintains `BALANCE_CHECKERS_WITH_RATE_LIMIT = new Set(['neuralwatt'])` — a hardcoded hack to show Neuralwatt in both sections.

### 1.2 Mixed Terminology in `QuotaWindowType`

The `QuotaWindowType` union conflates three different concepts:

```
Time windows:     'hourly' | 'five_hour' | 'rolling_five_hour' | 'daily' | 'weekly' | 'rolling_weekly' | 'monthly'
Semantic windows: 'subscription' | 'search' | 'toolcalls'
Catch-all:        'custom'
```

- `'subscription'` means "a prepaid balance that doesn't reset on a schedule" — but it's listed alongside time windows
- `'search'` and `'toolcalls'` describe *what* is being measured, not *when* it resets
- `'rolling_five_hour'` vs `'five_hour'` — unclear distinction from the frontend's perspective
- `'custom'` is a catch-all used by MiniMax Coding and Kimi Code because nothing else fits

### 1.3 Mixed Dimensions in `QuotaUnit`

```
Denomination:  'dollars' | 'points' | 'kwh'
Measurement:   'requests' | 'tokens'
Representation: 'percentage'
```

- `dollars`, `points`, `kwh` describe **what** is being consumed
- `requests`, `tokens` describe **how** it's measured
- `percentage` is a fallback when the provider gives no absolute numbers — it's a representation, not a unit

These are orthogonal axes. A subscription plan might be denominated in dollars but measured per-token. A rate limit might use points or requests.

### 1.4 Per-Checker Frontend Coupling

Adding a new checker requires changes in **8+ files** on the frontend:

1. New `XxxQuotaDisplay.tsx` component
2. New `XxxQuotaConfig.tsx` component
3. Export in `components/quota/index.ts`
4. Entry in `DISPLAY_MAP` in `Quotas.tsx`
5. Entry in `CHECKER_DISPLAY_NAMES` in `Quotas.tsx`
6. Entry in `CHECKER_DISPLAY_NAMES` in `CombinedBalancesCard.tsx` (different map!)
7. Entry in `getCheckerCategory()` in `CompactQuotasCard.tsx`
8. Entry in `getTrackedWindowsForChecker()` in `CompactQuotasCard.tsx`
9. Possibly `BALANCE_CHECKERS_WITH_RATE_LIMIT` or other hacks

The backend has an analogous problem: each checker needs a config Zod schema, a discriminated union entry, and registration in the factory.

### 1.5 The `windowType: 'subscription'` Overload

`'subscription'` is used for balance-type windows (remaining credits). But many *rate-limit* checkers also represent subscription plans (Apertis Coding Plan, Copilot, NanoGPT). The name implies "subscription" but really means "no-schedule-balance."

### 1.6 Display Name Proliferation

There are **three separate display-name maps**:
- `CHECKER_DISPLAY_NAMES` in `Quotas.tsx`
- `CHECKER_DISPLAY_NAMES` in `CombinedBalancesCard.tsx`
- `getTypeDisplayName()` in `CompactQuotasCard.tsx`

These are already out of sync — the CombinedBalancesCard map is a subset of the Quotas.tsx map.

---

## 2. Real-World Provider Quota Patterns

After reviewing all 22 checker implementations, here are the distinct quota patterns:

### Pattern A: Prepaid Balance (no time limit)

A dollar or point balance that decreases as you use it and can be topped up.

| Provider | Unit | Notes |
|----------|------|-------|
| OpenRouter | dollars | total_credits - total_usage |
| Naga | dollars | Simple balance |
| Kilo | dollars | Simple balance |
| Moonshot | dollars | available_balance |
| Novita | dollars | availableBalance (in 0.0001 USD units) |
| MiniMax | dollars | available_amount |
| Apertis | dollars | PAYG account_credits |
| WisdomGate | dollars | total_available (subscription with limit) |
| POE | points | current_point_balance |

**Key trait:** No reset time. Balance simply decreases. Wallet icon. "Balance" display.

### Pattern B: Time-Windowed Rate Limit (percentage-based)

The provider gives usage as a percentage of some unknown limit.

| Provider | Window(s) | Notes |
|----------|-----------|-------|
| Claude Code | 5-hour + weekly | Both percentages |
| OpenAI Codex | 5-hour + weekly (secondary) | Primary/secondary windows |
| Gemini CLI | 5-hour | Per-model quotas, aggregated |
| Antigravity | 5-hour | Per-model quotas |
| Ollama | session(5h) + weekly | Scraped from HTML |

**Key trait:** No absolute limits — only percentages. Progress bar display.

### Pattern C: Time-Windowed Rate Limit (absolute counts)

The provider gives concrete used/remaining/limit numbers.

| Provider | Window(s) | Unit |
|----------|-----------|------|
| Copilot | monthly | requests (premium interactions) |
| Apertis Coding Plan | monthly | requests |
| MiniMax Coding | custom (rolling) | requests |
| Kimi Code | custom/5h/daily | requests |
| ZAI | 5-hour + monthly | percentage + requests |
| NanoGPT | weekly + daily | tokens + requests (images) |
| Zenmux | 5-hour + weekly | points (flow counts) |
| Synthetic | 5-hour rolling + weekly rolling + hourly search | requests + dollars |

**Key trait:** Concrete numbers. Progress bar with "X / Y" display.

### Pattern D: Hybrid (Balance + Subscription)

The provider has BOTH a prepaid balance AND subscription-based rate limits.

| Provider | Balance | Rate Limit |
|----------|---------|------------|
| Neuralwatt | USD credits | Monthly kWh energy quota |

**Key trait:** Needs to appear in both "Balances" and "Quotas" sections. Current system hacks this.

### Pattern E: Dual-Nature Subscription

A subscription plan that includes a finite allocation that behaves like a balance but resets periodically.

| Provider | Notes |
|----------|-------|
| WisdomGate | Has `total_available` (looks like a balance) but is actually a subscription |
| Apertis Coding Plan | Monthly cycle quota that resets |

**Key trait:** Has a limit, used, remaining, AND a reset time. Could be displayed as either a balance or a rate limit depending on perspective.

---

## 3. Design Principles

### P1: Windows Are Self-Describing

Each window should carry enough metadata that a **generic frontend component** can render it correctly without knowing which checker produced it. No per-checker display components.

### P2: Separate What From When

The **measurement** (what is being tracked) and the **schedule** (when it resets) are independent axes. Don't conflate them.

### P3: A Checker Produces Windows, Not Categories

Don't force checkers into a `balance` or `rate-limit` bucket. Let the frontend decide how to group and display windows based on their properties.

### P4: Minimize Per-Checker Frontend Code

Adding a new checker should ideally require **zero** frontend code changes. The generic display components should handle any window combination.

### P5: Single Source of Truth for Display Names

Checker display names should come from the backend (or a single shared source), not from three divergent frontend maps.

### P6: Backward-Compatible Evolution

The migration should be incremental — existing checkers continue to work while the new system is adopted.

---

## 4. Proposed Data Model

### 4.1 Core Concept: `QuotaMeasurement`

Separate what's being measured from the unit of denomination:

```typescript
/** What is being physically measured */
type QuotaMeasurement = 
  | 'requests'     // Count of API calls
  | 'tokens'       // Count of tokens (input + output)
  | 'credits'      // Abstract credits/points (provider-defined)
  | 'flows'        // Count of logical flows (e.g., Zenmux)
  | 'energy'       // Energy consumption (kWh)
  | 'inference'    // Inference-specific requests (vs search, tool calls, etc.)
  | 'search'       // Search-specific requests
  | 'tool_calls'   // Tool-call-specific requests
  | 'images'       // Image generation requests
  | 'unknown';     // Provider doesn't specify
```

### 4.2 Core Concept: `QuotaDenomination`

What the numbers represent in human terms:

```typescript
/** What the numbers represent */
type QuotaDenomination = 
  | 'usd'          // US dollars
  | 'points'       // Provider-specific point system
  | 'kwh'          // Kilowatt-hours
  | 'count'        // Raw count (requests, tokens, etc.)
  | 'percentage';  // Only percentage available (no absolute numbers)
```

### 4.3 Core Concept: `QuotaSchedule`

When/how the quota resets:

```typescript
/** How the quota resets over time */
type QuotaSchedule =
  | { type: 'none' }                                // Balance — never resets
  | { type: 'periodic'; period: QuotaPeriod; anchor?: string }  // Calendar-aligned
  | { type: 'rolling'; windowMs: number }           // Rolling/leaky bucket
  | { type: 'unknown' };                            // Provider doesn't specify

type QuotaPeriod = 'hourly' | 'daily' | 'weekly' | 'monthly' | 'custom';
```

### 4.4 Core Concept: Enhanced `QuotaWindow`

```typescript
interface QuotaWindow {
  // ── Identity ──
  /** Unique key for deduplication (replaces windowType+description combo) */
  key: string;
  /** Human-readable label (e.g., "5-Hour Request Limit", "Credit Balance") */
  label: string;
  /** Optional longer description */
  description?: string;
  
  // ── Measurement ──
  /** What is being measured */
  measurement: QuotaMeasurement;
  /** What the numbers represent */
  denomination: QuotaDenomination;
  
  // ── Values ──
  /** Maximum value for this window (undefined for open-ended balances) */
  limit?: number;
  /** Amount consumed */
  used?: number;
  /** Amount remaining */
  remaining?: number;
  /** Utilization as a percentage (0-100) */
  utilizationPercent: number;
  
  // ── Schedule ──
  /** How this quota resets */
  schedule: QuotaSchedule;
  /** Absolute time when this window resets (if applicable) */
  resetsAt?: Date;
  /** Seconds until reset (computed) */
  resetInSeconds?: number;
  
  // ── Status ──
  /** Overall health status */
  status: QuotaStatus;
  
  // ── Display Hints (optional) ──
  /** Suggested display priority (lower = more important) */
  priority?: number;
  /** Whether this is the "primary" window for its checker */
  isPrimary?: boolean;
}
```

### 4.5 Core Concept: Checker Metadata

```typescript
interface QuotaCheckerMetadata {
  /** Unique checker ID */
  checkerId: string;
  /** Checker type (e.g., 'openrouter', 'claude-code') */
  checkerType: string;
  /** Human-readable display name (single source of truth) */
  displayName: string;
  /** Whether this checker primarily represents a balance, rate-limit, or both */
  presentation: 'balance' | 'rate-limit' | 'mixed';
  /** Optional URL to the provider's dashboard */
  dashboardUrl?: string;
}
```

### 4.6 Core Concept: Enhanced `QuotaCheckResult`

```typescript
interface QuotaCheckResult {
  provider: string;
  checkerId: string;
  checkedAt: Date;
  success: boolean;
  error?: string;
  
  /** Checker metadata (replaces scattered display-name maps) */
  metadata: QuotaCheckerMetadata;
  
  /** All windows returned by this check */
  windows: QuotaWindow[];
  
  /** OAuth context (if applicable) */
  oauthAccountId?: string;
  oauthProvider?: string;
  
  /** Raw API response for debugging */
  rawResponse?: unknown;
}
```

### 4.7 How This Solves the Problems

| Problem | Solution |
|---------|----------|
| Binary balance/rate-limit | `schedule.type: 'none'` vs time-based. Frontend renders by schedule, not category. |
| Mixed terminology | `QuotaWindowType` replaced by orthogonal `measurement` + `schedule` |
| Mixed dimensions in unit | Split into `denomination` + `measurement` |
| Per-checker frontend coupling | Self-describing windows → generic rendering |
| `subscription` overload | No more `subscription` windowType. Balance windows have `schedule: { type: 'none' }` |
| Display name proliferation | Single `displayName` in checker metadata |
| Neuralwatt hack | Checker reports 2 windows with different schedules. Frontend sorts them naturally. |

---

## 5. How Each Existing Checker Maps

### Balance Checkers (schedule: 'none')

| Checker | measurement | denomination | label |
|---------|-------------|-------------|-------|
| OpenRouter | credits | usd | "OpenRouter Credits" |
| Naga | credits | usd | "Naga Balance" |
| Kilo | credits | usd | "Kilo Balance" |
| Moonshot | credits | usd | "Moonshot Balance" |
| Novita | credits | usd | "Novita Balance" |
| MiniMax | credits | usd | "MiniMax Balance" |
| Apertis | credits | usd | "Apertis PAYG Balance" |
| WisdomGate | credits | usd | "WisdomGate Balance" |
| POE | credits | points | "POE Point Balance" |

### Rate Limit Checkers (schedule: time-based)

| Checker | Window(s) | measurement | denomination | schedule |
|---------|-----------|-------------|-------------|----------|
| Claude Code | 5h + weekly | requests | percentage | periodic/custom |
| OpenAI Codex | 5h + weekly | requests | percentage | periodic/custom |
| Gemini CLI | 5h per-model | requests | percentage | periodic |
| Antigravity | 5h per-model | requests | percentage | periodic |
| Ollama | session(5h) + weekly | requests | percentage | periodic |
| Copilot | monthly | requests | count | periodic:monthly |
| Apertis Coding | monthly | requests | count | periodic:monthly |
| MiniMax Coding | custom | requests | count | rolling |
| Kimi Code | custom/5h | requests | count | rolling/periodic |
| ZAI | 5h + monthly | requests/credits | percentage/count | periodic |
| NanoGPT | weekly + daily | tokens/images | count | periodic |
| Zenmux | 5h + weekly | flows | count | rolling |
| Synthetic | 5h + weekly + hourly search | requests | count | rolling/periodic |

### Hybrid Checkers (multiple windows)

| Checker | Windows |
|---------|---------|
| Neuralwatt | Window 1: credits/usd/none (balance), Window 2: energy/kwh/periodic:monthly (rate limit) |
| Synthetic | Window 1: requests/count/rolling, Window 2: search requests/count/periodic, Window 3: credits/usd/rolling |
| NanoGPT | Window 1: tokens/count/periodic:weekly, Window 2: tokens/count/periodic:daily, Window 3: images/count/periodic:daily |
| ZAI | Window 1: requests/percentage/periodic:5h, Window 2: requests/count/periodic:monthly |

---

## 6. Frontend Rendering Strategy

### 6.1 Generic Window Renderer

Instead of per-checker display components, create a **single generic `QuotaWindowCard`** component that renders any window:

```tsx
function QuotaWindowCard({ window, checkerMetadata }) {
  // Balance-style (no schedule)
  if (window.schedule.type === 'none') {
    return <BalanceCard window={window} metadata={checkerMetadata} />;
  }
  
  // Rate-limit-style (has schedule)
  return <RateLimitCard window={window} metadata={checkerMetadata} />;
}
```

### 6.2 Smart Grouping

Instead of hard-coded balance/rate-limit categories, the frontend can group windows:

```typescript
function groupWindows(quotas: QuotaCheckResult[]) {
  const balances: WindowWithMeta[] = [];    // schedule.type === 'none'
  const rateLimits: WindowWithMeta[] = [];  // schedule.type !== 'none'
  
  for (const quota of quotas) {
    for (const window of quota.windows) {
      const entry = { window, metadata: quota.metadata };
      if (window.schedule.type === 'none') {
        balances.push(entry);
      } else {
        rateLimits.push(entry);
      }
    }
  }
  
  return { balances, rateLimits };
}
```

Neuralwatt naturally appears in both groups — no hack needed.

### 6.3 Sidebar Cards

- **CompactBalancesCard:** Iterates all windows with `schedule.type === 'none'`, renders each with wallet icon + formatted remaining
- **CompactQuotasCard:** Iterates all windows with `schedule.type !== 'none'`, renders with progress bar

Both cards use `metadata.displayName` for the label — no lookup maps.

### 6.4 Checker Display Hints

Checkers can optionally provide a `presentation` hint:

- `'balance'` → Show in sidebar balance section (primary display)
- `'rate-limit'` → Show in sidebar rate-limit section (primary display)
- `'mixed'` → Show windows in both sections as appropriate

This is a **hint**, not a hard category. The actual rendering is still driven by individual window schedules.

### 6.5 Eliminating Per-Checker Display Components

With self-describing windows, most checkers don't need custom display components. The generic renderer handles:

- Balance cards (wallet icon, remaining value, formatted by denomination)
- Progress bar cards (utilization%, limit/used/remaining, reset countdown)
- Multi-window cards (multiple progress bars within one checker)

The only checkers that might keep custom displays are those with genuinely unique UI requirements (e.g., Synthetic's search window, NanoGPT's image count). Even these could potentially be genericized.

### 6.6 Eliminating Display Name Maps

A single map on the backend (or in a shared config) provides `displayName` per checker type. The frontend receives it with the API response. No more three divergent maps.

---

## 7. Migration Path

### Phase 1: Add New Types (non-breaking)

1. Add `QuotaMeasurement`, `QuotaDenomination`, `QuotaSchedule` types
2. Extend `QuotaWindow` with new fields (`key`, `label`, `measurement`, `denomination`, `schedule`, `priority`, `isPrimary`)
3. Add `metadata` to `QuotaCheckResult`
4. Keep old fields (`windowType`, `unit`) for backward compat — populate both

### Phase 2: Backend Checker Updates

1. Update `QuotaChecker` base class to populate new fields alongside old ones
2. Migrate checkers one at a time to use new field names
3. Add `displayName` and `presentation` to each checker
4. Remove `category: 'balance' | 'rate-limit'` from base class → derive from windows

### Phase 3: Frontend Generic Components

1. Build generic `QuotaWindowCard` component
2. Build generic `CompactBalanceWindow` and `CompactRateLimitWindow`
3. Update sidebar to use generic grouping logic
4. Update Quotas page to use generic rendering
5. Remove `BALANCE_CHECKERS_WITH_RATE_LIMIT` hack
6. Remove per-checker display components (gradually)
7. Remove three display-name maps

### Phase 4: Clean Up Old Types

1. Remove `windowType` field (replaced by `measurement` + `schedule`)
2. Remove `unit` field (replaced by `denomination` + `measurement`)
3. Remove `category` from `QuotaChecker`
4. Remove old `QuotaWindowType` union

### Phase 5: Checker Config Simplification (optional)

Consider whether the per-checker Zod schemas and factory registration can be simplified. This is a larger refactor and may be a separate effort.

---

## 8. Open Questions

### Q1: Should `presentation` be a checker-level or window-level property?

**Current proposal:** Checker-level `presentation` hint + window-level `schedule`. 

**Alternative:** Only window-level. The checker has no opinion about presentation. The frontend groups purely by window properties.

**Recommendation:** Checker-level hint is useful for sidebar ordering (which section a checker "belongs to" by default) but shouldn't override window-level schedule for actual rendering.

### Q2: Should the `key` field be auto-generated or explicitly set?

Auto-generated from `measurement + denomination + schedule` would ensure consistency. Explicitly set allows custom keys like `"claude-code:5h"`.

**Recommendation:** Let checkers set `key` explicitly but provide a helper to auto-generate from other fields.

### Q3: Should we add a `windowCategory` or `displayAs` field?

Some checkers want to express that a window "looks like a balance" even though it has a reset schedule (e.g., WisdomGate's subscription with `total_available`).

**Recommendation:** The `schedule` field handles this. A `periodic:monthly` schedule with `limit/used/remaining` is clearly a rate limit, while a `none` schedule is clearly a balance. The edge case of "subscription that looks like a balance" is better handled by good labeling than by a special flag.

### Q4: How to handle per-model windows (Antigravity, Gemini CLI)?

These checkers return one window per model. Options:

a) Keep using `QuotaGroup` (current approach)
b) Flatten into individual windows with descriptive `key`/`label`
c) Add a `group` field to `QuotaWindow`

**Recommendation:** Option (b) — flatten. Each window has a unique `key` like `"antigravity:pro:5h"` and a `label` like `"Pro Plan"`. The frontend can group visually if needed. `QuotaGroup` can be deprecated.

### Q5: Should denomination include `'percentage'`?

Currently, `percentage` is a unit. In the new model, it would be a denomination. But it's really a fallback when the provider gives no absolute numbers.

**Recommendation:** Keep it as a denomination value. The frontend knows to show "73%" instead of "73 / 100" when denomination is `'percentage'`. Better than the current approach where percentage is mixed in with dollars and tokens.

### Q6: Database schema implications?

The `quota_snapshots` table stores individual window data. The new fields (`measurement`, `denomination`, `schedule`, `key`, `label`) need to be stored or derived. 

**Recommendation:** Store `key` and `label` in the snapshot. Store `measurement`, `denomination`, and `schedule` as JSON or individual columns. Since these are read-heavy and write-once, denormalization is fine.

---

## Appendix A: Current Checker Inventory

| # | Checker Type | Backend Category | Windows | Units | Complexity |
|---|-------------|-----------------|---------|-------|-----------|
| 1 | openrouter | balance | 1 (subscription) | dollars | Simple |
| 2 | naga | balance | 1 (subscription) | dollars | Simple |
| 3 | kilo | balance | 1 (subscription) | dollars | Simple |
| 4 | moonshot | balance | 1 (subscription) | dollars | Simple |
| 5 | novita | balance | 1 (subscription) | dollars | Simple |
| 6 | minimax | balance | 1 (subscription) | dollars | Simple |
| 7 | apertis | balance | 1 (subscription) | dollars | Simple |
| 8 | wisdomgate | balance | 1 (subscription) | dollars | Simple (but has limit) |
| 9 | poe | balance | 1 (subscription) | points | Simple |
| 10 | claude-code | rate-limit | 2 (5h + weekly) | percentage | Medium |
| 11 | openai-codex | rate-limit | 2 (5h + weekly) | percentage | Medium |
| 12 | gemini-cli | rate-limit | 2+ (per-model 5h) | percentage | Medium |
| 13 | antigravity | rate-limit | N (per-model 5h) | percentage | Medium |
| 14 | ollama | rate-limit | 2 (session + weekly) | percentage | Medium |
| 15 | copilot | rate-limit | 1 (monthly) | requests/percentage | Medium |
| 16 | apertis-coding-plan | rate-limit | 1 (monthly) | requests | Simple |
| 17 | minimax-coding | rate-limit | 1 (custom) | requests | Simple |
| 18 | kimi-code | rate-limit | 2+ (usage + limits) | requests | Medium |
| 19 | zai | rate-limit | 2 (5h + monthly) | percentage + requests | Medium |
| 20 | nanogpt | rate-limit | 3 (weekly + daily + daily images) | tokens + requests | Complex |
| 21 | zenmux | rate-limit | 2 (5h + weekly) | points | Medium |
| 22 | synthetic | rate-limit | 3 (5h + search + weekly) | requests + dollars | Complex |
| 23 | neuralwatt | balance (hack: mixed) | 2 (balance + monthly) | dollars + kwh | Complex |

## Appendix B: Proposed Type Definitions (Summary)

```typescript
// ─── Measurement (what is being counted) ───
type QuotaMeasurement = 
  | 'requests' | 'tokens' | 'credits' | 'flows' | 'energy'
  | 'inference' | 'search' | 'tool_calls' | 'images' | 'unknown';

// ─── Denomination (what the numbers mean) ───
type QuotaDenomination = 
  | 'usd' | 'points' | 'kwh' | 'count' | 'percentage';

// ─── Schedule (when/how it resets) ───
type QuotaSchedule =
  | { type: 'none' }
  | { type: 'periodic'; period: 'hourly' | 'daily' | 'weekly' | 'monthly' | 'custom'; anchor?: string }
  | { type: 'rolling'; windowMs: number }
  | { type: 'unknown' };

// ─── Window (one trackable quota dimension) ───
interface QuotaWindow {
  key: string;
  label: string;
  description?: string;
  measurement: QuotaMeasurement;
  denomination: QuotaDenomination;
  limit?: number;
  used?: number;
  remaining?: number;
  utilizationPercent: number;
  schedule: QuotaSchedule;
  resetsAt?: Date;
  resetInSeconds?: number;
  status: QuotaStatus;
  priority?: number;
  isPrimary?: boolean;
}

// ─── Checker Metadata ───
interface QuotaCheckerMetadata {
  checkerId: string;
  checkerType: string;
  displayName: string;
  presentation: 'balance' | 'rate-limit' | 'mixed';
  dashboardUrl?: string;
}

// ─── Check Result ───
interface QuotaCheckResult {
  provider: string;
  checkerId: string;
  checkedAt: Date;
  success: boolean;
  error?: string;
  metadata: QuotaCheckerMetadata;
  windows: QuotaWindow[];
  oauthAccountId?: string;
  oauthProvider?: string;
  rawResponse?: unknown;
}
```
