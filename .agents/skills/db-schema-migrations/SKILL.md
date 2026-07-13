---
name: db-schema-migrations
description: How to safely add or modify database schema in Plexus using Drizzle ORM. Use whenever adding tables, columns, or enum values — covers migration rules, schema organization, and dialect-specific timestamp patterns.
---

# Database Schema & Migrations

Plexus uses **Drizzle ORM** with SQLite (default) or Postgres. Schema files live in `packages/backend/drizzle/schema/`.

## Schema Organization

```
drizzle/schema/
├── index.ts          ← must export every table; missing exports = "No schema changes" from drizzle-kit
├── postgres/         ← Postgres table definitions (PLEXUS_DB_TYPE=postgres)
└── sqlite/           ← SQLite table definitions (default)
```

Always edit the correct dialect subdirectory. When adding a new table, **update `drizzle/schema/index.ts`** to export it or `drizzle-kit generate` will silently report "No schema changes."

## Migration Rules (non-negotiable)

**NEVER edit existing migration files.** Migrations represent the historical change sequence. Editing them causes out-of-sync history, data loss risk, and broken deployments.

**NEVER manually create migration SQL files or edit `meta/_journal.json`.** Drizzle-kit ignores migrations not in the journal. Manual creation causes conflicting migrations and corrupts the migration system.

**NEVER modify a live database directly with SQL commands.** Always use migrations.

### The Only Correct Workflow

1. Edit schema `.ts` files in `postgres/` or `sqlite/`.
2. Validate locally (optional): `bun run generate-migrations` — verify the SQL looks right.  DO NOT *delete* generated files.  It is desired to leavse them in place without committing them.
3.  **Never run `drizzle-kit generate` directly.**
4. Commit only the schema `.ts` changes. The pre-commit hook blocks migration artifacts.
5. After the PR merges to `main`, CI auto-generates and commits the migrations.

### Migration Naming

Migrations **must** have a descriptive, semantic name. The wrapper script enforces this:

```bash
bun run generate-migrations                        # auto-derives name from branch
bun run generate-migrations --name add_quota_checkers  # explicit name
```

If `--name` is omitted, the script derives a name from the current git branch (e.g., `pi/issue-424-1779050379120` → `auto_issue_424`). On the `main` branch, `--name` is required.

This produces files like `0044_add_quota_checkers.sql` or `0044_auto_issue_424.sql` instead of `0044_rare_skullbuster.sql`.

- Use `snake_case` starting with a verb: `add_`, `create_`, `drop_`, `rename_`, `update_`, `fix_`, `remove_`, `convert_`, `jsonb_`, etc.
- Auto-derived names use the `auto_` prefix.
- Do **not** use random or meaningless names. The `lint:migrations` script rejects them.

**Bypasses (maintainers only):**
- Pre-commit hook: `ALLOW_MIGRATIONS=1 git commit`
- PR check: add the `migrations-ok` label to the PR

## Adding a New Table — Checklist

- [ ] Create the table definition in the appropriate dialect directory.
- [ ] Export the new table from `drizzle/schema/index.ts`.
- [ ] If Postgres, add any new enum values to `postgres/enums.ts` (e.g. `quotaCheckerTypeEnum`).
- [ ] Validate with `bun run generate-migrations --name <descriptive-name>` locally if desired — discard output.
- [ ] Commit only `.ts` schema files.  DO NOT DELETE GENERATED MIGRATIONS even if you do not commit them.

## Type Definitions

Infer types from the schema rather than writing them manually:

```typescript
import { InferSelectModel, InferInsertModel } from 'drizzle-orm';
import { myTable } from '../drizzle/schema';

type MyRow    = InferSelectModel<typeof myTable>;
type NewMyRow = InferInsertModel<typeof myTable>;
```

Shared inferred types also live in `packages/backend/src/db/types.ts`.

## Dialect-Aware Timestamp Conversions

SQLite and Postgres use different column types for timestamps. **Never write inline `dialect === 'postgres' ? ... : ...` timestamp logic.** Always use the shared utilities from `src/utils/normalize.ts`.

### Pattern 1: `text` (SQLite) vs `timestamp` (Postgres)

Used by columns like `mcp_request_usage.created_at`, `mcp_debug_logs.created_at`.

- SQLite `text('col')` → Drizzle expects a `string` (ISO 8601)
- Postgres `timestamp('col')` → Drizzle expects a `Date` object

```typescript
import { toDbTimestamp } from '../../utils/normalize';
import { getCurrentDialect } from '../../db/client';

const createdAt = toDbTimestamp(record.created_at, getCurrentDialect());
// SQLite  → "2026-02-09T17:36:14.297Z"  (string)
// Postgres → Date object
```

### Pattern 2: `integer(timestamp_ms)` (SQLite) vs `bigint(number)` (Postgres)

Used by columns like `quota_snapshots.checked_at`, `quota_snapshots.resets_at`, `quota_snapshots.created_at`.

- SQLite `integer('col', { mode: 'timestamp_ms' })` → Drizzle expects a `Date` object
- Postgres `bigint('col', { mode: 'number' })` → Drizzle expects a `number` (epoch ms)

```typescript
import { toDbTimestampMs } from '../../utils/normalize';
import { getCurrentDialect } from '../../db/client';

const checkedAt = toDbTimestampMs(result.checkedAt, getCurrentDialect());
// SQLite  → Date object
// Postgres → 1739122574297  (number)
```

Both functions accept `Date | number | string | null | undefined` and return `null` for invalid/nullish values.
