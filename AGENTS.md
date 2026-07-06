# Plexus agent rules

This file is a **guardrail**, not general documentation.

**Use order:**
1. Read **Critical rules**.
2. Match the task in **Task triggers**.
3. Use the listed command/workflow exactly.
4. If unsure, **ask** instead of guessing.

## Critical rules

- **NEVER** commit, push, or create a PR unless the user explicitly asks.
- **NEVER** treat earlier permission as ongoing permission. Each individual commit/push needs fresh approval in local/interactive sessions.
- **NEVER** use `--no-verify` or `LEFTHOOK=0` without user permission.
- **NEVER** edit existing migration files.
- **NEVER** manually create SQL migrations.
- **NEVER** run `drizzle-kit generate` directly.
- **NEVER** produce implementation or summary documents unless specifically requested.
- **AVOID** searching library type definitions for documentation. Use context/search skills first when available.
- **ASK** when requirements are ambiguous.
- **NEVER** use --delete-branch on gh commands
## Task triggers

### If the task changes database schema

Before editing schema files:

1. Read the **`db-schema-migrations`** skill.
2. Update the Drizzle schema.
3. Generate migrations with:

```bash
bun run generate-migrations
bun run generate-migrations --name add_foo
```

4. Lint migrations with:

```bash
bun run lint:migrations
```

Rules:
- On `main`, `--name` is required.
- Random migration names like `rare_skullbuster` are rejected by CI.

### If the task writes or updates tests

Before editing tests:

1. Read the **`vitest`** skill.
2. Follow these project rules:
   - Unit tests go in `__tests__/` alongside the source file.
   - Integration tests go in `test/integration/`.
   - Run tests with `bun run test`.
   - Do **not** use `bun test`.
   - Use `registerSpy` from `test/test-utils.ts` instead of raw `vi.spyOn`.
   - `utils/logger` and `@earendil-works/pi-ai` are globally mocked; do not re-mock them in test files.
   - Reset singletons via `resetForTesting()` methods in `beforeEach`.


### If the task touches frontend CSS/assets/Tailwind

Rules:
- **NEVER** import CSS files with Tailwind directives into `.ts` or `.tsx` files.
- Build CSS with `@tailwindcss/cli` from `packages/frontend`.
- Input: `./src/globals.css`
- Output: `./dist/main.css`
- Keep this directive in `globals.css`:

```css
@source "../src/**/*.{tsx,ts,jsx,js}";
```

- Put assets in `packages/frontend/src/assets/`.
- Import assets with ES6 imports only.
- Do not use dynamic asset paths.

### If the task changes the frontend UI

After editing anything a user sees in the browser (React `.tsx`/`.jsx`, routes, forms,
Tailwind/CSS, layout, or any file under `packages/frontend/src`), verify it yourself
instead of handing it back unchecked:

1. Read the **`frontend-testing`** skill.
2. Boot the worktree-safe dev stack, auto-log into the UI, and drive it with a real
   browser to confirm your change renders and behaves correctly.

## Canonical project commands

Use these commands exactly:

- Dev server: `bun run dev`
- Dev stack for agents (background, worktree-safe): `bun run dev:agent`
- Stop the agent dev stack: `bun run dev:stop`
- Dev port: `PORT=$(bun run dev:get:port)`
- Dev DB path: `DB_PATH=$(bun run dev:get:db_path)`
- Tests: `bun run test`
- Type check: `bun run typecheck`
- Format: `bun run format`
- Format check: `bun run format:check`

Notes:
- `bun run dev` derives the backend port from the worktree name and runs the frontend watcher.
- `bun run dev:agent` boots the full stack detached and returns once healthy (unlike `dev:full`, which runs in the foreground and never returns); use it when an agent needs a running instance to test against.
- `bun test` is intentionally blocked. Use `bun run test`.

## Project overview

**Plexus** is a unified API gateway for LLMs built on **Bun** + **Fastify**. It exposes OpenAI- and Anthropic-compatible endpoints and routes requests to backend providers while handling request/response transformation.
**Stack:** Bun, Fastify, Drizzle ORM (SQLite/Postgres), Zod, React frontend (Tailwind v4).
