import { mock } from 'bun:test';

/**
 * Global Robust Mock for Logger
 *
 * Bun test runner reuses worker processes across test files.
 * Using mock.module is a process-global operation that cannot be easily
 * undone with mock.restore().
 *
 * By preloading this complete mock, we ensure:
 * 1. No tests fail due to missing logger methods (e.g. "logger.info is not a function").
 * 2. Console output is suppressed during tests.
 * 3. Tests can still spy on these methods if they need to verify logging behavior.
 */

const SUPPORTED_LOG_LEVELS = ['error', 'warn', 'info', 'debug', 'verbose', 'silly'] as const;

type MockLogLevel = (typeof SUPPORTED_LOG_LEVELS)[number];

const normalizeLogLevel = (value: unknown): MockLogLevel | null => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return (SUPPORTED_LOG_LEVELS as readonly string[]).includes(normalized)
    ? (normalized as MockLogLevel)
    : null;
};

const getStartupLogLevel = (): MockLogLevel => {
  const envLevel = normalizeLogLevel(process.env.LOG_LEVEL);
  if (envLevel) return envLevel;
  if (process.env.DEBUG === 'true') return 'debug';
  return 'info';
};

let currentLogLevel: MockLogLevel = getStartupLogLevel();

const mockLogger = {
  level: currentLogLevel,
  error: mock(),
  warn: mock(),
  info: mock(),
  http: mock(),
  verbose: mock(),
  debug: mock(),
  silly: mock(),
};

// Mock the logger module for all common import paths used in the project
const loggerPaths = [
  'src/utils/logger',
  'packages/backend/src/utils/logger',
  '../utils/logger',
  '../../utils/logger',
];

for (const path of loggerPaths) {
  mock.module(path, () => ({
    logger: mockLogger,
    logEmitter: { emit: mock(), on: mock(), off: mock() },
    StreamTransport: class {},
    SUPPORTED_LOG_LEVELS,
    getStartupLogLevel,
    getCurrentLogLevel: () => currentLogLevel,
    setCurrentLogLevel: (level: string) => {
      const normalized = normalizeLogLevel(level);
      if (!normalized) {
        throw new Error(
          `Invalid log level '${level}'. Supported levels: ${SUPPORTED_LOG_LEVELS.join(', ')}`
        );
      }
      currentLogLevel = normalized;
      mockLogger.level = normalized;
      return normalized;
    },
    resetCurrentLogLevel: () => {
      currentLogLevel = getStartupLogLevel();
      mockLogger.level = currentLogLevel;
      return currentLogLevel;
    },
  }));
}

// Initialize database for tests
import { initializeDatabase } from '../src/db/client';
import { runMigrations } from '../src/db/migrate';
import path from 'node:path';
import fs from 'node:fs';

// Use an in-memory database for all tests. Each test that needs an isolated DB
// calls initializeDatabase(':memory:') directly in its own beforeEach.
// File-based test DBs were previously used to work around worker-process issues
// that no longer apply with Bun's test runner.
const testDbUrl = process.env.PLEXUS_TEST_DB_URL || 'sqlite://:memory:';

const testConfig = `
database:
  connection_string: "${testDbUrl}"
adminKey: test-key
providers: {}
models: {}
keys: {}
`;

// Set the test config
const { setConfigForTesting, validateConfig } = await import('../src/config');
setConfigForTesting(validateConfig(testConfig));

// Generate migration files from Drizzle schema so the test DB has all columns.
// This is needed because migration SQL files are not committed (CI generates them
// on merge to main). Without this step, test DB would be missing columns defined
// in the schema but not yet present in any tracked migration file.
import { execSync } from 'node:child_process';
try {
  execSync('bunx drizzle-kit generate --config=drizzle.config.sqlite.ts', {
    cwd: path.resolve(import.meta.dir, '..'),
    stdio: 'pipe',
  });
  execSync('bunx drizzle-kit generate --config=drizzle.config.postgres.ts', {
    cwd: path.resolve(import.meta.dir, '..'),
    stdio: 'pipe',
  });
} catch {
  // Migration files may already exist; ignore errors from re-generation.
}

// Initialize database with the test config
initializeDatabase(testDbUrl);
await runMigrations();

// Pre-initialize DebugManager with a fully-mocked storage so that any test
// which calls DebugManager.getInstance() before setting their own storage gets
// a safe no-op implementation, preventing "saveDebugLog is not a function"
// errors when tests from different files run in the same worker process.
const { DebugManager } = await import('../src/services/debug-manager');
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
