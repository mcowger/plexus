PRD: User Quota Enforcement System
1. Objective
Implement a post-hoc quota enforcement system to limit API usage by requests or tokens per API key. The system supports Rolling (Leaky Bucket) and Calendar (Daily/Weekly) windows. Quota state is persisted to survive application restarts.
Key Design Decisions:
- Post-hoc enforcement: Requests are always processed. Quota is checked before each request, but only blocks if previous usage already exceeded the limit.
- One quota per key: Each API key can have at most one quota assigned.
- No token estimation: Actual usage is recorded after request completion. It's acceptable if a request pushes the user slightly over their limit (e.g., 125,671 tokens on a 125,000 limit).
- UTC timezone: All calendar quotas use UTC boundaries.
- No concurrency controls: This is not a high-concurrency application.
2. Configuration Schema
Global Quota Definitions
quotas:
  premium_hourly:
    type: rolling
    limitType: tokens
    limit: 100000
    duration: 1h
  
  basic_daily:
    type: daily
    limitType: requests
    limit: 1000
Fields:
- name: Unique identifier for the quota definition
- type: rolling (Leaky Bucket) | daily | weekly
- limitType: requests (count) | tokens (sum of input + output)
- limit: Maximum allowed usage
- duration: Duration string for rolling quotas (e.g., 5h, 30m, 1d). Parsed using parse-duration library.
Key Assignment
keys:
  acme_corp:
    secret: "sk-acme-..."
    quota: premium_hourly  # References quota definition name
  
  developer:
    secret: "sk-dev-..."
    quota: basic_daily
Fields:
- secret: API key secret
- comment: Optional description
- quota: Name of quota definition to apply (optional, max one per key)
3. Database Schema
Table: quota_state
Stores the current usage state for each key with an assigned quota.
SQLite:
export const quotaState = sqliteTable('quota_state', {
  keyName: text('key_name').primaryKey(),
  quotaName: text('quota_name').notNull(),
  currentUsage: real('current_usage').notNull().default(0),
  lastUpdated: integer('last_updated', { mode: 'timestamp_ms' }).notNull(),
  windowStart: integer('window_start', { mode: 'timestamp_ms' }),
});
PostgreSQL:
export const quotaState = pgTable('quota_state', {
  keyName: text('key_name').primaryKey(),
  quotaName: text('quota_name').notNull(),
  currentUsage: real('current_usage').notNull().default(0),
  lastUpdated: bigint('last_updated', { mode: 'number' }).notNull(),
  windowStart: bigint('window_start', { mode: 'number' }),
});
Columns:
- keyName: Primary key, the API key identifier
- quotaName: The quota definition name
- currentUsage: Current water level (tokens or requests used)
- lastUpdated: Timestamp of last update (for leak calculation)
- windowStart: Start of current calendar window (for daily/weekly quotas)
4. Quota Enforcer Service
File: packages/backend/src/services/quota/quota-enforcer.ts
Core Methods
checkQuota(keyName: string): Promise<QuotaCheckResult | null>
Checks if the key should be allowed to make a request.
Logic:
1. Load quota definition from config for the key
2. If no quota assigned, return null
3. Load current state from database
4. Rolling quotas: Calculate leak since last update
   - leakRate = limit / durationMs
   - leaked = elapsedMs * leakRate
   - currentUsage = max(0, currentUsage - leaked)
5. Calendar quotas: Check if window reset needed
   - Daily: Reset at UTC midnight
   - Weekly: Reset at UTC Sunday midnight
6. Return result with allowed flag
recordUsage(keyName: string, actualCost: number): Promise<void>
Records actual usage after request completes.
Logic:
1. Load quota definition
2. Calculate cost: requests → 1, tokens → input + output tokens
3. Insert or update quota_state row
4. Use ON CONFLICT to increment existing usage
clearQuota(keyName: string): Promise<void>
Admin method to reset quota to zero.
5. Middleware Functions
File: packages/backend/src/services/quota/quota-middleware.ts
checkQuotaMiddleware(request, reply, quotaEnforcer)
Reusable function for pre-request quota checks.
Usage:
const allowed = await checkQuotaMiddleware(request, reply, quotaEnforcer);
if (!allowed) return; // Reply already sent with 429
Behavior:
- Extracts keyName from request (set by auth middleware)
- Calls quotaEnforcer.checkQuota()
- If no quota assigned → returns true (allow)
- If quota exceeded → sends 429 response, returns false
- If under limit → returns true
429 Response Format:
{
  error: {
    message: Quota exceeded: premium_hourly limit of 100000 reached,
    type: quota_exceeded,
    quota_name: premium_hourly,
    current_usage: 125671,
    limit: 100000,
    resets_at: 2026-02-19T01:00:00.000Z
  }
}
recordQuotaUsage(keyName, usageRecord, quotaEnforcer)
Reusable function for post-request usage recording.
Usage:
await recordQuotaUsage(keyName, usageRecord, quotaEnforcer);
Behavior:
- Checks if key has quota assigned
- Calculates actual cost based on limitType
- Calls quotaEnforcer.recordUsage()
6. Route Integration
Apply quota enforcement to these routes only:
1. packages/backend/src/routes/inference/chat.ts
2. packages/backend/src/routes/inference/messages.ts
3. packages/backend/src/routes/inference/responses.ts
4. packages/backend/src/routes/inference/gemini.ts
Pattern for Each Route
Pre-request (before dispatcher):
const allowed = await checkQuotaMiddleware(request, reply, quotaEnforcer);
if (!allowed) return;
Post-request (after handleResponse):
await recordQuotaUsage((request as any).keyName, usageRecord, quotaEnforcer);
7. Admin API Endpoints
File: packages/backend/src/routes/management/quota-enforcement.ts
POST /v0/management/quota/clear
Reset quota usage for a key.
Request:
{
  key: acme_corp
}
Response:
{
  success: true,
  key: acme_corp,
  message: Quota reset successfully
}
GET /v0/management/quota/status/:key
Get current quota status for a key.
With Quota Assigned:
{
  key: acme_corp,
  quota_name: premium_hourly,
  allowed: true,
  current_usage: 45000,
  limit: 100000,
  remaining: 55000,
  resets_at: 2026-02-19T01:00:00.000Z
}
Without Quota Assigned:
{
  key: free_user,
  quota_name: None,
  allowed: true,
  current_usage: 0,
  limit: null,
  remaining: null,
  resets_at: null
}
8. Implementation Details
Duration Parsing
Library: parse-duration (npm)
Install: bun add parse-duration
Usage:
import parse from 'parse-duration';
parse('5h');    // 18000000 ms
parse('30m');   // 1800000 ms
parse('1d');    // 86400000 ms
Quota Algorithm Details
Rolling (Leaky Bucket)
The quota "leaks" over time, allowing new usage as old usage ages out.
Request #1: 3000 tokens
  → CHECK: 0 < 10000? YES → ALLOW
  → PROCESS
  → RECORD: currentUsage = 3000
Request #2: 4000 tokens
  → CHECK: 3000 < 10000? YES → ALLOW
  → PROCESS
  → RECORD: currentUsage = 7000
[Wait 30 minutes]
Request #3: CHECK → Leaked: 5000 tokens (half of 100k/hour) → Total: 2000
  → ALLOW → Record 5000 → Total: 7000
Daily
Resets at UTC midnight every day.
Feb 18, 23:55: Request → Total: 950 requests
Feb 18, 23:59: Request → Total: 951 requests (still under 1000 limit)
Feb 19, 00:01: Request → RESET → Total: 0 → ALLOWED
Weekly
Resets at UTC midnight on Sunday.
Saturday, 23:55: Request → Total: 995 requests
Sunday, 00:01:   Request → RESET → Total: 0 → ALLOWED
Initialization
File: packages/backend/src/index.ts
import { QuotaEnforcer } from './services/quota/quota-enforcer';
import { registerQuotaEnforcementRoutes } from './routes/management/quota-enforcement';
// After database initialization
const quotaEnforcer = new QuotaEnforcer(db);
fastify.decorate('quotaEnforcer', quotaEnforcer);
await registerQuotaEnforcementRoutes(fastify, quotaEnforcer);
9. File Checklist
| File | Action | Description |
|------|--------|-------------|
| packages/backend/package.json | Modify | Add parse-duration dependency |
| packages/backend/drizzle/schema/sqlite/quota-state.ts | Create | SQLite schema for quota_state table |
| packages/backend/drizzle/schema/postgres/quota-state.ts | Create | PostgreSQL schema for quota_state table |
| packages/backend/src/config.ts | Modify | Add QuotaDefinitionSchema, extend KeyConfigSchema with quota field |
| packages/backend/src/services/quota/quota-enforcer.ts | Create | Core QuotaEnforcer class |
| packages/backend/src/services/quota/quota-middleware.ts | Create | Reusable checkQuotaMiddleware and recordQuotaUsage functions |
| packages/backend/src/routes/inference/chat.ts | Modify | Add quota check before dispatch, record usage after |
| packages/backend/src/routes/inference/messages.ts | Modify | Add quota check before dispatch, record usage after |
| packages/backend/src/routes/inference/responses.ts | Modify | Add quota check before dispatch, record usage after |
| packages/backend/src/routes/inference/gemini.ts | Modify | Add quota check before dispatch, record usage after |
| packages/backend/src/routes/management/quota-enforcement.ts | Create | Admin API endpoints |
| packages/backend/src/index.ts | Modify | Initialize QuotaEnforcer and register routes |
10. Testing Strategy
Unit Tests
File: packages/backend/test/quota-enforcer.test.ts
Test scenarios:
1. Rolling quota leak calculation over time
2. Daily quota reset at UTC midnight
3. Weekly quota reset at UTC Sunday
4. Post-hoc enforcement: request goes through, next one blocked
5. No quota assigned: returns null, allows all requests
6. Clear quota: resets to zero
Integration Tests
Test full request flow:
1. Key with rolling quota makes 5 requests → all succeed
2. Wait for partial leak → next request succeeds
3. Exceed limit → next request blocked with 429
4. Wait for full leak → request succeeds again
5. Daily quota: request at 23:59, request at 00:01 with reset
11. Migration Notes
Generate migrations for both databases:
cd packages/backend
# Install dependency
bun add parse-duration
# Generate SQLite migration
bunx drizzle-kit generate
# Generate PostgreSQL migration
bunx drizzle-kit generate --config drizzle.config.pg.ts
# Review generated SQL files
cat drizzle/migrations/XXXX_add_quota_state.sql
cat drizzle/migrations_pg/XXXX_add_quota_state.sql
12. Example Flow
Configuration:
quotas:
  test_quota:
    type: rolling
    limitType: tokens
    limit: 10000
    duration: 1h
keys:
  test_key:
    secret: "sk-test"
    quota: test_quota
Request Flow:
Request #1: 3000 tokens
  → CHECK: 0 < 10000? YES → ALLOW
  → PROCESS
  → RECORD: currentUsage = 3000
Request #2: 4000 tokens
  → CHECK: 3000 < 10000? YES → ALLOW
  → PROCESS
  → RECORD: currentUsage = 7000
Request #3: 5000 tokens
  → CHECK: 7000 < 10000? YES → ALLOW
  → PROCESS
  → RECORD: currentUsage = 12000
Request #4: 1000 tokens
  → CHECK: 12000 < 10000? NO → DENY 429
  → "Quota exceeded: test_quota limit of 10000 reached"
[Wait 30 minutes - half the quota leaks]
Request #5: 1000 tokens
  → CHECK: 12000 - 5000 = 7000 < 10000? YES → ALLOW
  → PROCESS
  → RECORD: currentUsage = 8000
13. No Frontend
This implementation is backend-only. No frontend changes are required.
Future frontend enhancements could include:
- Displaying quota status on keys management page
- Visual quota usage bars
- Quota assignment UI
- Historical quota usage graphs
These are explicitly out of scope for this PRD.
