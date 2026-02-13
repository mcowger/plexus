## 1. Executive Summary
**Plexus** is a high-performance, unified API gateway and virtualization layer for Large Language Models (LLMs). Built on the **Bun** runtime and **Fastify** framework, it abstracts the complexity of integrating with multiple AI providers (OpenAI, Anthropic, Google, etc.) by transforming incoming APIs (`/v1/messages`, `/v1/chat/completions`, etc.). This enables developers to switch providers, load-balance requests, and manage model configurations without altering their client application code.

## 2. Target Audience - **AI Engineers & Developers:** Building applications that consume LLM APIs and require flexibility in provider selection. - **Platform Architects:** 
Seeking to unify LLM traffic through a centralized, controllable gateway.


## CRITICAL REQUIREMENTS:   NEVER default to searching types definitions files for libraries.  ALWAYS rely on the tavily and context7 MCP tools to search the web for better documentation. FOLLOWING THIS REQUIREMENT IS CRITICAL.

## Goal The core objective is to provide a single entry point for various LLM APIs:

- `/v1/chat/completions` (OpenAI style)
- `/v1/messages` (Anthropic style)
- `/v1/responses` (OpenAI Responses style - Planned)

Plexus routes requests to any backend provider regardless of its native API format. For example, a request sent to the `/v1/chat/completions` endpoint can be routed to an Anthropic model, with Plexus handling the transformation of both the request and the response.

### Transformation Workflow:
1. **Receive Request:** Accept a request in a supported style (e.g., OpenAI chat completions).
2. **Select Provider:** Resolve the target provider and model based on the request's `model` field and the system configuration.
3. **Transform Request:** Convert the input payload into the internal `UnifiedChatRequest` format, then into the target provider's specific format (e.g., Anthropic messages).
4. **Execute Call:** Make the HTTP request to the target provider's endpoint with appropriate headers and authentication.
5. **Transform Response:** Convert the provider's response back into the original requesting style before returning it to the client.

## 3. Core Features & Capabilities

### 3.1 Unified API Surface
- **Implemented Endpoints:**
  - `POST /v1/chat/completions`: Standard OpenAI-compatible chat completion endpoint.
  - `POST /v1/messages`: Standard Anthropic-compatible messages endpoint.
  - `GET /v1/models`: List available models and aliases.

- **Planned Endpoints:**
  - `POST /v1/responses`: OpenAI Responses API style.

### 3.2 Advanced Routing & Virtualization
- **Model Aliasing:** Decouples requested model IDs from actual provider implementations.
- **Load Balancing:** Supports multiple targets for a single alias with randomized distribution.
- **Configuration-Driven:** Routing and provider settings are defined in `config/plexus.yaml`.

### 3.3 Multi-Provider Support
Uses a "Transformer" architecture in `packages/backend/src/transformers/`:
- **OpenAI:** Handles OpenAI, OpenRouter, DeepSeek, Groq, and other compatible APIs.
- **Anthropic:** Native support for Anthropic's messages format.
- **Streaming:** Full support for Server-Sent Events (SSE) across different formats.
- **Tool Use:** Normalizes tool calling/function calling.

## 4. Technical Architecture

### 4.1 Stack
- **Runtime:** [Bun](https://bun.sh)
- **Web Framework:** Fastify
- **Configuration:** YAML (via `yaml` package)
- **Validation:** [Zod](https://zod.dev/)
- **ORM:** [Drizzle ORM](https://orm.drizzle.team/) with SQLite
- **Libraries:** Where possible, use native Bun libraries

### 4.2 System Components
- **`packages/backend`**: The core Fastify server. Contains the dispatcher, router, and transformer logic.
- **`packages/frontend`**: React-based dashboard.
- **`llms/`**: A reference implementation (Fastify-based) containing extensive transformer logic for diverse providers (Vertex, Gemini, Cerebras, etc.) used to guide development in `packages/backend`.
- **`CAP-UI/`**: A reference implementation of a management UI and usage tracking tool used to guide development in `packages/frontend`.  Do not use it as a reference for backend code.   Primarily use it for UI techniques and layout.
- **`testcommands/`**: TypeScript-based CLI tools and JSON payloads for verifying transformations and streaming.

## 5. Directory Structure
- `config/`: Configuration files (`plexus.yaml`).
- `packages/backend/src/`:
  - `services/`: Core logic (`Dispatcher`, `Router`, `TransformerFactory`).
  - `transformers/`: Protocol translation logic.
  - `types/`: Unified types for requests, responses, and streaming chunks.
  - `utils/`: Shared utilities (Logger).
  - `db/`: Database client and types.
  - `drizzle/schema/`: Drizzle ORM table definitions.
  - `drizzle/migrations/`: Auto-generated migration files.

# Database Migrations - CRITICAL RULES

## NEVER Edit Existing Migrations

**Modifying existing migration files is NEVER acceptable.** Migration files represent the historical change sequence of your database schema. Editing them can:

- Break production databases with out-of-sync migration history
- Cause data loss or corruption
- Create inconsistencies between development and production environments

## NEVER Manually Create Migration Files

**You must NEVER manually create migration SQL files or edit the migration journal (`meta/_journal.json`).** Always use `drizzle-kit generate` to create migrations automatically. Manual migration creation causes critical issues:

- Drizzle-kit ignores migrations not in the journal
- Running `drizzle-kit generate` will create conflicting migrations
- The migration system becomes out of sync with the schema
- Causes failed deployments and database corruption

## The ONLY Correct Migration Workflow

When schema changes are needed, follow these steps **exactly**:

1. **Edit the schema files** in `packages/backend/drizzle/schema/sqlite/` or `packages/backend/drizzle/schema/postgres/`
2. **Generate migrations for BOTH databases**:
   ```bash
   cd packages/backend
   
   # Generate SQLite migration
   bunx drizzle-kit generate
   
   # Generate PostgreSQL migration
   bunx drizzle-kit generate --config drizzle.config.pg.ts
   ```
3. **Review the generated migrations**:
   - Check `drizzle/migrations/XXXX_description.sql` (SQLite)
   - Check `drizzle/migrations_pg/XXXX_description.sql` (PostgreSQL)
   - Verify both the SQL file AND the journal entry were created
4. **Test the migrations** - restart the server and verify no errors
5. **Commit all generated files** - SQL, snapshots, and journal changes

**NEVER:**
- Create `.sql` files manually
- Edit `meta/_journal.json` manually  
- Skip generating migrations for both databases
- Modify the database schema directly with SQL commands

## Live Database Safety

- It is NEVER acceptable to attempt to modify a live database directly
- Always use migrations for schema changes
- Test migrations in development/staging before production

## 6. Database & ORM

Plexus uses **Drizzle ORM** with **SQLite** for data persistence.

**For PostgreSQL deployments**, migrations are stored in `drizzle/migrations_pg/` and schema definitions are in `drizzle/schema/postgres/`.

### 6.1 Database Schema

All database tables are defined in `packages/backend/drizzle/schema/`:
- **`request_usage`** - Tracks API usage, costs, and timing
- **`provider_cooldowns`** - Provider failure tracking with per-account support
- **`debug_logs`** - Request/response debugging
- **`inference_errors`** - Error logging
- **`provider_performance`** - Performance metrics (last 10 requests per provider/model)

### 6.2 Type-Safe Queries

Drizzle provides full TypeScript type safety:

```typescript
import { eq, and, desc, sql } from 'drizzle-orm';
import * as schema from '../../drizzle/schema';
import { getDatabase } from '../db/client';

const db = getDatabase();

// Insert with type checking
await db.insert(schema.requestUsage).values({
  requestId: 'uuid-123',
  date: new Date().toISOString(),
  provider: 'openai',
  // ... all fields are type-checked
});

// Select with filters
const results = await db
  .select()
  .from(schema.requestUsage)
  .where(and(
    eq(schema.requestUsage.provider, 'openai'),
    sql`${schema.requestUsage.createdAt} > ${Date.now() - 86400000}`
  ))
  .orderBy(desc(schema.requestUsage.createdAt));

// Update with conflict handling
await db.insert(schema.providerCooldowns)
  .values({ provider, model, accountId, expiry })
  .onConflictDoUpdate({
    target: [schema.providerCooldowns.provider, schema.providerCooldowns.model, schema.providerCooldowns.accountId],
    set: { expiry }
  });
```

### 6.3 Running Migrations

Migrations run automatically on application startup. To generate new migrations after schema changes:

```bash
# From packages/backend directory
cd packages/backend

# Generate migration (creates SQL file in drizzle/migrations/)
bunx drizzle-kit generate

# Review the generated SQL file
cat drizzle/migrations/XXXX_description.sql

# Apply migrations manually (optional, usually auto-applied)
bunx drizzle-kit migrate
```

### 6.4 Adding New Tables or Columns

To add a new table or modify existing schema:

1. **Edit the schema file** (e.g., `drizzle/schema/request-usage.ts`):
   ```typescript
   export const requestUsage = sqliteTable('request_usage', {
     // ... existing columns
     newColumn: text('new_column'),  // Add new column
   });
   ```

2. **Generate migration**:
   ```bash
   bunx drizzle-kit generate
   ```

3. **Review the generated SQL** in `drizzle/migrations/XXXX_description.sql`

4. **Restart the application** - migrations auto-apply on startup

### 6.5 Type Definitions

Inferred types are available in `packages/backend/src/db/types.ts`:

```typescript
import { InferSelectModel, InferInsertModel } from 'drizzle-orm';

// Automatically inferred from schema
export type RequestUsage = InferSelectModel<typeof schema.requestUsage>;
export type NewRequestUsage = InferInsertModel<typeof schema.requestUsage>;
```

## 7. Development & Testing
- **Full Stack Dev:** Run `bun run dev` from the root to start both the Backend (port 4000, watch mode) and Frontend Builder (watch mode).

### 7.1 Testing Guidelines
When writing tests for the backend, especially those involving configuration (`packages/backend/src/config.ts`), strict adherence to isolation principles is required to prevent "mock pollution" across tests.

**Do NOT use `mock.module` to mock the configuration module globally.** 
Bun's test runner can share state between test files, and hard-mocking the config module will cause other tests (like `pricing_config.test.ts` or `dispatcher.test.ts`) to fail unpredictably because they receive the mocked configuration instead of the real logic.  


## Global Test Setup

To ensure test isolation and prevent "mock pollution" in Bun's shared-worker environment, this project uses a global setup script.

### `bunfig.toml` and `test/setup.ts`

The root `bunfig.toml` is configured to preload `packages/backend/test/setup.ts` before any tests run. This script establishes "Gold Standard" mocks for global dependencies like the **Logger** and initializes an in-memory database with migrations.

### Mocking Pattern: Shared Dependencies

Bun's `mock.module` is a process-global operation. Once a module is mocked, it remains mocked for the duration of that worker thread, and `mock.restore()` does **not** reset it.

To prevent crashes in other tests (e.g., `TypeError: logger.info is not a function`), follow these rules:

1.  **Use the Global Setup:** Common modules like `src/utils/logger` should be mocked once in `setup.ts`.
2.  **Robust Mocking:** If you must mock a module in a specific test file, your mock **MUST** implement the entire public interface of that module (including all log levels like `silly`, `debug`, etc.).
3.  **Prefer Spying:** If you need to assert that a global dependency was called, use `spyOn` on the already-mocked global instance rather than re-mocking the module.

```typescript
import { logger } from "src/utils/logger";
import { spyOn, expect, test } from "bun:test";

test("my test", () => {
    const infoSpy = spyOn(logger, "info");
    // ... run code ...
    expect(infoSpy).toHaveBeenCalled();
});
```

## 8. Frontend Styling & Tailwind CSS

### 8.1 Tailwind CSS Build Process
The frontend uses Tailwind CSS v4. To ensure utility classes are correctly scanned and generated, the following configurations are CRITICAL:

- **No CSS-in-JS Imports:** **NEVER** import `globals.css` (or any CSS file containing Tailwind v4 directives) directly into `.ts` or `.tsx` files. Bun's internal CSS loader does not support Tailwind v4 `@theme` or `@source` directives and will overwrite the valid CSS generated by the CLI with a broken version. The build script (`build.ts`) handles linking the generated `main.css` in the final `index.html`.
- **Build Command Execution:** The `@tailwindcss/cli` should be executed from the `packages/frontend` directory. The input path should be `./src/globals.css` and the output path should be `./dist/main.css`.
- **Source Directives:** In `packages/frontend/src/globals.css`, use `@source "../src/**/*.{tsx,ts,jsx,js}";`. This ensures the scanner looks at the source files relative to the CSS file's location.

Failure to follow these settings will result in a `main.css` file that contains only base styles and no generated utility classes, causing the UI to appear unstyled.

### 8.2 Static Assets Location
All static assets (images, logos, icons, etc.) must be placed in `packages/frontend/src/assets/`.

- **Import Assets in Components:** Import assets using ES6 import statements (e.g., `import logo from '../assets/logo.svg'`) rather than using direct paths.
- **Do NOT use dynamic paths:** Avoid using template strings or dynamic paths like `/images/${filename}.svg` as they won't work with the build process.
- **Move Existing Assets:** If you find assets in other locations (e.g., `packages/frontend/images/`), move them to `packages/frontend/src/assets/` and update any references to use imports.

This ensures assets are properly bundled by the build system and served correctly in both development and production environments.

### 8.3 Number and Time Formatting - **PREFERRED APPROACH**

The project uses centralized formatting utilities in `packages/frontend/src/lib/format.ts` powered by the [human-format](https://www.npmjs.com/package/human-format) library.

**ALWAYS use these utilities instead of creating custom formatting logic:**

- **`formatNumber(num, decimals?)`**: Large numbers with K/M/B suffixes (e.g., "1.3k", "2.5M")
- **`formatTokens(tokens)`**: Alias for `formatNumber` specifically for token counts
- **`formatDuration(seconds)`**: Human-readable durations with two most significant units (e.g., "2h 30m", "3mo 2w", "1y 2mo")
- **`formatTimeAgo(seconds)`**: Relative time format (e.g., "5m ago", "2h ago", "3d ago")
- **`formatCost(cost, maxDecimals?)`**: Dollar formatting with appropriate precision (e.g., "$0.001234", "$1.23")
- **`formatMs(ms)`**: Milliseconds to seconds conversion (e.g., "45ms", "2.5s", "∅")
- **`formatTPS(tps)`**: Tokens per second with one decimal place (e.g., "15.3")

**DO NOT:**
- Use `toFixed()` for number formatting
- Use `toLocaleString()` with custom fraction digits for numbers
- Create inline formatting logic with manual calculations
- Duplicate formatting code across components

**Example Usage:**

```typescript
import { formatCost, formatMs, formatTPS, formatDuration, formatTokens } from '../lib/format';

// Cost formatting
{formatCost(log.costTotal)}           // "$1.23"
{formatCost(log.costInput)}           // "$0.000456"

// Time formatting
{formatMs(log.durationMs)}            // "2.5s"
{formatMs(log.ttftMs)}                // "450ms"
{formatTPS(log.tokensPerSec)}         // "15.3"

// Duration formatting (tokens, cooldowns, etc.)
{formatDuration(account.expires_in_seconds)}     // "2h 30m"
{formatDuration(cooldownRemaining)}              // "45m"
{formatDuration(3600 * 24 * 365 + 2592000)}      // "1y 1mo"

// Token counts
{formatTokens(log.tokensInput)}       // "1.3k"
```

**Backend Integration:**

The `formatLargeNumber` function exported from `packages/frontend/src/lib/api.ts` is an alias to `formatNumber` for backward compatibility. Always import from `format.ts` for new code:

```typescript
// ✅ Preferred
import { formatNumber } from '../lib/format';

// ⚠️ Legacy (still works but avoid in new code)
import { formatLargeNumber } from '../lib/api';
```

## 9. Implementing a New Quota Checker

This section documents the pattern for adding a new quota checker (e.g., for a new AI provider). The implementation involves both backend and frontend changes.

### 9.1 Backend - Schema & Configuration

**Update `packages/backend/src/config.ts`:**

1. Add a new Zod schema for checker options:
```typescript
const NewQuotaCheckerOptionsSchema = z.object({
  endpoint: z.string().url().optional(),
  // Add other provider-specific options here
});
```

2. Add a new discriminated union variant to `ProviderQuotaCheckerSchema`:
```typescript
z.object({
  type: z.literal('new-checker-name'),
  enabled: z.boolean().default(true),
  intervalMinutes: z.number().min(1).default(30),
  id: z.string().trim().min(1).optional(),
  options: NewQuotaCheckerOptionsSchema.optional().default({}),
}),
```

### 9.2 Backend - Quota Checker Implementation

**Create `packages/backend/src/services/quota/checkers/new-checker-name.ts`:**

```typescript
import type { QuotaCheckResult, QuotaWindow, QuotaCheckerConfig } from '../../../types/quota';
import { QuotaChecker } from '../quota-checker';
import { logger } from '../../../utils/logger';

interface ProviderQuotaLimitResponse {
  // Define the API response shape
}

export class NewQuotaCheckerNameQuotaChecker extends QuotaChecker {
  private endpoint: string;

  constructor(config: QuotaCheckerConfig) {
    super(config);
    this.endpoint = this.getOption<string>('endpoint', 'https://default.api.endpoint');
  }

  async checkQuota(): Promise<QuotaCheckResult> {
    const apiKey = this.requireOption<string>('apiKey');

    try {
      logger.debug(`[new-checker-name] Calling ${this.endpoint}`);
      
      const response = await fetch(this.endpoint, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        return this.errorResult(new Error(`HTTP ${response.status}: ${response.statusText}`));
      }

      const data: ProviderQuotaLimitResponse = await response.json();
      
      const windows: QuotaWindow[] = [];
      const limits = data.data?.limits ?? [];

      for (const limit of limits) {
        // Map provider-specific fields to QuotaWindow
        windows.push(this.createWindow(
          'five_hour',           // windowType: 'five_hour' | 'daily' | 'monthly'
          limit.total ?? 100,    // limit (max value)
          limit.currentValue,   // current usage
          limit.remaining,      // remaining (optional)
          'percentage' | 'requests' | 'tokens',  // unit type
          limit.nextResetTime ? new Date(limit.nextResetTime) : undefined,
          'Human-readable label'
        ));
      }

      return this.successResult(windows);
    } catch (error) {
      return this.errorResult(error as Error);
    }
  }
}
```

### 9.3 Backend - Factory Registration

**Update `packages/backend/src/services/quota/quota-checker-factory.ts`:**

```typescript
import { NewQuotaCheckerNameQuotaChecker } from './checkers/new-checker-name';

const CHECKER_REGISTRY: Record<string, new (config: QuotaCheckerConfig) => QuotaChecker> = {
  // ... existing entries
  'new-checker-name': NewQuotaCheckerNameQuotaChecker,
};
```

### 9.4 Frontend - UI Components

**Create `packages/frontend/src/components/quota/NewCheckerQuotaConfig.tsx`:**

```typescript
import React from 'react';
import { Input } from '../ui/Input';

interface NewCheckerQuotaConfigProps {
  options: Record<string, unknown>;
  onChange: (options: Record<string, unknown>) => void;
}

export const NewCheckerQuotaConfig: React.FC<NewCheckerQuotaConfigProps> = ({
  options,
  onChange,
}) => {
  const handleChange = (key: string, value: string) => {
    onChange({ ...options, [key]: value });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-1">
        <label className="font-body text-[13px] font-medium text-text-secondary">
          Endpoint (optional)
        </label>
        <Input
          value={(options.endpoint as string) ?? ''}
          onChange={(e) => handleChange('endpoint', e.target.value)}
          placeholder="https://api.provider.com/quota"
        />
      </div>
    </div>
  );
};
```

**Create `packages/frontend/src/components/quota/NewCheckerQuotaDisplay.tsx`:**

```typescript
import React from 'react';
import { clsx } from 'clsx';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import type { QuotaCheckResult, QuotaStatus } from '../../types/quota';

interface NewCheckerQuotaDisplayProps {
  result: QuotaCheckResult;
  isCollapsed: boolean;
}

export const NewCheckerQuotaDisplay: React.FC<NewCheckerQuotaDisplayProps> = ({
  result,
  isCollapsed,
}) => {
  if (!result.success) {
    return (
      <div className="px-2 py-2">
        <div className={clsx("flex items-center gap-2 text-danger", isCollapsed && "justify-center")}>
          <AlertTriangle size={16} />
          {!isCollapsed && <span className="text-xs">Error</span>}
        </div>
      </div>
    );
  }

  const windows = result.windows || [];
  const primaryWindow = windows[0]; // Choose appropriate window
  const overallStatus = primaryWindow?.status || 'ok';

  const statusColors: Record<QuotaStatus, string> = {
    ok: 'bg-success',
    warning: 'bg-warning',
    critical: 'bg-danger',
    exhausted: 'bg-danger',
  };

  if (isCollapsed) {
    return (
      <div className="px-2 py-2 flex justify-center">
        {overallStatus === 'ok' ? (
          <CheckCircle2 size={18} className="text-success" />
        ) : (
          <AlertTriangle size={18} className={clsx(overallStatus === 'warning' ? 'text-warning' : 'text-danger')} />
        )}
      </div>
    );
  }

  return (
    <div className="px-2 py-1 space-y-1">
      {/* Render progress bars for each window */}
      {windows.map((window) => (
        <div key={window.windowType} className="space-y-1">
          <div className="flex items-baseline gap-2">
            <span className="text-xs font-semibold text-text-secondary">{window.label}:</span>
          </div>
          <div className="relative h-2">
            <div className="h-2 rounded-md bg-bg-hover overflow-hidden">
              <div
                className={clsx(
                  'h-full rounded-md transition-all',
                  statusColors[window.status || 'ok']
                )}
                style={{ width: `${Math.min(100, Math.max(0, window.utilizationPercent))}%` }}
              />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};
```

### 9.5 Frontend - Export & Integration

**Update `packages/frontend/src/components/quota/index.ts`:**

```typescript
export { NewCheckerQuotaDisplay } from './NewCheckerQuotaDisplay';
export { NewCheckerQuotaConfig } from './NewCheckerQuotaConfig';
```

**Update `packages/frontend/src/lib/api.ts`:**

```typescript
const VALID_QUOTA_CHECKER_TYPES = new Set([
  'synthetic', 'naga', 'nanogpt', 'openai-codex', 'claude-code', 'new-checker-name'
]);
```

**Update `packages/frontend/src/pages/Providers.tsx`:**

1. Import the config component:
```typescript
import { NewCheckerQuotaConfig } from '../components/quota/NewCheckerQuotaConfig';
```

2. Add to QUOTA_CHECKER_TYPES:
```typescript
const QUOTA_CHECKER_TYPES = ['synthetic', 'naga', 'nanogpt', 'openai-codex', 'claude-code', 'new-checker-name'] as const;
```

3. Add conditional rendering for the config form:
```typescript
{selectedQuotaCheckerType === 'new-checker-name' && (
  <div className="mt-3 p-3 border border-border-glass rounded-md bg-bg-subtle">
    <NewCheckerQuotaConfig
      options={editingProvider.quotaChecker?.options || {}}
      onChange={(options) => setEditingProvider({
        ...editingProvider,
        quotaChecker: { ...editingProvider.quotaChecker, options }
      })}
    />
  </div>
)}
```

**Update `packages/frontend/src/components/layout/Sidebar.tsx`:**

1. Import the display component:
```typescript
import { NewCheckerQuotaDisplay } from '../quota';
```

2. Add conditional rendering:
```typescript
if (quota.checkerId.includes('new-checker-name')) {
  return (
    <NewCheckerQuotaDisplay result={result} isCollapsed={isCollapsed} />
  );
}
```

### 9.6 Key Patterns

- **Window Types:** Use `five_hour`, `daily`, or `monthly` depending on the provider's quota window
- **Unit Types:** Use `percentage`, `requests`, or `tokens` depending on what the provider reports
- **Status Values:** Return `ok`, `warning`, `critical`, or `exhausted` based on utilization thresholds
- **Debug Logging:** Use `[new-checker-name]` prefix in logger.debug() calls for easy troubleshooting
- **Error Handling:** Always return `errorResult()` on failures, `successResult()` on success

### 9.7 Implementing a Balance-Style Quota Checker

Some providers (like Moonshot AI, Naga) provide a prepaid account balance rather than time-based rate limits. These "balance-style" checkers have specific requirements:

#### Key Differences from Rate-Limit Checkers

| Aspect | Rate-Limit Checker | Balance Checker |
|--------|-------------------|----------------|
| Window Type | `five_hour`, `daily`, `monthly` | `subscription` |
| Unit Type | `requests`, `tokens`, `percentage` | `dollars` |
| API Key | May require separate provisioning key | Inherits from provider config |
| Display | Progress bar with usage/limit | Wallet icon with remaining balance |

#### API Key Inheritance

The system automatically injects the provider's API key into quota checker options. In your checker implementation, use:

```typescript
const apiKey = this.requireOption<string>('apiKey');
```

This works because `config.ts` automatically injects the provider's `api_key` into the checker's options (see lines 396-401 in `packages/backend/src/config.ts`):

```typescript
// Inject the provider's API key for quota checkers that need it
const apiKey = providerConfig.api_key?.trim();
if (apiKey && apiKey.toLowerCase() !== 'oauth' && options.apiKey === undefined) {
  options.apiKey = apiKey;
}
```

#### Balance Checker Implementation Pattern

**Backend - Quota Checker:**

```typescript
interface ProviderBalanceResponse {
  code: number;
  data: {
    available_balance: number;
    voucher_balance?: number;
    cash_balance?: number;
  };
  status: boolean;
}

export class MoonshotQuotaChecker extends QuotaChecker {
  private endpoint: string;

  constructor(config: QuotaCheckerConfig) {
    super(config);
    this.endpoint = this.getOption<string>('endpoint', 'https://api.moonshot.ai/v1/users/me/balance');
  }

  async checkQuota(): Promise<QuotaCheckResult> {
    const apiKey = this.requireOption<string>('apiKey');

    try {
      const response = await fetch(this.endpoint, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        return this.errorResult(new Error(`HTTP ${response.status}: ${response.statusText}`));
      }

      const data: ProviderBalanceResponse = await response.json();

      if (!data.status || data.code !== 0) {
        return this.errorResult(new Error(`API error: code=${data.code}`));
      }

      const { available_balance } = data.data;

      // Use 'subscription' window type for prepaid balances
      // Use 'dollars' as the unit
      const window: QuotaWindow = this.createWindow(
        'subscription',           // windowType: prepaid balance
        undefined,                // limit: not applicable for balance
        undefined,                // used: not applicable
        available_balance,        // remaining: the balance
        'dollars',                // unit type
        undefined,                // resetsAt: no reset for prepaid
        'Provider account balance' // description
      );

      return this.successResult([window]);
    } catch (error) {
      return this.errorResult(error as Error);
    }
  }
}
```

#### Frontend - Display Component

Balance checkers should display the remaining balance with a wallet icon:

```typescript
import { Wallet, AlertTriangle } from 'lucide-react';
import { formatCost } from '../../lib/format';

export const MoonshotQuotaDisplay: React.FC<QuotaDisplayProps> = ({
  result,
  isCollapsed,
}) => {
  if (!result.success) {
    return (
      <div className="px-2 py-2">
        <div className="flex items-center gap-2 text-danger">
          <AlertTriangle size={16} />
          {!isCollapsed && <span className="text-xs">Error</span>}
        </div>
      </div>
    );
  }

  const windows = result.windows || [];
  const subscriptionWindow = windows.find(w => w.windowType === 'subscription');
  const balance = subscriptionWindow?.remaining;

  if (isCollapsed) {
    return (
      <div className="px-2 py-2 flex justify-center">
        <Wallet size={18} className="text-info" />
      </div>
    );
  }

  return (
    <div className="px-2 py-1 space-y-1">
      <div className="flex items-center gap-2">
        <Wallet size={14} className="text-info" />
        <span className="text-xs font-semibold">Provider Name</span>
      </div>
      {balance !== undefined && (
        <div className="flex items-baseline gap-2">
          <span className="text-xs text-text-secondary">Balance</span>
          <span className="text-xs font-semibold text-info">
            {formatCost(balance)}
          </span>
        </div>
      )}
    </div>
  );
};
```

#### Frontend - Config Component

Balance checkers that inherit the API key only need an optional endpoint field:

```typescript
export const MoonshotQuotaConfig: React.FC<QuotaConfigProps> = ({
  options,
  onChange,
}) => {
  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-1">
        <label className="font-body text-[13px] font-medium text-text-secondary">
          Endpoint (optional)
        </label>
        <Input
          value={(options.endpoint as string) ?? ''}
          onChange={(e) => onChange({ ...options, endpoint: e.target.value })}
          placeholder="https://api.provider.com/v1/users/me/balance"
        />
      </div>
    </div>
  );
};
```

**Do NOT add an apiKey field** - the checker will automatically inherit the API key from the provider configuration.