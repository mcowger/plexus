# Drizzle Schema

This directory contains Drizzle ORM schema definitions for Plexus.

Use the **`db-schema-migrations`** skill for full guidance on schema organization, migration rules, adding tables, type definitions, and dialect-aware timestamp patterns.

## Quick reference

- `postgres/` — Postgres table definitions (`PLEXUS_DB_TYPE=postgres`)
- `sqlite/` — SQLite table definitions (default)
- When importing schema in services, use the appropriate dialect import — never import from the parent `schema/index.ts` without considering dialect-specific implementations.
