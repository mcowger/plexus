---
name: vitest
description: Vitest 5 testing guidance for Plexus, including project conventions, mocking, configuration, coverage, filtering, and fixtures.
metadata:
  author: Anthony Fu
  version: "2026.1.28"
  source: Generated from https://github.com/vitest-dev/vitest, scripts located at https://github.com/antfu/skills
---

# Vitest in Plexus

Plexus uses Vitest 5.0.0. Read [docs/TESTING.md](../../../docs/TESTING.md) before changing tests or test configuration. Its placement, mock, spy, and singleton-reset rules take precedence over generic examples in this skill.

## Project commands

Run these from the repository root:

```bash
bun run test          # affected tests (`--changed HEAD`)
bun run test:force    # full suite
bun run test:watch    # watch mode
```

Use `bun run test`, not `bun test`. Both the root and backend `bunfig.toml` files intentionally block the raw Bun test runner.

## Plexus configuration

- `packages/backend/vitest.config.ts` defines the `unit`, `sqlite`, and `postgres` projects through `test.projects`.
- The project config files use `defineProject` and explicitly copy shared settings from the base config. Config-file projects do not inherit root options automatically.

## Vitest 5 compatibility notes

- Worker configuration is top-level: use `pool`, `maxWorkers`, `isolate`, and `vmMemoryLimit`. `poolOptions`, `maxThreads`, `maxForks`, and `minWorkers` are legacy options removed by the current pool configuration.
- Multi-project configuration uses `test.projects`. `workspace` is the deprecated name.
- Vitest 5 removed `test.sequential` and `describe.sequential`; opt out of inherited concurrency with `{ concurrent: false }`.
- Use `coverage.include` to report covered and uncovered source files. `coverage.all` is removed.
- Browser examples use provider factories such as `playwright()`.
- `test.override` replaces the deprecated `test.scoped` fixture override API.

Official references:

- [Configuration](https://vitest.dev/config/)
- [Migration guide](https://vitest.dev/guide/migration.html)
- [Test projects](https://vitest.dev/guide/projects.html)
- [Test API](https://vitest.dev/api/test)
- [Hooks](https://vitest.dev/api/hooks)

## Reference scope

The reference pages below started as generated Vitest 3.x material. The version-sensitive examples called out above were checked against Vitest 5.0.0 and updated where verified, but this is not a claim that every legacy example was regenerated. Recheck the official docs before relying on less common APIs.

## Core

| Topic | Description | Reference |
|-------|-------------|-----------|
| Configuration | Vitest and Vite config integration, `defineConfig` usage | [core-config](references/core-config.md) |
| CLI | Command line interface, commands, and options | [core-cli](references/core-cli.md) |
| Test API | `test`/`it` functions and modifiers | [core-test-api](references/core-test-api.md) |
| Describe API | `describe`/`suite` for grouping tests | [core-describe](references/core-describe.md) |
| Expect API | Assertions, matchers, and asymmetric matchers | [core-expect](references/core-expect.md) |
| Hooks | Setup, teardown, and around hooks | [core-hooks](references/core-hooks.md) |

## Features

| Topic | Description | Reference |
|-------|-------------|-----------|
| Mocking | Mock functions, modules, timers, and dates with `vi` | [features-mocking](references/features-mocking.md) |
| Snapshots | External and inline snapshots | [features-snapshots](references/features-snapshots.md) |
| Coverage | V8 and Istanbul coverage providers | [features-coverage](references/features-coverage.md) |
| Test Context | Fixtures, context, and `test.extend` | [features-context](references/features-context.md) |
| Concurrency | Concurrent tests, worker pools, and sharding | [features-concurrency](references/features-concurrency.md) |
| Filtering | Filter by names, files, tags, and projects | [features-filtering](references/features-filtering.md) |

## Advanced

| Topic | Description | Reference |
|-------|-------------|-----------|
| Vi Utilities | `vi` helpers for mocks, timers, and waiting | [advanced-vi](references/advanced-vi.md) |
| Environments | Node, browser-like, and custom environments | [advanced-environments](references/advanced-environments.md) |
| Type Testing | `expectTypeOf` and `assertType` | [advanced-type-testing](references/advanced-type-testing.md) |
| Projects | Multi-project configuration for monorepos and test types | [advanced-projects](references/advanced-projects.md) |
