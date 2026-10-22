import { afterEach, jest, mock } from 'bun:test';
/**
 * Bun test preload (wired via `[test] preload` in bunfig.toml).
 *
 * Runs once per test process before any test file loads. Responsible for:
 *   1. Registering the shared module mocks (logger, @earendil-works/pi-ai)
 *      that every backend test file relies on (see ./mocks.ts).
 *   2. Creating a migrated, per-process test database and exporting its
 *      location through env vars (PLEXUS_TEST_DB_URL / DATABASE_URL).
 *      Defaults to SQLite; set PLEXUS_TEST_DIALECT=postgres to run against
 *      pglite instead.
 *   3. Stubbing DebugManager persistence and resetting mock state between tests.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Side-effect import: registers the shared module mocks before anything below
// (and before any test file) imports the modules they replace.
import './mocks';

// ---------------------------------------------------------------------------
// Test database
//
// One migrated temp database per process (per file under `--parallel`).
{
  const dialect = process.env.PLEXUS_TEST_DIALECT === 'postgres' ? 'postgres' : 'sqlite';
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plexus-bun-test-'));
  process.on('exit', () => {
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      // ignore temp cleanup errors
    }
  });

  let testDbUrl: string;
  if (dialect === 'postgres') {
    process.env.PLEXUS_POSTGRES_DRIVER = 'pglite';
    process.env.PLEXUS_PGLITE_DATA_DIR = path.join(tmpRoot, 'test.pglite');
    testDbUrl =
      process.env.PLEXUS_TEST_POSTGRES_DB_URL ||
      'postgres://postgres:postgres@localhost:5432/plexus_test';
  } else {
    testDbUrl = `sqlite://${path.join(tmpRoot, 'test.sqlite')}`;
  }

  process.env.PLEXUS_TEST_DIALECT = dialect;
  process.env.PLEXUS_TEST_DB_URL = testDbUrl;
  process.env.DATABASE_URL = testDbUrl;
  // fetch-sessions delegates to globalThis.fetch under test (see that module).
  process.env.PLEXUS_UNDER_TEST = 'true';

  const originalLogLevel = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = 'error';
  try {
    const [{ initializeDatabase, closeDatabase }, { runMigrations }, configModule] =
      await Promise.all([
        import('../src/db/client'),
        import('../src/db/migrate'),
        import('../src/config'),
      ]);

    const testConfig = JSON.stringify({
      database: { connection_string: testDbUrl },
      adminKey: 'test-key',
      providers: {},
      models: {},
      keys: {},
    });

    configModule.setConfigForTesting(configModule.validateConfig(testConfig));
    initializeDatabase(testDbUrl);
    await runMigrations();
    await closeDatabase();
  } finally {
    if (originalLogLevel === undefined) {
      delete process.env.LOG_LEVEL;
    } else {
      process.env.LOG_LEVEL = originalLogLevel;
    }
  }
}

// ---------------------------------------------------------------------------
// DebugManager storage stub (in-memory no-op persistence for all tests)
// ---------------------------------------------------------------------------

const { DebugManager } = await import('../src/services/observability/debug-manager');

DebugManager.getInstance().setStorage({
  saveRequest: mock(),
  saveError: mock(),
  saveDebugLog: mock(),
  updatePerformanceMetrics: mock(),
  emitStartedAsync: mock(),
  emitUpdatedAsync: mock(),
  emitStarted: mock(),
  emitUpdated: mock(),
  getDebugLogs: mock(async () => []),
  getDebugLog: mock(async () => null),
  deleteDebugLog: mock(async () => false),
  deleteAllDebugLogs: mock(async () => false),
  getErrors: mock(async () => []),
  deleteError: mock(async () => false),
  deleteAllErrors: mock(async () => false),
  getUsage: mock(async () => ({ data: [], total: 0 })),
  deleteUsageLog: mock(async () => false),
  deleteAllUsageLogs: mock(async () => false),
  deletePerformanceByModel: mock(async () => false),
  recordSuccessfulAttempt: mock(),
  recordFailedAttempt: mock(),
  getProviderPerformance: mock(async () => []),
} as any);

// ---------------------------------------------------------------------------
// Per-test mock hygiene: restore spies and clear mock call history.
// Implementations set on mocks survive (tests re-apply overrides in
// beforeEach when they need a specific return value).
// ---------------------------------------------------------------------------

afterEach(() => {
  mock.clearAllMocks();
  jest.restoreAllMocks();
});
