## Skills

| Skill | When to Use |
|-------|-------------|
| **`db-schema-migrations`** | Database schema changes |
| **`vitest`** | Testing and mocking |
| **`add-quota-checker`** | Adding new quota checker types |
| **`agent-browser`** | Browser automation, web interaction, testing web apps |

## Project Overview

**Plexus** is a unified API gateway for LLMs. Built on **Bun** + **Fastify**, it exposes OpenAI- and Anthropic-compatible endpoints and routes requests to any backend provider, handling request/response transformation automatically.

**Stack:** Bun, Fastify, Drizzle ORM (SQLite/Postgres), Zod, React frontend (Tailwind v4).

---

## Critical Requirements

- **NEVER** commit or push without explicit request, unless running in CI (`CI=true`). In local/interactive sessions, every individual commit and push requires explicit user permission — even if permission was granted earlier in the same session. Do not assume continued consent. In GitHub Actions (CI), commits and pushes are expected as part of the workflow and do not require per-instance approval.
- **NEVER** use --no-verify or LEFTHOOK=0 without user permission.
- **AVOID** search library type definitions for documentation. Use search and context skills where available first.
- **NEVER** produce implementation or summary documents unless specifically requested.
- **NEVER** edit existing migration files or manually create SQL migrations. See [Migrations](#migrations) below.
- **Only errors matter.** When reading linter, type-checker, or build output, ignore warnings — only fix actual errors. Warnings should not block progress or require changes.

---

## Efficiency & Batching

Think ahead and **perform multiple reads, edits, and commands in the same response** whenever they don't depend on each other's results. Minimize round-trips by:

- **Reading multiple files at once.** If you need to understand several files to diagnose a problem, issue all reads in one call rather than sequentially.
- **Making multiple edits at once.** When changing several locations in a file, or multiple independent files, issue all edits in parallel.
- **Batching independent tool calls.** Any tool calls (reads, edits, bash commands) that don't depend on each other's results should be issued in the same turn.
- **Planning before acting.** Before calling a tool, consider what else you'll need and whether you can combine it with the current call. A little upfront planning avoids many round-trips.

---


## Database & Migrations

Use the **`db-schema-migrations`** skill for full guidance on schema changes and migrations.

---

## Development & Testing

- **Dev server:** `bun run dev` (backend port 4000 + frontend watcher)
- **Tests:** `bun run test` from the repo root or from `packages/backend/` (`bun test` is intentionally blocked both at repo root and in `packages/backend` with a guidance message)
- **Format:** `bun run format` / `bun run format:check`


### Testing

Use the **`vitest`** skill for full testing guidance. Key project-specific notes:

- Unit tests: `__tests__/` subdirectory alongside the source file
- Integration tests: `test/integration/`
- Run tests: `bun run test` (not `bun test`)
- Use `registerSpy` from `test/test-utils.ts` instead of raw `vi.spyOn`
- Global mocks: `utils/logger` and `@earendil-works/pi-ai` (don't re-mock in test files)
- Reset singletons via `resetForTesting()` methods in `beforeEach`

---

## Pi Assistant (AI Agent Workflow)

The `/pi` trigger in issue and PR comments is handled by `.github/workflows/pi-assistant.yml`,
which invokes `mcowger/pi-action`.

### Prompt file

The agent's system prompt lives at **`.github/prompts/pi-assistant.md`** — edit that file
to change what the agent is instructed to do. Do not put prompt text inside the workflow YAML.

The prompt file supports `{{dot.notation.path}}` placeholders resolved at runtime against
two namespaces:

| Namespace | Contents | Example |
|-----------|----------|---------|
| `context.*` | The full `@actions/github` context — event payload, actor, SHA, ref, repo, etc. | `{{context.payload.comment.body}}` |
| `env.*` | All environment variables, including `GITHUB_*` / `RUNNER_*` runner vars and any values passed via the step's `env:` block | `{{env.INITIAL_COMMENT_ID}}` |

Most GitHub context data is available automatically via `context.*`. The only value
currently passed explicitly via `env:` is `INITIAL_COMMENT_ID`, because it is derived
from a previous workflow step output and is not part of the event payload.

### Workflow env: block

If a new placeholder is needed that cannot be sourced from `context.*`, add it to the
`env:` block on the **Run Pi agent** step in `pi-assistant.yml` and reference it as
`{{env.YOUR_VAR_NAME}}` in the prompt file. Do not add it to any other step.

---

## Frontend

### Tailwind CSS v4
- **NEVER** import CSS files with Tailwind directives into `.ts`/`.tsx` files — Bun's CSS loader breaks Tailwind v4 `@theme`/`@source`.
- Build: `@tailwindcss/cli` from `packages/frontend`, input `./src/globals.css`, output `./dist/main.css`.
- Source directive: `@source "../src/**/*.{tsx,ts,jsx,js}";` in `globals.css`.

### Assets
- Place in `packages/frontend/src/assets/`, import with ES6 imports. No dynamic paths.


