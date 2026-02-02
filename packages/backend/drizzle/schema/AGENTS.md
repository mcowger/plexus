# Drizzle Schema AGENTS.md

## Database Schema Guidelines

This directory contains Drizzle ORM schema definitions for Plexus.

### Schema Organization

- **`postgres/`** - PostgreSQL table definitions (used when `PLEXUS_DB_TYPE=postgres`)
- **`sqlite/`** - SQLite table definitions (default, used when `PLEXUS_DB_TYPE=sqlite`)

### Always Use the Correct Schema

When importing schema in services, use the appropriate import:

```typescript
// For PostgreSQL services
import { getSchema } from '../db/client';
// or import specific tables from postgres/ subdirectory

// For SQLite services  
import * as schema from './sqlite';
```

**Never import from the parent `schema/index.ts` without considering dialect-specific implementations.**

### Migration Safety Rules

#### NEVER Edit Existing Migrations

**Modifying existing migration files is NEVER acceptable.** Migration files represent the historical change sequence of your database schema. Editing them can:

- Break production databases with out-of-sync migration history
- Cause data loss or corruption
- Create inconsistencies between development and production environments

#### Always Create NEW Migrations

When schema changes are needed:

1. **Edit the appropriate schema file** in `postgres/` or `sqlite/`
2. **Generate a new migration**:
   ```bash
   # For PostgreSQL
   PLEXUS_DB_TYPE=postgres bunx drizzle-kit generate
   
   # For SQLite (default)
   bunx drizzle-kit generate
   ```
3. **Review the new migration** in `drizzle/migrations/` or `drizzle/migrations_pg/`
4. **Test the migration** in development before deploying

#### Live Database Safety

- It is NEVER acceptable to attempt to modify a live database directly
- Always use migrations for schema changes
- Test migrations in development/staging before production

### Adding New Tables or Columns

1. **Edit the appropriate dialect schema file** (e.g., `postgres/request-usage.ts`)
2. **Generate migration**:
   ```bash
   bunx drizzle-kit generate
   ```
3. **Review the generated SQL** in `drizzle/migrations_pg/XXXX_description.sql`
4. **Restart the application** - migrations auto-apply on startup

### Type Definitions

Inferred types are available in `packages/backend/src/db/types.ts`:

```typescript
import { InferSelectModel, InferInsertModel } from 'drizzle-orm';
```
