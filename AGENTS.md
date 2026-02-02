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