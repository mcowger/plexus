# Quota Tracking System - Implementation Plan

## Overview

This document describes the implementation plan for a quota tracking system in Plexus. The system provides:

1. An abstract `QuotaChecker` base class for implementing provider-specific quota checks
2. Concrete implementations for Synthetic, Anthropic/Claude, and Antigravity
3. A `QuotaScheduler` service to run checks on configurable intervals
4. A Drizzle-backed database schema for historical tracking
5. Configuration via `plexus.yaml`
6. Management API routes for viewing and triggering quota checks

---

## 1. Data Model Design

### 1.1 Unified Quota Response Types

All quota checkers return a normalized structure. Key types:

**`QuotaWindowType`** - The type of time window for the quota:
- `subscription` - Monthly/billing cycle based
- `hourly` - Hourly rolling window
- `five_hour` - 5-hour rolling window (Anthropic)
- `daily` - Daily reset
- `weekly` - 7-day rolling window (Anthropic)
- `monthly` - Calendar month
- `custom` - Provider-specific window

**`QuotaUnit`** - How the quota is measured:
- `dollars` - Cost-based (e.g., $40/month)
- `requests` - Request count based
- `tokens` - Token-based limits
- `percentage` - Utilization percentage (0-100)

**`QuotaWindow`** - A single quota measurement:
```typescript
interface QuotaWindow {
  windowType: QuotaWindowType;
  windowLabel?: string;        // Human-readable label
  limit?: number;              // Max allowed (if known)
  used?: number;               // Amount consumed
  remaining?: number;          // Amount left
  utilizationPercent: number;  // 0-100, always calculated
  unit: QuotaUnit;
  resetsAt?: Date;             // When this window resets
  resetInSeconds?: number;     // Seconds until reset
  status?: 'ok' | 'warning' | 'critical' | 'exhausted';
}
```

**`QuotaGroup`** - For providers with model-specific quotas:
```typescript
interface QuotaGroup {
  groupId: string;             // e.g., 'claude-gpt', 'gemini-3-pro'
  groupLabel: string;          // Human-readable name
  models: string[];            // Models in this group
  windows: QuotaWindow[];      // Multiple windows possible
}
```

**`QuotaCheckResult`** - The complete result of a quota check:
```typescript
interface QuotaCheckResult {
  provider: string;            // Provider identifier
  checkerId: string;           // Unique checker instance ID
  checkedAt: Date;
  success: boolean;
  error?: string;
  windows?: QuotaWindow[];     // Flat structure for simple providers
  groups?: QuotaGroup[];       // Grouped structure for model-specific quotas
  rawResponse?: unknown;       // Raw response for debugging
}
```

### 1.2 Database Schema

**Table: `quota_snapshots`**

Stores historical snapshots of quota checks for trend analysis.

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER | Primary key, auto-increment |
| `provider` | TEXT | Provider name (e.g., 'synthetic', 'anthropic') |
| `checker_id` | TEXT | Unique checker instance ID |
| `group_id` | TEXT | For model-specific quotas (nullable) |
| `window_type` | TEXT | Window type ('subscription', 'five_hour', etc.) |
| `checked_at` | INTEGER | Unix timestamp ms of the check |
| `limit` | REAL | Max capacity (if known) |
| `used` | REAL | Amount consumed |
| `remaining` | REAL | Amount remaining |
| `utilization_percent` | REAL | 0-100 utilization |
| `unit` | TEXT | Unit type ('dollars', 'requests', etc.) |
| `resets_at` | INTEGER | Unix timestamp ms when quota resets |
| `status` | TEXT | Status ('ok', 'warning', 'critical', 'exhausted') |
| `success` | INTEGER | Whether the check succeeded (0/1) |
| `error_message` | TEXT | Error message if check failed |
| `created_at` | INTEGER | Row creation timestamp |

**Indexes:**
- `idx_quota_provider_checked` on (provider, checked_at)
- `idx_quota_checker_window` on (checker_id, window_type, checked_at)
- `idx_quota_group_window` on (group_id, window_type, checked_at)
- `idx_quota_checked_at` on (checked_at)

---

## 2. Abstract QuotaChecker Class

**File:** `packages/backend/src/services/quota/quota-checker.ts`

The base class provides:

### Configuration Interface
```typescript
interface QuotaCheckerConfig {
  id: string;                    // Unique identifier
  provider: string;              // Provider name
  enabled: boolean;
  intervalMinutes: number;       // Check frequency
  options: Record<string, unknown>; // Provider-specific options
}
```

### Abstract Method
```typescript
abstract checkQuota(): Promise<QuotaCheckResult>;
```

### Helper Methods
- `getOption<T>(key, defaultValue)` - Get typed option with default
- `requireOption<T>(key)` - Get required option (throws if missing)
- `calculateUtilization(used, limit, remaining)` - Calculate percentage
- `determineStatus(utilizationPercent)` - Map utilization to status
- `successResult(data)` - Build success result
- `errorResult(error)` - Build error result

---

## 3. Concrete Implementations

### 3.1 Synthetic Quota Checker

**File:** `packages/backend/src/services/quota/checkers/synthetic-checker.ts`

**API Endpoint:** `GET /v2/quotas`

**Required Options:**
- `apiKey` - Synthetic API key

**Optional Options:**
- `endpoint` - Override endpoint URL (default: `https://api.synthetic.new/v2/quotas`)

**Parses:**
- `subscription` - Monthly dollar-based quota
- `search.hourly` - Hourly search request quota
- `toolCallDiscounts` - Daily tool call discount quota

### 3.2 Anthropic/Claude Quota Checker

**File:** `packages/backend/src/services/quota/checkers/anthropic-checker.ts`

**Method:** Makes a minimal 1-token inference request and reads rate limit headers.

**Required Options:**
- `apiKey` - Anthropic API key

**Optional Options:**
- `endpoint` - Override API endpoint
- `model` - Model to use for probe (default: `claude-haiku-4-5`)

**Headers Parsed:**
| Header | Purpose |
|--------|---------|
| `Anthropic-Ratelimit-Unified-Status` | Main status |
| `Anthropic-Ratelimit-Unified-Representative-Claim` | Which window is representative |
| `Anthropic-Ratelimit-Unified-5h-Status` | 5-hour window status |
| `Anthropic-Ratelimit-Unified-5h-Reset` | 5-hour reset timestamp |
| `Anthropic-Ratelimit-Unified-5h-Utilization` | 5-hour utilization % |
| `Anthropic-Ratelimit-Unified-7d-Status` | 7-day window status |
| `Anthropic-Ratelimit-Unified-7d-Reset` | 7-day reset timestamp |
| `Anthropic-Ratelimit-Unified-7d-Utilization` | 7-day utilization % |

**Returns:**
- `five_hour` window with utilization and reset time
- `weekly` window with utilization and reset time

### 3.3 Antigravity Quota Checker

**File:** `packages/backend/src/services/quota/checkers/antigravity-checker.ts`

**Method:** POST to fetchAvailableModels endpoint with project ID.

**Required Options:**
- `credentialsPath` - Path to Google credentials JSON

**Optional Options:**
- `projectId` - Override project ID (default: `bamboo-precept-lgxtn`)

**Endpoints (tried in order):**
1. `https://daily-cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels`
2. `https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:fetchAvailableModels`
3. `https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels`

**Returns:** `QuotaGroup[]` with model families:
- `claude-gpt` - Claude and GPT models
- `gemini-3-pro` - Gemini 3 Pro models
- `gemini-2-5-flash` - Gemini 2.5 Flash models
- `gemini-2-5-flash-lite` - Gemini 2.5 Flash Lite
- `gemini-3-flash` - Gemini 3 Flash models

Each group contains `remainingFraction` (0.0-1.0) and `resetTime`.

---

## 4. QuotaCheckerFactory

**File:** `packages/backend/src/services/quota/quota-checker-factory.ts`

Registered checker types:
- `synthetic` -> `SyntheticQuotaChecker`
- `anthropic` -> `AnthropicQuotaChecker`
- `antigravity` -> `AntigravityQuotaChecker`

**Methods:**
- `registerChecker(type, checkerClass)` - Register new checker type
- `createChecker(type, config)` - Create checker instance

---

## 5. QuotaScheduler Service

**File:** `packages/backend/src/services/quota/quota-scheduler.ts`

Singleton service that manages all quota checkers.

**Methods:**
- `getInstance()` - Get singleton instance
- `initialize(quotaConfigs)` - Initialize from config, schedule all checkers
- `runCheckNow(checkerId)` - Trigger immediate check
- `getCheckerIds()` - List all registered checker IDs
- `getLatestQuota(checkerId)` - Get most recent snapshots
- `getQuotaHistory(checkerId, windowType, since)` - Get historical data
- `stop()` - Stop all scheduled checks (for graceful shutdown)

**Behavior:**
- On startup, runs each checker immediately
- Schedules recurring checks via `setInterval`
- Persists all results to `quota_snapshots` table
- Logs warnings for failed checks

---

## 6. Configuration

### 6.1 Schema Addition

Add to `PlexusConfigSchema` in `packages/backend/src/config.ts`:

```typescript
const QuotaConfigSchema = z.object({
  id: z.string(),
  type: z.string(),
  provider: z.string(),
  enabled: z.boolean().default(true),
  intervalMinutes: z.number().min(1).default(30),
  options: z.record(z.any()).default({}),
});

// In PlexusConfigSchema:
quotas: z.array(QuotaConfigSchema).optional().default([]),
```

### 6.2 Example Configuration

```yaml
# In config/plexus.yaml

quotas:
  - id: synthetic-main
    type: synthetic
    provider: synthetic
    enabled: true
    intervalMinutes: 30
    options:
      apiKey: syn_your_api_key_here
      # endpoint: https://api.synthetic.new/v2/quotas  # optional override

  - id: anthropic-pro
    type: anthropic
    provider: anthropic
    enabled: true
    intervalMinutes: 15
    options:
      apiKey: sk-ant-your_api_key_here
      # model: claude-haiku-4-5  # optional, for probe request

  - id: antigravity-main
    type: antigravity
    provider: antigravity
    enabled: true
    intervalMinutes: 20
    options:
      credentialsPath: /path/to/credentials.json
      # projectId: bamboo-precept-lgxtn  # optional override
```

---

## 7. API Routes

Added to management routes (requires admin authentication).

### GET /v1/quotas

List all quota checkers and their latest status.

**Response:**
```json
[
  {
    "checkerId": "synthetic-main",
    "latest": [
      {
        "provider": "synthetic",
        "checkerId": "synthetic-main",
        "windowType": "subscription",
        "utilizationPercent": 38.1,
        "status": "ok",
        ...
      }
    ]
  }
]
```

### GET /v1/quotas/:checkerId

Get latest quota for a specific checker.

**Response:**
```json
{
  "checkerId": "synthetic-main",
  "latest": [...]
}
```

### GET /v1/quotas/:checkerId/history

Get historical data for charting.

**Query Parameters:**
- `windowType` - Filter by window type (default: 'subscription')
- `since` - Start date (ISO string or relative like '7d', '30d')

**Response:**
```json
{
  "checkerId": "synthetic-main",
  "windowType": "subscription",
  "since": "2026-01-26T00:00:00.000Z",
  "history": [...]
}
```

### POST /v1/quotas/:checkerId/check

Trigger an immediate quota check.

**Response:** `QuotaCheckResult` object

---

## 8. File Structure

```
packages/backend/
├── drizzle/schema/
│   ├── sqlite/
│   │   ├── quota-snapshots.ts      # NEW
│   │   └── index.ts                # MODIFY - export new table
│   └── postgres/
│       ├── quota-snapshots.ts      # NEW
│       └── index.ts                # MODIFY - export new table
├── src/
│   ├── types/
│   │   └── quota.ts                # NEW - Type definitions
│   ├── db/
│   │   └── types.ts                # MODIFY - Add QuotaSnapshot types
│   ├── services/
│   │   └── quota/
│   │       ├── quota-checker.ts           # NEW - Abstract base class
│   │       ├── quota-checker-factory.ts   # NEW - Factory
│   │       ├── quota-scheduler.ts         # NEW - Scheduler singleton
│   │       └── checkers/
│   │           ├── synthetic-checker.ts   # NEW
│   │           ├── anthropic-checker.ts   # NEW
│   │           └── antigravity-checker.ts # NEW
│   ├── routes/
│   │   └── management-routes.ts    # MODIFY - Add quota endpoints
│   ├── config.ts                   # MODIFY - Add quotas schema
│   └── index.ts                    # MODIFY - Initialize scheduler
```

---

## 9. Implementation Order

### Phase 1: Types & Schema (Foundation)
1. Create `src/types/quota.ts` with all type definitions
2. Create `drizzle/schema/sqlite/quota-snapshots.ts`
3. Create `drizzle/schema/postgres/quota-snapshots.ts`
4. Update schema index files to export new table
5. Generate migrations: `bunx drizzle-kit generate` (both SQLite and PostgreSQL)
6. Update `src/db/types.ts` with inferred types

### Phase 2: Abstract Class & Factory (Core)
1. Create `src/services/quota/quota-checker.ts`
2. Create `src/services/quota/quota-checker-factory.ts`

### Phase 3: Concrete Implementations (Providers)
1. Create `checkers/synthetic-checker.ts` (simplest)
2. Create `checkers/anthropic-checker.ts`
3. Create `checkers/antigravity-checker.ts`

### Phase 4: Scheduler & Persistence (Orchestration)
1. Create `src/services/quota/quota-scheduler.ts`

### Phase 5: Configuration & Bootstrap (Integration)
1. Update `src/config.ts` with quotas Zod schema
2. Update `src/index.ts` to initialize QuotaScheduler
3. Add quota routes to `src/routes/management-routes.ts`

### Phase 6: Testing
1. Unit tests for each checker
2. Integration tests for scheduler
3. API route tests

---

## 10. Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Config location | `plexus.yaml` | Unified configuration with existing providers |
| Scheduler | `setInterval` | Simple, consistent with existing patterns |
| Quota fetching | Active only | Simpler implementation, dedicated API calls |
| Model-specific quotas | One checker per provider | Single checker handles all model groups |
| Data retention | Keep all data | Full historical analysis capability |
| Anthropic check cost | Not tracked | 1-token probe is negligible |
| API exposure | Management endpoints | Consistent with existing admin routes |

---

## 11. Future Enhancements

- **Alerting:** Webhook notifications when quotas reach warning/critical levels
- **UI Dashboard:** Visual quota display with historical charts
- **Passive header capture:** Extract rate limit info from normal inference requests
- **Codex checker:** Add OpenAI/Codex WHAM endpoint support
- **Rate limit integration:** Use quota data to influence routing decisions
