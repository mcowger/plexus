# Testing Guide

This is the source of truth for Plexus testing conventions. File paths are relative to the repository root unless marked otherwise.

Tests run on Bun's native test runner (`bun:test`). There is no Vitest, no config file, no wrapper script — `bun test` from the repo root is the whole suite.

## Running Tests

### Full Suite

From the repo root:

```bash
bun test
```

This collects `packages/backend`, `packages/cli`, `packages/frontend`, `packages/shared`, and `scripts` tests in one run, in one process (about 16s). A `[test]` preload in `bunfig.toml` registers shared mocks and creates a migrated test database before any test file loads. No flags or wrapper scripts are required.

CI and the pre-commit hook run `bun test --parallel`, which spreads files across worker processes (about 8s) and gives every file a fresh global. CI additionally runs plain `bun test` as a leak check. **Test files must pass both ways** — the plain run shares one process, so see [Shared-process isolation](#shared-process-isolation) before writing a mock.

### Affected Only

```bash
bun test --changed=HEAD
```

Runs only tests affected by uncommitted changes. Use this unless you have a specific reason to run the full suite. The `=` is required: `--changed HEAD` treats `HEAD` as a file filter and matches nothing.

### Single File / Directory

```bash
bun test ./packages/backend/src/services/__tests__/aliases.test.ts
bun test packages/cli
```

Filters are path substrings; pass `./`-prefixed paths to target a specific file.

### Postgres (pglite) Dialect

The default run exercises the SQLite dialect. Tests that touch the database layer also run against pglite in CI:

```bash
PLEXUS_TEST_DIALECT=postgres bun test --parallel <db-layer test files>
```

The list of DB-layer files lives in the "Run DB tests against Postgres" step of [`.github/workflows/pr-tests.yml`](../.github/workflows/pr-tests.yml) (it replaces the old `vitest.db-tests.ts`). **When you add a test that exercises the database layer, add it to that step.**

### Typecheck

```bash
bun run typecheck
```

Runs `bun check` (Bun's built-in TypeScript checker) in every workspace via `bun run --workspaces typecheck`. Never run `tsc`/`tsgo` directly, and never add a `typescript` dependency — `bun check` reads `tsconfig.json` with no install needed. Required before handing work back (see [AGENTS.md](../AGENTS.md#before-handing-work-back)); CI runs it as a blocking gate.

### Watch Mode

```bash
bun --watch test
```

Re-runs tests on file changes.

### Manual Testing (Dev Environment)

For agent-driven checks, start or reuse the worktree-safe background stack:

```bash
bun run dev:agent --detach
```

Use the printed port for the UI at `http://localhost:<PORT>/ui/` and API requests at `http://localhost:<PORT>/v1/...`.
For browser-visible changes, follow the [frontend-testing skill](../.claude/skills/frontend-testing/SKILL.md), including real-browser interaction and persistence checks.
See [Development](../CONTRIBUTING.md#development) for foreground mode, lifecycle commands, environment setup, and FRP tunnels.

### Dev Data Management (`prep-dev`)

The `prep-dev` script manages your local dev environment data. It combines the old `pull-staging`, `populate-dev`, and `clear-dev` scripts into one.

**Basic usage:**

```bash
bun run prep-dev            # Load saved local data (default)
bun run prep-dev:save       # Download from staging & save locally
bun run prep-dev:live       # Use staging data directly (one-off)
bun run prep-dev:clear      # Clear local dev data
bun run prep-dev:reset      # Clear then load saved data
```

**Saving data from staging:**

```bash
PLEXUS_STAGING_URL=https://plexus.home.cowger.us \
PLEXUS_STAGING_ADMIN_KEY=your_staging_key \
bun run prep-dev:save
```

This downloads staging data to `.dev-data/backup.tar.gz` (gitignored). Future calls to `bun run prep-dev` will use this saved file.

**Environment variables:**

| Variable                   | Required          | Description                                  |
| -------------------------- | ----------------- | -------------------------------------------- |
| `PLEXUS_STAGING_URL`       | For --save/--live | URL of staging instance                      |
| `PLEXUS_STAGING_ADMIN_KEY` | For --save/--live | Admin key for staging                        |
| `PLEXUS_DEV_DATA_PATH`     | No                | Path for saved data (default: `.dev-data/`)  |
| `PLEXUS_URL`               | No                | Local base URL (default: `http://localhost`) |
| `PLEXUS_PORT`              | No                | Local port (auto-derived from cwd)           |
| `PLEXUS_ADMIN_KEY`         | No                | Admin key for local (default: `password`)    |
| `PLEXUS_EXCLUDE_OAUTH`     | No                | Exclude OAuth providers (default: `true`)    |

**Notes:**

- The local port is auto-derived from your directory name (matches `bun run dev`)
- OAuth providers are excluded by default to avoid credential conflicts
- After restore, restart the dev server if needed. Use `bun run dev:stop` to
  stop the full stack before starting it again.

## Test Architecture

The `[test] preload` in the root `bunfig.toml` (mirrored in `packages/backend/bunfig.toml` for runs launched from that directory) points at `packages/backend/test/bun-test.setup.ts`, which runs once per test process before any test file loads. It:

1. Imports `packages/backend/test/mocks.ts` — registers the shared module mocks (logger, `@earendil-works/pi-ai` and its subpaths).
2. Creates a migrated, per-process test database and exports it via `PLEXUS_TEST_DB_URL` / `DATABASE_URL`. Defaults to SQLite; `PLEXUS_TEST_DIALECT=postgres` selects pglite instead.
3. Stubs `DebugManager` persistence with in-memory no-ops.
4. Clears mock call history and restores spies after every test (`mock.clearAllMocks()` + `jest.restoreAllMocks()`).

With plain `bun test` all files share one process, so module state (singletons, `mock.module` overrides, replaced globals) carries from file to file — see [Shared-process isolation](#shared-process-isolation).

## Test File Organization

```
packages/backend/
├── src/
│   └── <module>/
│       ├── foo.ts                   # source file
│       └── __tests__/
│           └── foo.test.ts          # unit test — lives next to the source it tests
└── test/
    ├── bun-test.setup.ts            # preload: mocks, test DB, hygiene
    ├── mocks.ts                     # shared mock definitions + handles
    ├── test-utils.ts                # shared spy/mock helpers
    └── integration/
        └── vision-*.test.ts         # multi-component / cross-service tests
```

**Rules:**

- **Unit tests** go in a `__tests__/` subdirectory alongside the source file they test under `packages/backend/src/`. Use relative imports.
- **Integration tests** (tests that exercise multiple services/components together) go in `packages/backend/test/integration/`.
- **Infrastructure** (setup files, shared utilities) stays in `packages/backend/test/` directly.
- **Never** put unit tests directly in `packages/backend/test/`, and never put integration tests inside `packages/backend/src/`.

## Mocking Rules

### Pick the mechanism

| You need to…                                            | Use                                                                         |
| ------------------------------------------------------- | --------------------------------------------------------------------------- |
| Fake a singleton / static (`ConfigService.getInstance`) | `spyOn(Class, 'method')` in a top-level `beforeEach`                        |
| Fake a first-party module's function exports            | `import * as mod from '…'` then `spyOn(mod, 'fn')` in `beforeEach`          |
| Fake `fetch`                                            | `spyOn(globalThis, 'fetch').mockImplementation(asFetch(…))` in `beforeEach` |
| Assert on / configure the logger or pi-ai               | Import the handle from `test/mocks.ts` (`mockLogger`, `mockComplete`, …)    |
| Use the **real** logger in one file                     | `actualLogger` from `test/mocks.ts` + restore in `afterAll`                 |
| Replace a third-party module for a whole file (rare)    | `mock.module(…)` **and** restore it in `afterAll` (see below)               |

**Do not `mock.module()` first-party code.** It is process-wide and permanent (see [Shared-process isolation](#shared-process-isolation)). Spies are restored automatically after every test; module mocks never are.

```typescript
import { beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';

import * as client from '../../../db/client';
import { ConfigService } from '../../../services/configuration/config-service';

const fakeConfig = { getConfig: mock(), saveKey: mock() };

// Top-level beforeEach: runs before every test in the file; the global
// afterEach (jest.restoreAllMocks) puts the real implementations back.
beforeEach(() => {
  spyOn(ConfigService, 'getInstance').mockImplementation((() => fakeConfig) as any);
  spyOn(client, 'getCurrentDialect').mockImplementation((() => 'sqlite') as any);
});
```

A spy installed with `spyOn` reaches modules that already imported the function — you do not need to mock before importing the code under test. Install it in `beforeEach`, **not** at file top level: a spy created at load time is restored after the first test and silently disappears for the rest.

### Globally mocked modules

Registered in `packages/backend/test/mocks.ts` (loaded by the preload) — **do NOT re-mock in test files**:

- `packages/backend/src/utils/logger` — logger, logEmitter, level helpers. The mock spreads the real module's exports and overrides only what tests need, so every named export stays importable (Bun links named imports eagerly; a missing export is a hard `SyntaxError`).
- `@earendil-works/pi-ai` — getModels, getModel, complete, stream (plain `mock()` fns)
- `@earendil-works/pi-ai/providers/all` and `@earendil-works/pi-ai/compat` — builtin-model and compat entry points. pi-ai's real `createProvider` is intentionally **not** mocked so catalog-overlay tests exercise genuine merge/restore/persist semantics

To configure or assert on a shared mock, import its handle and use it directly — no casts, no `vi.mocked` equivalent needed:

```typescript
import { mockComplete, mockLogger } from '../../../test/mocks';

mockComplete.mockResolvedValue({ content: [], stopReason: 'stop' } as any);
// …
expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('stripped'));
```

`mocks.ts` also exports `actualLogger` (a snapshot of the real logger module) and `loggerMockModule`, for the rare file that needs real log capture:

```typescript
import { actualLogger, loggerMockModule } from '../../../../test/mocks';

mock.module('../../../utils/logger', () => actualLogger);
afterAll(() => {
  mock.module('../../../utils/logger', () => loggerMockModule);
});
```

### `@earendil-works/pi-ai` specifics

- `getModels` covers all providers tests need including `openai-codex` and `anthropic`
- `getModel` always returns the `api` field — `OAuthTransformer.executeRequest` dispatches on `model.api` and throws "No API provider registered" without it
- `complete` and `stream` are `mock()` fns. Call history is cleared between tests, so a test that needs a specific return value must re-apply it in `beforeEach`
- To pin different pi-ai behaviour for one file (e.g. a faithful `clampThinkingLevel`), `spyOn(piAi, 'clampThinkingLevel')` with `import * as piAi from '@earendil-works/pi-ai'` in `beforeEach` — see `build-reasoning-for-model.test.ts`.

### Mocking `fetch`

Outbound provider traffic goes through `fetchWithSession` (`packages/backend/src/utils/fetch-sessions.ts`), which routes each HTTP(S) origin through a pooled `Bun.FetchSession`. Under test (`PLEXUS_UNDER_TEST=true`, set by the preload) it delegates to `globalThis.fetch`, so mock `globalThis.fetch` — do not mock the session module itself, or tests will diverge from production request shape. Non-HTTP(S) URLs always use plain fetch.

```typescript
import { asFetch } from '../../../test/test-utils';

beforeEach(() => {
  spyOn(globalThis, 'fetch').mockImplementation(
    asFetch(async () => Response.json({ tag_name: 'v0.200.0' }))
  );
});
```

- **Never assign `global.fetch = …`.** It is never restored and leaks into every later file. Use `spyOn` (auto-restored).
- **Return real `Response` objects** (`Response.json(body)`, `new Response(null, { status: 403 })`), not `{ ok: true, json: () => … }` partials — Bun types `fetch` strictly and real responses behave like production.
- **Wrap implementations in `asFetch(…)`.** `typeof fetch` carries a `preconnect` member in Bun's types, so a bare function is not assignable to `mockImplementation`.
- When a file keeps one shared `fetchMock = mock(…)` that tests queue `mockImplementationOnce` entries on, install it with `spyOn(globalThis, 'fetch').mockImplementation(fetchMock)` and reset the mock itself in `beforeEach` (see [Mock hygiene](#mock-hygiene-between-tests)).

### Using `registerSpy`

`registerSpy` from `packages/backend/test/test-utils.ts` is the existing convention for spying on an object method, and is equivalent to `spyOn` here: both are restored after every test by the global `afterEach`.

```typescript
import { registerSpy } from '../../../test/test-utils';

const spy = registerSpy(authManager, 'getApiKey').mockResolvedValue('token');
```

### Mock hygiene between tests

The preload's global `afterEach` runs `mock.clearAllMocks()` (clears call history, **keeps implementations**) plus `jest.restoreAllMocks()` (restores spies). This is different from Vitest's old `mockReset: true`:

- A plain `mock(impl)` keeps `impl` across tests — safe for shared defaults like `mockComplete`.
- An implementation set during a test (`mockResolvedValue`, `mockImplementation`) is **not** wiped for plain `mock()` fns. Re-apply what you rely on in `beforeEach`.
- **Queued `mockImplementationOnce` entries survive the test that queued them.** A test that does not consume its queue poisons the next test. For a file-level mock with queued implementations, `mockReset()` then re-set its default in `beforeEach`:

```typescript
const unconfigured = async () => {
  throw new Error('fetch mock not configured for test');
};
const fetchMock = mock(unconfigured);

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(unconfigured);
});
```

### Partial mocks of a module

There is no `importOriginal`. Take a snapshot of the real module **before** mocking, and spread it:

```typescript
import * as safeguards from '../../transformers/anthropic/synthetic-safeguards';

beforeEach(() => {
  const real = safeguards.resolveSyntheticSafeguardToggle;
  spyOn(safeguards, 'resolveSyntheticSafeguardToggle').mockImplementation(
    (canonical) => forceToggle ?? real(canonical)
  );
});
```

When you genuinely need `mock.module` (shared preload mocks, third-party packages):

- **Never import the module you are mocking from inside its own factory.** An `async` factory that does `await import('<same specifier>')` recurses forever and hangs the run at 100% CPU with no output.
- **Snapshot with a spread.** `mock.module` rewrites the original module's live namespace in place, so `const actual = await import('x')` ends up pointing at the mock. Copy it first: `const actual = { ...(await import('x')) }`.
- Restore in `afterAll` by re-registering the snapshot.

### Fake timers

Use `jest.useFakeTimers()` / `jest.useRealTimers()` from `bun:test`. Bun's fake clock has gaps that Vitest's did not:

- **No `advanceTimersByTimeAsync`.** Use the `advanceTimersByTimeAsync(ms)` helper in `test/test-utils.ts`. It yields to microtasks _before_ moving the clock (so code under test arms its timers at the current fake time), then advances in small steps keyed to elapsed `Date.now()`, flushing microtasks between steps (so code that awaits a timer and then arms another — poll loops, retries, grace periods — keeps running). It throws instead of hanging if the horizon is never reached.
- **Plain `jest.advanceTimersByTime(ms)` is only correct for synchronous code** — e.g. a class that sets a `setTimeout` and checks state after. If the code under test awaits a timer and then schedules another, a single synchronous advance deadlocks. Never use `await advanceTimersByTimeAsync` inside a non-`async` callback.
- **Capture, don't pre-attach, a rejection that only settles when you advance the clock** — see [`.rejects` and `.resolves` block](#rejects-and-resolves-block-until-the-promise-settles). `jest.getTimerCount()` throws once real timers are restored, so assert on it before `useRealTimers()`.
- **Never `await Bun.sleep(...)` or poll with `setTimeout` under fake timers** — they are faked and never fire. The test fails after the 5s per-test timeout.
- **Date-only freezing:** use `setSystemTime(new Date('…'))` and reset with `setSystemTime()`. It freezes `Date` and leaves timers real. Do not use `useFakeTimers({ toFake: ['Date'] })` or `{ shouldAdvanceTime: true }` — Bun's types and runtime do not support those options. To move a frozen clock forward, call `setSystemTime(new Date(Date.now() + ms))`.
- **Always restore.** Call `jest.useRealTimers()` (and `setSystemTime()` if you froze the date) in `afterEach`, or in a `finally`, so later tests keep a real clock.

### `waitFor`

Use `waitFor(assertion, { timeout, interval })` from `packages/backend/test/test-utils.ts` for polling assertions against real async work. Never under fake timers (its real-`setTimeout` loop never fires) — advance the clock explicitly instead. There is no `expect.poll` or `vi.waitFor` in Bun.

### `.rejects` and `.resolves` block until the promise settles

In Bun 1.4.4 the `.rejects` / `.resolves` matchers block the test until the promise settles (they spin the event loop rather than yielding to the rest of your test). That works when something _else_ settles it (I/O, a real timer, work already queued), but it **deadlocks at 100% CPU, with no output and no timeout**, when the promise only settles because of a _later statement in the same test_:

```typescript
// ❌ Hangs: the assertion blocks, so `controller.abort()` never runs.
const assertion = expect(dispatch(signal)).rejects.toMatchObject({ statusCode: 499 });
await ready;
controller.abort();
await assertion;

// ✅ Trigger first, assert after.
const dispatched = dispatch(signal);
await ready;
controller.abort();
await expect(dispatched).rejects.toMatchObject({ statusCode: 499 });

// ✅ Or capture the outcome up front and assert later (also avoids an
//    unhandled-rejection report if the promise rejects before you await it).
const outcome = dispatch(signal).then(
  () => 'resolved',
  (e) => `rejected:${e.statusCode}`
);
await ready;
controller.abort();
expect(await outcome).toBe('rejected:499');
```

The same applies under fake timers, where the thing that settles the promise is usually `advanceTimersByTimeAsync(…)` on a later line: create the assertion after advancing, or capture the outcome with `.then(ok, err)` first. `await expect(fn()).rejects…` on one line is fine whenever nothing else in the test has to happen first.

### Matchers and types

Bun's `expect<T>()` types matchers against the received value, which is stricter than Vitest:

- **Comparing across intentionally different types** (e.g. a `Record<string, string>` against a `string`, a literal against `process.env.X`): use the generic escape hatch on the matcher — `expect(a).toEqual<unknown>(b)`, `expect(a).toBe<unknown>(b)`, `expect<unknown[]>(list).toContain(x)`. Do not cast the received value.
- **`toHaveBeenCalledExactlyOnceWith` does not exist.** Use `toHaveBeenCalledTimes(1)` plus `toHaveBeenCalledWith(…)`.
- `Object.values(x)` over loosely typed data returns `unknown[]`; give it a type argument: `Object.values<{ type: string }>(x)`.
- `test.each`, `.resolves`, `.rejects` (mind the ordering rule above), `toMatchObject`, `expect.objectContaining` and `expect.any` otherwise behave as in Vitest.

### DOM globals (frontend tests)

Frontend tests that need `window`/`document`/`localStorage`/`navigator` call `useHappyDom()` from `packages/frontend/test/happydom.ts` once at the top level of the file:

```typescript
import { setLocation, useHappyDom } from '../../../test/happydom';

useHappyDom();

beforeEach(() => {
  setLocation('http://localhost/ui/providers');
});
afterEach(() => localStorage.clear());
```

`useHappyDom()` registers happy-dom before the file's tests and **unregisters it afterwards**. This matters: happy-dom replaces web-platform globals such as `fetch` and the stream classes, and a registration that outlives its file breaks backend tests that run later in the same process. Do not call `GlobalRegistrator.register()` directly or import a module for its side effects. Use the real `localStorage`/`document` and clear state in `afterEach`; do not stub them with hand-rolled fakes.

## Shared-process isolation

Plain `bun test` runs every file in one process. Bun keeps `mock.module()` overrides for the life of that process — `mock.restore()` does **not** undo them ([Bun docs](https://bun.com/docs/test/mocks)) — and nothing resets module state, singletons, or globals between files. A leak in one file fails unrelated files later in the run, often with a confusing message (`ConfigService.resetInstance is not a function`, `Export named 'x' not found`, `The transform's 'readable' property must be a ReadableStream`).

`--parallel` hides this by giving each file a fresh global, so **run plain `bun test` before pushing** — it is the stricter check, and CI runs it as a dedicated step. The rules:

1. **Do not `mock.module()` first-party code.** Use `spyOn` (see [Pick the mechanism](#pick-the-mechanism)). The only `mock.module()` calls that belong in the suite are the process-wide ones in `test/mocks.ts`, plus an `afterAll` restore like `system-logs.test.ts`.
2. **Undo every global you replace**, in `afterEach`/`afterAll` (or use a helper that does): `globalThis.fetch` (use `spyOn`), DOM globals (use `useHappyDom()`), `process.env` values (save, then restore or `delete` in `afterEach`), timers (`jest.useRealTimers()`), the system date (`setSystemTime()`).
3. **Reset singletons** in `beforeEach` (below).
4. **Never rely on test or file order.** Do not assume another file left state behind.

### Debugging a hang or a cross-file failure

- Every test in this suite finishes in well under 5 seconds and the whole suite in ~16s. A file that runs longer is hung, not slow.
- Run the suspect file alone with a hard cap: `timeout -s KILL 10 bun test ./path/to/file.test.ts`. A file that passes alone but fails in the full run is a leak from an earlier file.
- Bisect leaks with `bun test <fileA> <fileB>` (order is path-sorted) rather than the whole suite.
- A run that sits at 100% CPU with no output is almost always a self-referential `mock.module` factory, or a `.rejects` / `.resolves` assertion created before the statement that settles its promise.

## Singletons and Test Isolation

Several services are singletons (e.g., `OAuthAuthManager`, `CooldownManager`, `DebugManager`). Reset each singleton used by the test in `beforeEach` using its provided `resetForTesting()` or equivalent helper, such as `ConfigService.resetInstance()`. Use `afterEach` for any additional cleanup the service requires. A singleton left in a non-default state in one test leaks into subsequent tests — and, in a plain `bun test` run, into subsequent files.

## Other Rules

- Run tests with `bun test` from the repo root. **Prefer `bun test --changed=HEAD` (affected only) over the full suite.** Only run the full suite when the task warrants it.
- If you must mock a module, implement its **full public interface**
- **Test shared mutable state through the system under test, not through direct mutation.** The logger mock in `mocks.ts` closes over shared variables; tests for stateful behaviour must interact exclusively through the API/HTTP layer
- For spy-count assertions on pi-ai calls, put them in unit tests of the transformer layer (e.g., `oauth-transformer.test.ts`) where the test owns the full call chain within a single file. Prefer asserting on observable outcomes (response values, HTTP status codes) over spy call counts for cross-file scenarios
- `bun test` does not regenerate `packages/backend/src/assets/openapi.json`. After editing `docs/openapi/`, run `bun run generate:openapi:asset` (CI does this before the test step).
