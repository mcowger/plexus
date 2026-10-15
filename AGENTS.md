# Plexus agent rules

This file is a **guardrail**, not general documentation.

**Use order:**
1. Read **Critical rules**.
2. Match the task in **Task triggers**.
3. Use the listed command/workflow exactly.

Use the built-in search tool to query `.repomap.txt` by symbol, keyword, or path; never load the whole index. Read the matching source files to verify the implementation. For broader architectural questions, search the repository directly.

## Critical rules

- **NEVER** use `--no-verify` or `LEFTHOOK=0` without user permission.
- **NEVER** manually create or edit migration artifacts.
- **NEVER** run `tsc`/`tsgo` directly. Type checking is `bun run typecheck` (backed by `bun check`).
- **NEVER** produce implementation or summary documents unless specifically requested.
- **DEBUGGING / ADMINISTERING** Plexus instances: prefer the Plexus MCP tools when available for the target instance and required operation; they are more efficient than CLI or raw REST calls. Read the `plexus-cli` skill for the fallback workflow: MCP first, CLI second, REST API last. For live CLI debugging of `staging`, use the worktree `.env` values `PLEXUS_STAGING_URL` and `PLEXUS_ADMIN_KEY`. This is separate from `scripts/prep-dev.ts`, which uses `PLEXUS_STAGING_ADMIN_KEY` for staging imports and `PLEXUS_ADMIN_KEY` for the local instance.

## Task triggers

### If the task changes database schema

Before editing schema files, read the **`db-schema-migrations`** [skill](.agents/skills/db-schema-migrations/SKILL.md).
Local validation with `bun run generate-migrations` is optional. Leave generated artifacts in place and uncommitted; follow the skill for the full workflow.

### If the task adds an OAuth provider

Before writing code, read [packages/backend/AGENTS.md](packages/backend/AGENTS.md) for the end-to-end checklist (auth module, facade registration, dispatch, quota checker, model discovery, live-server verification). A working auth flow alone does not surface the provider anywhere.

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
- Type check: `bun run typecheck` (uses `bun check`; never `tsc`)
- Lint check: `bun run lint:check`
- Format: `bun run format`
- Format check: `bun run format:check`

For lifecycle targets, ports, and FRP tunnels, read [Development](CONTRIBUTING.md#development).
For optional review commands, read [Manual OpenCodeReview review](CONTRIBUTING.md#manual-opencodereview-review); never invoke OpenCodeReview automatically during commits or install it just for a review.

## Before handing work back

- After code changes, run relevant tests, typecheck, lint check, and format check using the commands above.
- For browser-visible changes, also complete the frontend verification workflow.
- For documentation-only changes, check links, command references, and formatting; don't boot the application or run unrelated tests.
- Report the checks run and their results. State any failures, skipped checks, or blockers explicitly; blocked verification is not a passing check.

## Project overview

**Plexus** is a unified API gateway for LLMs built on **Bun** + **Fastify**. It exposes OpenAI- and Anthropic-compatible endpoints and routes requests to backend providers while handling request/response transformation.
**Stack:** Bun, Fastify, Drizzle ORM (SQLite/Postgres), Zod, React frontend (Tailwind v4).
