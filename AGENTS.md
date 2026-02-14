# AGENTS.md - Plexus Development Guide

> **Last Updated:** Auto-generated for AI agents working in the Plexus codebase  
> **Project:** Plexus - Unified LLM API Gateway  
> **Stack:** Bun + TypeScript + Fastify + React + Drizzle ORM

---

## Quick Start

```bash
# Install dependencies for all workspaces
bun run install:all

# Start full development stack (backend + frontend)
bun run dev

# Backend only (port 4000)
bun run dev:backend

# Frontend only (builds to dist/)
bun run dev:frontend
```

---

## Project Overview

**Plexus** is a high-performance, unified API gateway and virtualization layer for Large Language Models (LLMs). It abstracts the complexity of integrating with multiple AI providers (OpenAI, Anthropic, Google, etc.) by transforming incoming APIs.

### Key Capabilities
- **Unified API Surface:** Single endpoint that routes to any provider
- **Protocol Transformation:** Converts between OpenAI, Anthropic, and other formats
- **Load Balancing:** Multiple targets per model alias with randomized distribution
- **Usage Tracking:** Cost calculation and request logging
- **Quota Management:** Provider cooldowns and quota checking

---

## Tech Stack

| Component | Technology |
|-----------|------------|
| Runtime | [Bun](https://bun.sh) |
| Backend Framework | Fastify |
| Frontend Framework | React 19 + TypeScript |
| Styling | Tailwind CSS v4 |
| ORM | Drizzle ORM |
| Database | SQLite (default) / PostgreSQL (production) |
| Validation | Zod |
| Testing | Bun test runner |

---

## Monorepo Structure

```
plexus/
├── packages/
│   ├── backend/          # Fastify API server
│   │   ├── src/
│   │   │   ├── services/     # Core business logic
│   │   │   ├── transformers/ # API protocol converters
│   │   │   ├── routes/       # HTTP route handlers
│   │   │   ├── types/        # TypeScript type definitions
│   │   │   ├── utils/        # Shared utilities
│   │   │   ├── db/           # Database client
│   │   │   └── drizzle/      # Schema + migrations
│   │   └── test/         # Test files + global setup
│   └── frontend/         # React dashboard
│       ├── src/
│       │   ├── pages/        # Route components
│       │   ├── components/   # Reusable UI components
│       │   ├── lib/          # API client + utilities
│       │   └── assets/       # Static files (images, etc.)
│       └── dist/         # Build output (generated)
├── config/
│   └── plexus.yaml       # Main configuration file
├── scripts/
│   └── dev.ts            # Dev server orchestrator
└── package.json          # Root workspace config
```

---

## Essential Commands

### Development
```bash
# Full stack development (recommended)
bun run dev

# Backend only (runs on port 4000)
cd packages/backend && bun run dev

# Frontend only (watch mode)
cd packages/frontend && bun run dev

# Type checking (all workspaces)
bun run typecheck
```

### Testing
```bash
# Run all tests
cd packages/backend && bun test

# Watch mode
cd packages/backend && bun run test:watch

# Tests preload setup.ts automatically (see bunfig.toml)
```

### Building
```bash
# Build frontend for production
cd packages/frontend && bun run build

# Compile to standalone binary (all platforms)
bun run compile:linux      # plexus-linux
bun run compile:macos    # plexus-macos  
bun run compile:windows  # plexus.exe

# Build all + compile single binary
bun run build:bin
```

### Database (Drizzle)
```bash
cd packages/backend

# Generate migrations (SQLite)
bunx drizzle-kit generate

# Generate migrations (PostgreSQL)
bunx drizzle-kit generate --config drizzle.config.pg.ts

# Apply migrations manually (usually auto-applied on startup)
bunx drizzle-kit migrate
```

---

## Code Patterns & Conventions

### Backend (Fastify)

2. **Update exports for new tables**: When adding a NEW table (not just columns), you MUST update `drizzle/schema/index.ts` to export the new schema so drizzle-kit can detect it:
   ```typescript
   // Add to SQLite exports (top section)
   export * from './sqlite/new-table-name';
   
   // Add to PostgreSQL exports (bottom section)
   export { newTableName as pgNewTableName } from './postgres/new-table-name';
   ```
   **CRITICAL**: Without updating these exports, `drizzle-kit generate` will report "No schema changes" and won't create migrations.

3. **Generate migration**:
   ```bash
   bunx drizzle-kit generate
   ```

4. **Review the generated SQL** in `drizzle/migrations/XXXX_description.sql`

5. **Restart the application** - migrations auto-apply on startup

### 6.5 Type Definitions

Inferred types are available in `packages/backend/src/db/types.ts`:

#### Service Pattern
Services are singleton classes with clear responsibilities:

```typescript
// packages/backend/src/services/example-service.ts
import { logger } from '../utils/logger';

export class ExampleService {
  private static instance: ExampleService;
  
  private constructor() {}
  
  static getInstance(): ExampleService {
    if (!ExampleService.instance) {
      ExampleService.instance = new ExampleService();
    }
    return ExampleService.instance;
  }
  
  async doSomething(): Promise<void> {
    logger.info('Doing something');
  }
}
```

#### Transformer Pattern
Transformers convert between API formats:

```typescript
// packages/backend/src/transformers/
export class SomeTransformer implements Transformer {
  name = "provider-name";
  defaultEndpoint = "/v1/chat/completions";

  async parseRequest(input: any): Promise<UnifiedChatRequest> {
    // Convert incoming to unified format
  }

  async transformRequest(request: UnifiedChatRequest): Promise<any> {
    // Convert unified to provider format
  }

  async transformResponse(response: any): Promise<UnifiedChatResponse> {
    // Convert provider response to unified
  }
}
```

#### Route Registration
Routes are registered in `index.ts` via dedicated functions:

```typescript
// packages/backend/src/routes/inference/index.ts
export async function registerInferenceRoutes(
  fastify: FastifyInstance,
  dispatcher: Dispatcher,
  usageStorage: UsageStorageService
) {
  fastify.post('/v1/chat/completions', async (request, reply) => {
    // Handler logic
  });
}
```

### Frontend (React)

#### Component Structure
```typescript
// Functional components with explicit types
import React from 'react';

interface ComponentProps {
  title: string;
  onAction: () => void;
}

export const ComponentName: React.FC<ComponentProps> = ({ title, onAction }) => {
  return (
    <div className="tailwind-classes-here">
      {title}
    </div>
  );
};
```

#### API Client Pattern
```typescript
// packages/frontend/src/lib/api.ts
const API_BASE = '/v0';

export async function fetchData(): Promise<DataType> {
  const response = await fetch(`${API_BASE}/endpoint`);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}
```

#### Styling Guidelines
- **Tailwind v4** is used for all styling
- **CRITICAL:** Never import `globals.css` into TS/TSX files - Bun's CSS loader breaks Tailwind v4 directives
- Use `clsx` for conditional classes: `clsx('base', condition && 'conditional')`
- Static assets go in `packages/frontend/src/assets/`
- Import assets: `import logo from '../assets/logo.svg'` (not dynamic paths)

#### Formatting Utilities (ALWAYS USE THESE)
```typescript
import { formatCost, formatMs, formatTPS, formatDuration, formatTokens } from '../lib/format';

// Numbers: "1.3k", "2.5M"
formatTokens(1234);  // "1.2k"

// Costs: "$0.001234"
formatCost(0.001234);  // "$0.001"

// Duration: "2h 30m", "3mo 2w"
formatDuration(9000);  // "2h 30m"

// Time: "45ms", "2.5s"
formatMs(2500);  // "2.5s"
```

---

## Testing Guidelines

### Global Test Setup
- **File:** `packages/backend/test/setup.ts`
- **Config:** `bunfig.toml` preloads this before all tests
- Handles logger mocking and database initialization

### Mocking Rules (CRITICAL)
Bun's `mock.module` is **process-global** and cannot be undone with `mock.restore()`.

```typescript
// ✅ CORRECT: Use spyOn for existing mocks
import { logger } from "src/utils/logger";
import { spyOn } from "bun:test";

const infoSpy = spyOn(logger, "info");
expect(infoSpy).toHaveBeenCalled();

// ❌ WRONG: Don't re-mock modules that are already mocked in setup.ts
// This causes "TypeError: logger.info is not a function"
mock.module("src/utils/logger", () => ({ ... }));

// ✅ If you MUST mock a module, implement ALL methods:
mock.module("some/module", () => ({
  method1: mock(),
  method2: mock(),
  // ... every exported function
}));
```

### Test Database
- Uses SQLite in-memory by default: `sqlite://:memory:`
- Override with: `PLEXUS_TEST_DB_URL=sqlite://:memory:`
- Migrations run automatically via setup.ts

---

## Database Migrations (CRITICAL)

### NEVER Do These
- ❌ Edit existing migration files
- ❌ Manually create `.sql` migration files
- ❌ Edit `meta/_journal.json`
- ❌ Modify live database directly with SQL

### CORRECT Workflow
1. **Edit schema** in `drizzle/schema/sqlite/` or `drizzle/schema/postgres/`
2. **Generate migrations:**
   ```bash
   # SQLite
   bunx drizzle-kit generate
   
   # PostgreSQL (also needed!)
   bunx drizzle-kit generate --config drizzle.config.pg.ts
   ```
3. **Review** generated SQL files
4. **Test** by restarting server
5. **Commit** all files (SQL + journal)

---

## Configuration

### Main Config: `config/plexus.yaml`
```yaml
providers:
  openai:
    base_url: "https://api.openai.com"
    api_key: "${OPENAI_API_KEY}"

models:
  gpt-4o:
    aliases: ["gpt-4", "4o"]
    provider: openai
    model_id: "gpt-4o"

keys:
  admin-key-here:
    models: ["*"]
```

### Environment Variables
- `PORT` - Server port (default: 4000)
- `PLEXUS_DB_URL` - Database connection string
- `DEBUG=true` - Enable debug logging
- `APP_VERSION` - Version string for builds

---

## Important Gotchas

### Frontend CSS Build
- **Tailwind v4** uses `@source` directives in `globals.css`
- **Do NOT** import CSS files into TypeScript - build.ts handles linking
- Build outputs to `packages/frontend/dist/main.css`

### Import Paths
Backend uses relative imports from `src/`:
```typescript
// ✅ CORRECT
import { logger } from './utils/logger';
import { Transformer } from '../types/transformer';

// ❌ WRONG - no path aliases configured
import { logger } from '@/utils/logger';
```

### Error Handling
Always use the global error handler pattern:
```typescript
fastify.setErrorHandler((error, request, reply) => {
  if (reply.sent) return;  // Prevent double-send
  
  logger.error('Error', error);
  reply.code(500).send({
    error: { message: error.message, type: "api_error" }
  });
});
```

### Streaming Responses
For SSE streaming, use the eventsource-parser/encoder packages:
```typescript
import { createParser } from "eventsource-parser";
import { encode } from "eventsource-encoder";
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

2. Add conditional rendering (use `checkerType` when available):
```typescript
const checkerIdentifier = (quota.checkerType || quota.checkerId).toLowerCase();

if (checkerIdentifier.includes('new-checker-name')) {
  return (
    <NewCheckerQuotaDisplay result={result} isCollapsed={isCollapsed} />
  );
}
```

Why: `checkerId` may be a custom connection name, so UI routing should key off the implementation type (`checkerType`) rather than assuming the ID contains the type string.

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

#### MiniMax Balance Checker Notes

MiniMax is also a balance-style checker, but unlike Moonshot/Naga API-key patterns it requires two explicit options:

- `options.groupid` (**required**)
- `options.hertzSession` (**required**, sensitive; treat like a password)

Request pattern:

```text
GET https://platform.minimax.io/account/query_balance?GroupId=<groupid>
Cookie: HERTZ-SESSION=<hertzSession>
```

Map `available_amount` as the primary balance into a `subscription` window with `unit: dollars`.

#### Combined Balances Card Integration

**IMPORTANT:** When adding a new balance-style quota checker, you must update TWO frontend locations:

1. **Create individual display component** (e.g., `NagaQuotaDisplay.tsx`) - This is still required for the sidebar display
2. **Update `CombinedBalancesCard.tsx`** - Add the new checker to the normalization logic

**Update `packages/frontend/src/components/quota/CombinedBalancesCard.tsx`:**

Add the new checker type to the `CHECKER_DISPLAY_NAMES` constant:
```typescript
const CHECKER_DISPLAY_NAMES: Record<string, string> = {
  'openrouter': 'OpenRouter',
  'minimax': 'MiniMax',
  'moonshot': 'Moonshot',
  'naga': 'Naga',
  'kilo': 'Kilo',
  'new-provider': 'New Provider Name',  // Add your new checker here
};
```

And add normalization logic in the render loop (around line 50):
```typescript
let normalizedType = checkerType;
if (checkerType.includes('openrouter')) normalizedType = 'openrouter';
else if (checkerType.includes('minimax')) normalizedType = 'minimax';
else if (checkerType.includes('moonshot')) normalizedType = 'moonshot';
else if (checkerType.includes('naga')) normalizedType = 'naga';
else if (checkerType.includes('kilo')) normalizedType = 'kilo';
else if (checkerType.includes('new-provider')) normalizedType = 'new-provider';  // Add here
```

The Combined Balances Card provides a space-efficient view of all account balances on the Quotas page. Individual display components are still needed for the sidebar and other UI contexts.

#### Sidebar Compact Cards Integration

**IMPORTANT:** When adding a new quota checker (balance OR rate-limit style), you must update the sidebar filter lists to ensure the new checker appears in the compact sidebar cards.

**Update `packages/frontend/src/components/layout/Sidebar.tsx`:**

For **balance-style checkers**, add to the `BALANCE_CHECKERS` array (around line 212):
```typescript
const BALANCE_CHECKERS = ['openrouter', 'minimax', 'moonshot', 'naga', 'kilo', 'new-balance-checker'];
```

For **rate-limit checkers**, add to the `RATE_LIMIT_CHECKERS` array (around line 218):
```typescript
const RATE_LIMIT_CHECKERS = ['openai-codex', 'codex', 'claude-code', 'claude', 'zai', 'synthetic', 'nanogpt', 'new-rate-limit-checker'];
```

The sidebar will automatically display:
- **CompactBalancesCard**: Shows all balance checkers with format "Provider: $BAL"
- **CompactQuotasCard**: Shows all rate-limit checkers with format "Provider: 12% / 4%"

Both cards are collapsible sections that navigate to the full Quotas page when clicked.

---

## File Naming Conventions

| Type | Pattern | Example |
|------|---------|---------|
| Services | `*.service.ts` or descriptive | `dispatcher.ts` |
| Transformers | `*.ts` in transformers/ | `anthropic.ts` |
| Routes | `*.ts` in routes/ | `inference.ts` |
| Types | `*.ts` in types/ | `unified.ts` |
| Tests | `*.test.ts` | `pricing_config.test.ts` |
| React Components | PascalCase | `Dashboard.tsx` |
| Utilities | camelCase | `format.ts` |

---

## Useful References

- **Entry Points:**
  - Backend: `packages/backend/src/index.ts`
  - Frontend: `packages/frontend/src/main.tsx`
  
- **Key Files:**
  - Config: `packages/backend/src/config.ts`
  - Logger: `packages/backend/src/utils/logger.ts`
  - API Client: `packages/frontend/src/lib/api.ts`
  - Format Utils: `packages/frontend/src/lib/format.ts`

- **External Docs:**
  - [Bun Runtime](https://bun.sh)
  - [Fastify](https://fastify.dev)
  - [Drizzle ORM](https://orm.drizzle.team)
  - [Zod](https://zod.dev)
  - [Tailwind CSS v4](https://tailwindcss.com)

---

## Release Process

1. Update `CHANGELOG.md` with version details
2. Create git tag: `git tag v1.x.x`
3. Push tag: `git push origin v1.x.x`
4. GitHub Actions builds binaries + Docker image automatically
5. Release published with notes from CHANGELOG

---

## Emergency Contacts

If you break something:
1. Check existing tests: `bun test`
2. Review recent migrations: `drizzle/migrations/`
3. Check logs: `DEBUG=true bun run dev`
4. Reset database: Delete `config/usage.sqlite` (dev only!)
