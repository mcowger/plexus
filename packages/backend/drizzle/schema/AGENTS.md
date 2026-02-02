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

#### NEVER Manually Create Migration Files

**You must NEVER manually create migration SQL files or edit the migration journal (`meta/_journal.json`).** Always use `drizzle-kit generate` to create migrations automatically. Manual migration creation causes critical issues:

- Drizzle-kit ignores migrations not in the journal
- Running `drizzle-kit generate` will create conflicting migrations
- The migration system becomes out of sync with the schema
- Causes failed deployments and database corruption

#### The ONLY Correct Migration Workflow

When schema changes are needed, follow these steps **exactly**:

1. **Edit the schema files** in `postgres/` or `sqlite/` subdirectories
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
