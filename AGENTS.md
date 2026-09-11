# Plexus agent rules

This file is a **guardrail**, not general documentation.

**Use order:**
1. Read **Critical rules**.
2. Match the task in **Task triggers**.
3. Use the listed command/workflow exactly.
4. If unsure, **ask** instead of guessing.

## 🚨 STOP — MANDATORY FIRST STEP

> **Before tracing how anything works, you MUST read `.repomap.txt`.**
> **Do not start by grepping through files.** The repomap is vastly more efficient.

## Critical rules

- **NEVER** commit, push, or create a PR unless the user explicitly asks.
- **NEVER** treat earlier permission as ongoing permission. Each individual commit/push needs fresh approval in local/interactive sessions.
- **NEVER** use `--no-verify` or `LEFTHOOK=0` without user permission.
- **NEVER** manually create or edit migration artifacts.
- **NEVER** produce implementation or summary documents unless specifically requested.
- **DEBUGGING** Plexus instances: read and use the `plexus-cli` skill. The worktree `.env` contains the relevant staging configuration. When the user specifies `staging`, use `PLEXUS_STAGING_URL` for the staging URL and `PLEXUS_ADMIN_KEY` for the admin key.
- **AVOID** searching library type definitions for documentation. Use context/search skills first when available.
- **ASK** when requirements are ambiguous.
- **USE** agents / subtasks aggressively where tools allow for improved cost and performance.

## Task triggers

### If the task changes database schema

Before editing schema files, read the **`db-schema-migrations`** [skill](.agents/skills/db-schema-migrations/SKILL.md).
Local validation with `bun run generate-migrations` is optional. Leave generated artifacts in place and uncommitted; follow the skill for the full workflow.

### If the task writes or updates tests

Before editing tests, read [docs/TESTING.md](docs/TESTING.md) for Plexus test placement, mocks, spies, and singleton resets. Load the **`vitest`** skill for framework reference; project rules take precedence over generic examples.

### If the task changes frontend code

Before editing frontend code, read [packages/frontend/AGENTS.md](packages/frontend/AGENTS.md) for CSS, assets, and component rules.

After editing anything a user sees in the browser (React, routes, forms, CSS, layout, or any file under `packages/frontend/src`), use the **`frontend-testing`** [skill](.claude/skills/frontend-testing/SKILL.md). Boot the worktree-safe dev stack, auto-log in, and verify rendering and behavior with a real browser before handing the work back.

## Canonical project commands

Run these commands from the repository root:

- Dev server: `bun run dev`
- Dev stack for agents (background, worktree-safe): `bun run dev:agent --detach`
- Stop the agent dev stack: `bun run dev:stop`
- Tests: `bun run test` (never `bun test`)
- Type check: `bun run typecheck`
- Lint check: `bun run lint:check`
- Format: `bun run format`
- Format check: `bun run format:check`

For lifecycle targets, ports, and FRP tunnels, read [Development](CONTRIBUTING.md#development).
For optional Cora commands, read [Manual Cora review](CONTRIBUTING.md#manual-cora-review); never invoke Cora automatically during commits or install it just for a review.

## Before handing work back

- After code changes, run relevant tests, typecheck, lint check, and format check using the commands above.
- For browser-visible changes, also complete the frontend verification workflow.
- For documentation-only changes, check links, command references, and formatting; don't boot the application or run unrelated tests.
- Report the checks run and their results. State any failures, skipped checks, or blockers explicitly; blocked verification is not a passing check.

## Project overview

**Plexus** is a unified API gateway for LLMs built on **Bun** + **Fastify**. It exposes OpenAI- and Anthropic-compatible endpoints and routes requests to backend providers while handling request/response transformation.
**Stack:** Bun, Fastify, Drizzle ORM (SQLite/Postgres), Zod, React frontend (Tailwind v4).
