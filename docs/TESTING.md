# Testing Guide

## Running Tests

### Standard Run

From the repo root:

```bash
bun run test
```

Or from the backend package:

```bash
cd packages/backend
bun run test
```

> **Note:** `bun test` is intentionally blocked both at repo root and in `packages/backend` (via `bunfig.toml`). Use `bun run test` instead.

The default test command uses `--changed HEAD` and runs only tests affected by uncommitted changes. Use this unless you have a specific reason to run the full suite.

### Full Suite

```bash
cd packages/backend
bun run test:force-all
```

### Watch Mode

```bash
bun run test:watch
```

### Manual Testing (Dev Environment)

1. Start the development stack:
   ```bash
   bun run dev
   ```
2. Open the Dashboard at `http://localhost:4000`.
3. Send requests to the API proxy at `http://localhost:4000/v1/...`.

## Test Architecture

Backend tests run on **Vitest** with three parallel projects defined in `packages/backend/vitest.config.ts`:

| Project | Purpose | DB Setup |
|---------|---------|----------|
| `unit` | General unit tests (DB mocked) | None |
| `sqlite` | DB-layer tests against SQLite | Temp SQLite DB + migrations |
| `postgres` | DB-layer tests against Postgres (pglite) | Temp pglite DB + migrations |

The `DB_TEST_FILES` list in `vitest.db-tests.ts` determines which files run in the `sqlite` and `postgres` projects. All other test files run only in the `unit` project.

### Key Vitest Settings

| Setting | Value | Effect |
|---------|-------|--------|
| `pool` | `forks` | Each test file runs in a child process fork |
| `isolate` | `true` | Each test file gets a fresh module registry |
| `mockReset` | `true` | `vi.resetAllMocks()` before every test — clears `vi.fn()` call history and resets implementations to original |
| `clearMocks` | `true` | Clears call history (redundant with mockReset but explicit) |
| `restoreMocks` | `true` | Restores `vi.spyOn` mocks to originals after every test |

### Global Setup

`packages/backend/test/vitest.global-setup.ts` — creates a temporary DB, runs migrations once, cleans up after the run. Runs once per project that needs it (`sqlite` and `postgres`).

### Per-File Setup

`packages/backend/test/vitest.setup.ts` — runs once per test file. Installs the logger mock and the `@mariozechner/pi-ai` mock.

## Test File Organization

```
packages/backend/
├── src/
│   └── <module>/
│       ├── foo.ts                   # source file
│       └── __tests__/
│           └── foo.test.ts          # unit test — lives next to the source it tests
└── test/
    ├── vitest.setup.ts              # per-file setup (mocks, doubles)
    ├── vitest.global-setup.ts       # once-per-run setup (DB creation, migrations)
    ├── test-utils.ts                # shared spy/mock helpers
    ├── bun-test-guard/              # meta guard — excluded from Vitest
    └── integration/
        └── vision-*.test.ts         # multi-component / cross-service tests
```

**Rules:**
- **Unit tests** go in a `__tests__/` subdirectory alongside the source file they test. All imports use relative paths within `src/`.
- **Integration tests** (tests that exercise multiple services/components together) go in `test/integration/`.
- **Infrastructure** (setup files, shared utilities) stays in `test/` directly.
- **Never** put unit tests in the top-level `test/` folder, and never put integration tests inside `src/`.
- The Vitest `include` globs (`src/**/*.test.ts` and `test/**/*.test.ts`) cover both locations automatically.

## Mocking Rules

### Globally Mocked Modules

Registered in `vitest.setup.ts` — **do NOT re-mock in test files**:

- `../src/utils/logger` — logger, logEmitter, level helpers
- `@mariozechner/pi-ai` — getModels, getModel, complete (`vi.fn`), stream (`vi.fn`)

### `@mariozechner/pi-ai` Specifics

- `getModels` covers all providers tests need including `openai-codex` and `anthropic`
- `getModel` always returns the `api` field — `OAuthTransformer.executeRequest` dispatches on `model.api` and throws "No API provider registered" without it
- `complete` and `stream` are `vi.fn()`. Because `mockReset: true` wipes them between tests, any test that needs a specific return value must call `vi.mocked(piAi.complete).mockResolvedValue(...)` in `beforeEach`

### Adding New Module Mocks

If a test needs to mock a module **not** already in `vitest.setup.ts`, it may add its own `vi.mock` factory. That mock will be active only for that file's execution. Do not duplicate a mock already registered globally.

### Using `registerSpy`

Always use `registerSpy` from `test/test-utils.ts` instead of raw `vi.spyOn`. It registers the spy in a global tracker that the `test-utils` global `afterEach` automatically restores after every test, preventing leaks across files:

```typescript
import { registerSpy } from '../../../test/test-utils';

// Instead of:
const spy = vi.spyOn(authManager, 'getApiKey');

// Use:
const spy = registerSpy(authManager, 'getApiKey').mockResolvedValue('token');
```

### `mockReset: true` and `vi.fn()` Implementations

`mockReset: true` resets all `vi.fn()` instances before every test:

- `vi.fn()` (no impl) → implementation becomes `undefined` (returns undefined)
- `vi.fn(impl)` → implementation resets to the original `impl`

This means a global mock's `complete: vi.fn(async () => ({...}))` is safe — after reset it still works. But any `mockResolvedValue`/`mockImplementation` applied during a test is wiped before the next. Always re-apply overrides in `beforeEach`.

## Singletons and Test Isolation

Several services are singletons (e.g., `OAuthAuthManager`, `CooldownManager`, `DebugManager`). Always reset them in `beforeEach`/`afterEach` using their provided `resetForTesting()` or equivalent methods. A singleton left in a non-default state in one test can leak into subsequent tests.

## Other Rules

- `packages/backend/bunfig.toml` blocks raw `bun test` — use `bun run test` / `bun run test:watch`
- Root `bunfig.toml` blocks raw `bun test` at repo root — use `cd packages/backend && bun run test`
- **Prefer `bun run test` (affected only) over `bun run test:force-all`.** Never reach for `test:force-all` out of habit.
- If you must mock a module, implement its **full public interface**
- Do not use `__mocks__` directories for `node_modules` mocks — they are not reliably loaded when the real module may already be cached
- **Test shared mutable state through the system under test, not through direct mutation.** The logger mock in `vitest.setup.ts` closes over shared variables; tests for stateful behaviour must interact exclusively through the API/HTTP layer
- For spy-count assertions on pi-ai calls, put them in unit tests of the transformer layer (e.g., `oauth-transformer.test.ts`) where the test owns the full call chain within a single file. Prefer asserting on observable outcomes (response values, HTTP status codes) over spy call counts for cross-file scenarios
